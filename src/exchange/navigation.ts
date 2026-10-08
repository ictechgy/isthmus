import { createJsonGuards } from './json-guards.ts';
import { isBridgeTimestamp, isProjectRelativePath, type BridgeLocation } from './parse.ts';
import { isCanonicalRouteTemplate } from './route-template.ts';

/** 화면의 URL을 그래프 진입 심볼과 연결하며 HTTP method/service 의미는 갖지 않는다. */
export interface ScreenRouteFact {
  readonly kind: 'screen-route';
  readonly urlTemplate: string | null;
  readonly dynamic: boolean;
  readonly location: BridgeLocation;
  readonly screen?: { readonly usr: string; readonly qualifiedName?: string };
  readonly testSource?: true;
}

/** navigation은 bridge-facts의 닫힌 HTTP fact 집합과 분리된 선택적 입력이다. */
export interface NavigationFactsDocument {
  readonly format: 'navigation-facts';
  readonly version: 1;
  readonly tool: { readonly name: string; readonly version: string };
  readonly generatedAt: string;
  readonly platform: 'js';
  readonly project: string;
  readonly facts: readonly ScreenRouteFact[];
  readonly limitations: readonly string[];
}

/** 원문·위치를 오류 메시지에 넣지 않는 계약 오류다. */
export class NavigationValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'NavigationValidationError'; }
}

const fail = (message: string): never => { throw new NavigationValidationError(message); };
const guards = createJsonGuards(fail);
const safe = (value: unknown, limit = 8192): string => {
  const text = guards.safe(value, 'Navigation string is invalid.');
  if (text.length > limit) return fail('Navigation string exceeds its size limit.');
  return text;
};

/** 닫힌 입력 경계를 검증하고 동적·미해결 화면을 HTTP route로 취급하지 않는다. */
export function parseNavigationFactsDocument(input: unknown): NavigationFactsDocument {
  const value = guards.object(input, 'Navigation document must be an object.');
  keys(value, ['format', 'version', 'tool', 'generatedAt', 'platform', 'project', 'facts', 'limitations']);
  if (value.format !== 'navigation-facts' || value.version !== 1 || value.platform !== 'js') return fail('Unsupported navigation format, version or platform.');
  const tool = guards.object(value.tool, 'Navigation tool must be an object.');
  keys(tool, ['name', 'version']);
  if (!isBridgeTimestamp(value.generatedAt)) return fail('Navigation generatedAt must be an explicit timestamp.');
  const project = safe(value.project);
  if (!project.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(project)) return fail('Navigation project must be an absolute root.');
  const facts = guards.array(value.facts, 100_000, 'Navigation facts exceed the collection limit.').map(parseFact);
  const limitations = guards.textStrings(value.limitations, 10_000, 'Navigation limitations are invalid.');
  if (limitations.some((line) => line.length > 16_384)) return fail('Navigation limitation exceeds its size limit.');
  return { format: 'navigation-facts', version: 1, platform: 'js',
    tool: { name: safe(tool.name, 256), version: safe(tool.version, 256) }, generatedAt: value.generatedAt,
    project, facts, limitations };
}

/** 화면 레코드 하나를 검증하고 미상 등록은 동적으로 남긴다. */
function parseFact(input: unknown): ScreenRouteFact {
  const value = guards.object(input, 'Navigation fact must be an object.');
  keys(value, ['kind', 'urlTemplate', 'dynamic', 'location', 'screen', 'testSource']);
  if (value.kind !== 'screen-route' || typeof value.dynamic !== 'boolean') return fail('Invalid navigation fact kind or dynamic state.');
  const urlTemplate = value.urlTemplate === null ? null : safe(value.urlTemplate, 2048);
  if (urlTemplate !== null && !isCanonicalRouteTemplate(urlTemplate)) return fail('Navigation URL is not a canonical template.');
  const location = guards.object(value.location, 'Navigation location is required.');
  keys(location, ['path', 'line', 'column']);
  if (!isProjectRelativePath(location.path) || typeof location.line !== 'number' || !Number.isSafeInteger(location.line) || location.line < 1
      || typeof location.column !== 'number' || !Number.isSafeInteger(location.column) || location.column < 1) return fail('Navigation location must be relative with positive coordinates.');
  let screen: ScreenRouteFact['screen'];
  if (value.screen !== undefined) {
    const symbol = guards.object(value.screen, 'Navigation screen must be an object.');
    keys(symbol, ['usr', 'qualifiedName']);
    screen = { usr: safe(symbol.usr), ...(symbol.qualifiedName === undefined ? {} : { qualifiedName: safe(symbol.qualifiedName) }) };
  }
  if (!value.dynamic && (urlTemplate === null || screen === undefined)) return fail('Static navigation requires a URL and screen identity.');
  if (value.testSource !== undefined && value.testSource !== true) return fail('Navigation testSource must be true when present.');
  return { kind: 'screen-route', urlTemplate, dynamic: value.dynamic,
    location: { path: location.path, line: location.line, column: location.column },
    ...(screen === undefined ? {} : { screen }), ...(value.testSource === true ? { testSource: true } : {}) };
}

/** 모르는 필드가 backend dispatch나 부정확한 route 조인을 추가하지 못하게 한다. */
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) return fail('Navigation input contains an unknown field.');
}
