import { PreflightValidationError, validateLanguageImpact, type LanguageImpact, type ImpactSymbol } from './preflight-context.ts';
import type { ProducerImpactMetadata } from './producer-impact.ts';
import { isProjectRelativePath, isSafeNonEmptyString } from './parse.ts';
import { compareStrings } from '../compare.ts';

/** Kartograph의 현재 시점 영향 근거를 공통 사전 점검 형식으로 연결한다. */
export function adaptKartographImpact(raw: unknown, metadata: ProducerImpactMetadata): LanguageImpact {
  const value = object(raw);
  if (value.format !== 'kartograph-impact' || value.version !== 1) fail('Expected kartograph-impact version 1.');
  if (!['found', 'partial', 'notFound', 'noChanges'].includes(string(value.status))) fail('Invalid Kartograph impact status.');
  if (!isSafeNonEmptyString(metadata.project)) fail('Invalid Kartograph project metadata.');
  const inputs = object(value.inputs);
  if (inputs.base !== undefined) fail('Kartograph preflight requires a current-only impact report.');
  const limitations = array(value.limitations).map((item) => string(item));
  const flags = object(value.truncated);
  for (const key of ['results', 'depth', 'budget']) if (typeof flags[key] !== 'boolean') fail('Invalid Kartograph truncation flag.');
  const navigation = value.navigation === undefined ? undefined : object(value.navigation);
  if (navigation !== undefined && (!Number.isSafeInteger(navigation.offset) || (navigation.offset as number) < 0 ||
    typeof navigation.hasNext !== 'boolean' || typeof navigation.hasPrevious !== 'boolean')) fail('Invalid Kartograph navigation.');
  let truncated = Object.values(flags).some((flag) => flag === true) || value.status === 'partial' ||
    (navigation !== undefined && (navigation.offset !== 0 || navigation.hasNext === true || navigation.hasPrevious === true));
  let missingLocations = 0;
  let partialLocations = 0;
  let omittedPaths = 0;
  let pathItems = 0;
  const symbols = new Map<string, ImpactSymbol>();
  const changed = array(value.changed).map(object);
  const affected = array(value.affected).map(object);
  for (const row of [...changed, ...affected]) {
    const id = string(row.usr);
    if (symbols.has(id)) fail('Kartograph impact symbol ids must be unique.');
    const current = array(row.presentIn).map(string).includes('current');
    if (!current) { omittedPaths++; continue; }
    let location;
    if (row.location !== null && row.location !== undefined) {
      const source = object(row.location);
      const path = typeof source.path === 'string' && source.path.startsWith(`${metadata.project}/`)
        ? source.path.slice(metadata.project.length + 1) : source.path;
      if (isProjectRelativePath(path)) {
        const line = Number.isSafeInteger(source.line) && (source.line as number) > 0 ? source.line as number : undefined;
        const column = line !== undefined && Number.isSafeInteger(source.column) && (source.column as number) > 0
          ? source.column as number : undefined;
        location = { path, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) };
        if (column === undefined) partialLocations++;
      }
    }
    if (location === undefined) missingLocations++;
    symbols.set(id, { id, qualifiedName: string(row.qualifiedName),
      ...(row.kind === undefined ? {} : { kind: string(row.kind) }), ...(location === undefined ? {} : { location }) });
  }
  const roots = changed.flatMap((row) => symbols.has(string(row.usr)) ? [symbols.get(string(row.usr))!] : []);
  const rootIds = new Set(roots.map(({ id }) => id));
  const adjacency = new Map<string, Map<string, Set<string>>>();
  for (const row of affected) {
    omittedPaths += row.pathOmissions === undefined ? 0 : array(row.pathOmissions).length;
    if (row.pathStatus !== undefined && row.pathStatus !== 'complete') truncated = true;
    for (const input of array(row.paths)) {
      const path = object(input);
      const revision = string(path.revision);
      if (revision === 'base') { omittedPaths++; continue; }
      if (revision !== 'current') fail('Invalid Kartograph path revision.');
      const nodes = array(path.nodes).map(string);
      const edges = array(path.edges).map(object);
      pathItems += nodes.length + edges.length;
      if (pathItems > 1_000_000) fail('Kartograph impact paths exceed their budget.');
      if (nodes.length < 2 || nodes.length > 129 || edges.length !== nodes.length - 1 || nodes[0] !== row.usr ||
        nodes.at(-1) !== path.changed || new Set(nodes).size !== nodes.length) fail('Invalid Kartograph impact path.');
      const relationships = edges.map((edge, index) => {
        const source = string(edge.source); const target = string(edge.target);
        const forward = source === nodes[index] && target === nodes[index + 1];
        const reverse = target === nodes[index] && source === nodes[index + 1];
        if ((!forward && !reverse) || (reverse && edge.kind !== 'override') ||
          edge.traversal !== (forward ? 'dependency' : 'overrideContract')) {
          fail('Kartograph path edges do not match their traversal.');
        }
        return [string(edge.kind), `origin:${string(edge.origin)}`, `traversal:${string(edge.traversal)}`];
      });
      if (!rootIds.has(string(path.changed)) || nodes.some((id) => !symbols.has(id))) { omittedPaths++; continue; }
      for (let index = 0; index < edges.length; index++) {
        const parent = nodes[index + 1]!; const child = nodes[index]!;
        let children = adjacency.get(parent);
        if (children === undefined) { children = new Map(); adjacency.set(parent, children); }
        let reasons = children.get(child);
        if (reasons === undefined) { reasons = new Set(); children.set(child, reasons); }
        for (const reason of relationships[index]!) reasons.add(reason);
      }
    }
  }
  // 같은 current 그래프의 관찰 간선만 사용한다. 한 정점의 대표 경로는 가장 짧은 경로다.
  const queue = [...rootIds].sort(compareStrings);
  const depth = new Map(queue.map((id) => [id, 0]));
  const rows: Array<LanguageImpact['affected'][number]> = [];
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]!;
    for (const [id, reasons] of [...(adjacency.get(parent) ?? [])].sort(([a], [b]) => compareStrings(a, b))) {
      if (depth.has(id)) continue;
      const distance = depth.get(parent)! + 1;
      if (distance > 128) { omittedPaths++; continue; }
      depth.set(id, distance); queue.push(id);
      rows.push({ symbol: symbols.get(id)!, via: parent, depth: distance, relationships: [...reasons].sort(compareStrings) });
    }
  }
  omittedPaths += affected.filter((row) => symbols.has(string(row.usr)) && !depth.has(string(row.usr))).length;
  const unresolved = array(value.unresolved);
  if (unresolved.length > 0) limitations.push(`kartograph-unresolved: ${unresolved.length} requested item(s) require review`);
  if (missingLocations > 0) limitations.push(`kartograph-unresolved-locations: ${missingLocations} symbol location(s) omitted`);
  if (partialLocations > 0) limitations.push(`kartograph-partial-source-locations: ${partialLocations} JVM symbol location(s) lack exact line or column coordinates`);
  if (omittedPaths > 0) limitations.push(`kartograph-unrepresented-paths: ${omittedPaths} path or symbol observation(s) require the original producer report`);
  truncated ||= omittedPaths > 0;
  return validateLanguageImpact({ id: metadata.id, platform: 'kotlin', requested: metadata.requested,
    tool: metadata.tool, ...(metadata.trigger === undefined ? {} : { trigger: metadata.trigger }),
    roots, affected: rows, limitations, truncated });
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Invalid Kartograph impact object.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 50_000) fail('Invalid Kartograph impact array.');
  return value;
}
function string(value: unknown): string {
  if (!isSafeNonEmptyString(value)) fail('Invalid Kartograph impact string.');
  return value;
}
function fail(message: string): never { throw new PreflightValidationError(message); }
