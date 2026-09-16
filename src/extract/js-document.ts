/**
 * extract-js의 문서 조립 레이어다.
 *
 * 파일별 스캔 결과를 모아 상대 경로 import를 스캔 집합 안에서 해석하고,
 * 바인딩이 확정된 식별자의 멤버 호출을 method-invoke 사실로 바꾼다.
 * 파일시스템을 읽지 않는 순수 조립이다 — 경로 해석·읽기는 cli/가 담당한다.
 */

import type { BridgeFact, BridgeFactsDocument } from '../exchange/parse.ts';
import type { BoundName, ScannedImport } from './js-scan.ts';
import { scanJsSource } from './js-scan.ts';
import type { JsFileScan } from './js-scan.ts';

/** 스캔 대상이 되는 JS/TS 확장자다. */
export const JS_SOURCE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
] as const;

/** 조립 입력 — 프로젝트 상대 경로와 UTF-8 텍스트다. */
export interface JsSourceFile {
  readonly path: string;
  readonly text: string;
}

/**
 * 스캔한 JS/TS 파일들을 bridge-facts v1 문서로 조립한다.
 *
 * 사실이 하나도 없으면 계약상 target은 null이다 — 관찰했으나 없음과 관찰
 * 자체가 불가를 구분해 빈 사실이 "청정"으로 읽히지 않게 한다.
 */
export function createJsFactsDocument(
  files: readonly JsSourceFile[],
  toolVersion: string,
  generatedAt: string,
  project: string,
): BridgeFactsDocument {
  const scans = new Map<string, JsFileScan>();
  for (const file of files) scans.set(file.path, scanJsSource(file.text));

  const facts: BridgeFact[] = [];
  let unattributedRelativeCalls = 0;
  let unattributedPackageCalls = 0;

  for (const file of files) {
    const scan = scans.get(file.path)!;
    const resolvedIdents = new Map<string, BoundName>(scan.bindings);
    for (const entry of scan.imports) {
      const bound = resolveImport(scans, file.path, entry);
      if (bound !== undefined) {
        resolvedIdents.set(entry.localName, bound);
      } else if (entry.specifier.startsWith('.')) {
        unattributedRelativeCalls += countMemberCalls(scan, entry.localName);
      } else {
        unattributedPackageCalls += countMemberCalls(scan, entry.localName);
      }
    }
    for (const fact of scan.facts) {
      facts.push(toFact(file.path, fact));
    }
    for (const call of scan.memberCalls) {
      const bound = resolvedIdents.get(call.ident);
      if (bound === undefined) continue;
      const name = 'name' in bound ? bound.name : bound.dynamicExpression;
      facts.push({
        kind: 'method-invoke',
        channel: name,
        method: call.method,
        dynamic: !('name' in bound) || call.dynamicMethod,
        location: locationOf(file.path, call.token),
      });
    }
  }

  const sorted = dedupeFacts(facts);
  const limitations = buildLimitations(files.length, scans, {
    unattributedRelativeCalls,
    unattributedPackageCalls,
  });

  return {
    format: 'bridge-facts',
    version: 1,
    tool: { name: 'isthmus', version: toolVersion },
    generatedAt,
    platform: 'js',
    target: sorted.length === 0 ? null : 'react-native',
    project,
    facts: sorted,
    limitations,
  };
}

/** 한 식별자에 대한 멤버 호출 수를 센다(미귀속 한계 계수용). */
function countMemberCalls(scan: JsFileScan, ident: string): number {
  return scan.memberCalls.filter((call) => call.ident === ident).length;
}

/**
 * `import X from 'spec'`을 스캔 집합 안에서 해석한다.
 *
 * 상대 specifier만 해석한다 — 패키지 specifier는 스캔 집합(node_modules는
 * 제외됨) 밖이라 귀속 근거가 없다. 배럴 재수출은 순환을 피하기 위해 홉 상한
 * 안에서 따라간다.
 */
function resolveImport(
  scans: ReadonlyMap<string, JsFileScan>,
  fromPath: string,
  entry: ScannedImport,
): BoundName | undefined {
  let specifier = entry.specifier;
  let exportedName: string | 'default' = entry.exportedName;
  let currentDir = dirnameOf(fromPath);
  for (let hop = 0; hop < 4; hop++) {
    if (!specifier.startsWith('.')) return undefined;
    const target = resolveSpecifier(scans, currentDir, specifier);
    if (target === undefined) return undefined;
    const scan = scans.get(target)!;
    const bound = exportedName === 'default'
      ? scan.exports.defaultName
      : scan.exports.named.get(exportedName);
    if (bound !== undefined) return bound;
    const reexport = exportedName === 'default'
      ? scan.exports.reexported.get('default')
      : scan.exports.reexported.get(exportedName);
    if (reexport === undefined) return undefined;
    specifier = reexport.specifier;
    exportedName = reexport.exportedName;
    currentDir = dirnameOf(target);
  }
  return undefined;
}

/** specifier를 디렉터리 기준으로 정규화해 스캔 집합에 있는 파일을 찾는다. */
function resolveSpecifier(
  scans: ReadonlyMap<string, JsFileScan>,
  dir: string,
  specifier: string,
): string | undefined {
  const base = normalizePath(dir === '' ? specifier : `${dir}/${specifier}`);
  const candidates = [
    base,
    ...JS_SOURCE_EXTENSIONS.map((ext) => `${base}.${ext}`),
    ...JS_SOURCE_EXTENSIONS.map((ext) => `${base}/index.${ext}`),
  ];
  return candidates.find((candidate) => scans.has(candidate));
}

/** `.`·`..` 세그먼트를 접은 POSIX 상대 경로다. 스캔 집합 밖 탈출은 해석 불가다. */
function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return '';
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

/** 프로젝트 상대 경로의 디렉터리 부분이다. */
function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** 스캔 사실을 계약 필드 모양으로 바꾼다. */
function toFact(path: string, fact: {
  kind: BridgeFact['kind'];
  channel: string;
  method?: string;
  dynamic: boolean;
  token: { line: number; column: number };
}): BridgeFact {
  return {
    kind: fact.kind,
    channel: fact.channel,
    ...(fact.method === undefined ? {} : { method: fact.method }),
    dynamic: fact.dynamic,
    location: locationOf(path, fact.token),
  };
}

/** 토큰 위치를 계약 위치로 바꾼다. */
function locationOf(
  path: string,
  token: { line: number; column: number },
): BridgeFact['location'] {
  return { path, line: token.line, column: token.column };
}

/** 같은 위치·같은 키의 중복 사실을 한 번만 남기고 결정적으로 정렬한다. */
function dedupeFacts(facts: readonly BridgeFact[]): BridgeFact[] {
  const seen = new Map<string, BridgeFact>();
  for (const fact of facts) {
    const key = JSON.stringify([
      fact.kind,
      fact.channel,
      fact.method ?? null,
      fact.location.path,
      fact.location.line,
      fact.location.column,
      fact.dynamic,
    ]);
    if (!seen.has(key)) seen.set(key, fact);
  }
  return [...seen.values()].sort((left, right) => {
    const byPath = left.location.path.localeCompare(right.location.path);
    if (byPath !== 0) return byPath;
    if (left.location.line !== right.location.line) {
      return left.location.line - right.location.line;
    }
    if (left.location.column !== right.location.column) {
      return left.location.column - right.location.column;
    }
    return (left.channel ?? '').localeCompare(right.channel ?? '');
  });
}

/** 집계 계수와 고정 범위 설명을 생산자 limitation 문자열로 바꾼다. */
function buildLimitations(
  fileCount: number,
  scans: ReadonlyMap<string, JsFileScan>,
  extra: {
    unattributedRelativeCalls: number;
    unattributedPackageCalls: number;
  },
): string[] {
  let dynamicModuleNames = 0;
  let dynamicComponentNames = 0;
  let dynamicMethodNames = 0;
  for (const scan of scans.values()) {
    dynamicModuleNames += scan.counts.dynamicModuleNames;
    dynamicComponentNames += scan.counts.dynamicComponentNames;
    dynamicMethodNames += scan.counts.dynamicMethodNames;
  }
  const limitations: string[] = [
    'js-binding-scope: member calls through bindings that leave the scan set '
      + '(package imports, function results, instance state) are not attributed '
      + 'to a module name',
  ];
  if (dynamicModuleNames > 0) {
    limitations.push(
      `dynamic-module-names: ${dynamicModuleNames} module references use a `
      + 'non-literal name',
    );
  }
  if (dynamicComponentNames > 0) {
    limitations.push(
      `dynamic-component-names: ${dynamicComponentNames} component requires `
      + 'use a non-literal name',
    );
  }
  if (dynamicMethodNames > 0) {
    limitations.push(
      `dynamic-method-names: ${dynamicMethodNames} bridge method calls use a `
      + 'non-literal method name',
    );
  }
  if (extra.unattributedRelativeCalls > 0) {
    limitations.push(
      `unattributed-js-relative-calls: ${extra.unattributedRelativeCalls} `
      + 'member calls on imports that did not resolve inside the scanned '
      + 'file set could not be attributed to a module name',
    );
  }
  if (extra.unattributedPackageCalls > 0) {
    limitations.push(
      `unattributed-js-package-calls: ${extra.unattributedPackageCalls} member `
      + 'calls on package imports could not be attributed to a module name',
    );
  }
  if (fileCount === 0) {
    limitations.push('empty-js-scan: no JS/TS source files were scanned');
  }
  return limitations;
}
