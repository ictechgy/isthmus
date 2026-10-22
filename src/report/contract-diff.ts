import { createHash } from 'node:crypto';
import type { DataContract, DataContractField } from '../exchange/data-contract.ts';
import type { BridgeFact, BridgeFactsDocument } from '../exchange/parse.ts';
import { BridgeJoinValidationError, isBridgeJoinDeferred, joinBridgeDocuments, type BridgeEndpoint } from '../join/join.ts';

/** 계약 비교의 준비/출력 상한이다. 예산 초과는 부분적인 성공으로 바꾸지 않는다. */
export const MAX_CONTRACT_DECLARATIONS = 2000;
export const MAX_CONTRACT_COMPARISON_FIELDS = 100_000;
const MAX_CALLERS = 50;
interface Declaration { fact: BridgeFact; document: BridgeFactsDocument }
/** 필드의 관찰 차이다. 방향만 보고 실제 클라이언트 실패를 추측하지 않는다. */
export interface ContractFieldChange {
  readonly reason: 'field-added' | 'field-removed' | 'field-changed';
  readonly before?: DataContractField;
  readonly after?: DataContractField;
}
/** 같은 논리 경계에서 얻은 전후 근거와 각 시점의 독립 조인 결과다. */
export interface ContractChange {
  readonly key: string;
  readonly reason: 'declaration-added' | 'declaration-removed' | 'contract-changed' | 'contract-unavailable' | 'contract-ambiguous';
  readonly changes: readonly ContractFieldChange[];
  readonly evidence: { readonly before: readonly BridgeEndpoint[]; readonly after: readonly BridgeEndpoint[] };
  readonly reviewCallers: { readonly before: readonly BridgeEndpoint[]; readonly after: readonly BridgeEndpoint[] };
  readonly callersOmitted: { readonly before: number; readonly after: number };
  readonly limitations: readonly string[];
}

/** 두 생산 시점의 명시 계약만 비교한다. 조인·전파의 시점을 합치지 않는다. */
export function createContractDiff(before: readonly BridgeFactsDocument[], after: readonly BridgeFactsDocument[],
  clients: readonly BridgeFactsDocument[], limit = 100) {
  validateInputs(before, after, clients, limit);
  const old = declarations(before), current = declarations(after);
  const calls = { before: connectedCallers(before, clients), after: connectedCallers(after, clients) };
  const keys = [...new Set([...old.keys(), ...current.keys()])].sort();
  const rows: ContractChange[] = [];
  for (const key of keys) {
    const left = old.get(key) ?? [], right = current.get(key) ?? [];
    const contracts = (items: Declaration[]) => [...new Set(items.map(({ fact }) => JSON.stringify(fact.dataContract)))];
    const a = contracts(left), b = contracts(right);
    const reason = left.length === 0 ? 'declaration-added' : right.length === 0 ? 'declaration-removed'
      : a.length > 1 || b.length > 1 ? 'contract-ambiguous'
      : left[0]!.fact.dataContract === undefined || right[0]!.fact.dataContract === undefined ? 'contract-unavailable'
      : a[0] !== b[0] ? 'contract-changed' : undefined;
    if (reason === undefined) continue;
    const changes = reason === 'contract-changed'
      ? compareFields(left[0]!.fact.dataContract!, right[0]!.fact.dataContract!) : [];
    const beforeCalls = calls.before.callers.get(key) ?? [], afterCalls = calls.after.callers.get(key) ?? [];
    rows.push({ key, reason, changes, evidence: { before: left.map(endpoint), after: right.map(endpoint) },
      reviewCallers: { before: beforeCalls.slice(0, MAX_CALLERS), after: afterCalls.slice(0, MAX_CALLERS) },
      callersOmitted: { before: Math.max(0, beforeCalls.length - MAX_CALLERS), after: Math.max(0, afterCalls.length - MAX_CALLERS) },
      limitations: [...new Set([...left, ...right].flatMap(({ fact }) => fact.dataContract?.limitations ?? ['contract-not-collected']))].sort() });
  }
  const incomplete = [...before, ...after].flatMap((document) => document.facts.flatMap((fact) =>
    fact.dataContract?.limitations ?? (isDeclaration(fact) ? ['contract-not-collected'] : [])));
  return { format: 'isthmus-contract-diff' as const, version: 1, mode: 'before-after-contracts' as const,
    complete: false, status: rows.length > 0 ? 'review-required' : 'no-changes-observed',
    scope: { granularity: 'explicit-fields', languageTraversal: 'not-assessed', runtimeCompatibility: 'not-assessed',
      testPrediction: 'not-assessed', freshness: 'unknown-source-build-alignment',
      unresolvedDynamicDeclarations: { before: before.reduce((n, doc) => n + doc.facts.filter((fact) => isDeclaration(fact) && fact.dynamic).length, 0),
        after: after.reduce((n, doc) => n + doc.facts.filter((fact) => isDeclaration(fact) && fact.dynamic).length, 0) } },
    summary: { total: rows.length, shown: Math.min(rows.length, limit), omitted: Math.max(0, rows.length - limit),
      comparedDeclarations: keys.length, fieldChanges: rows.reduce((sum, row) => sum + row.changes.length, 0) },
    changes: rows.slice(0, limit),
    limits: { declarations: MAX_CONTRACT_DECLARATIONS, fields: MAX_CONTRACT_COMPARISON_FIELDS, output: limit, callersPerSnapshot: MAX_CALLERS },
    truncated: rows.length > limit || rows.some((row) => row.callersOmitted.before + row.callersOmitted.after > 0),
    limitations: { before: before.flatMap((doc) => doc.limitations), after: after.flatMap((doc) => doc.limitations),
      clients: clients.flatMap((doc) => doc.limitations), contracts: [...new Set(incomplete)].sort(),
      joins: { before: calls.before.limitations, after: calls.after.limitations },
      analysis: ['Explicit producer fields only; omitted fields and dynamic paths are unknown.',
        'Caller matches, including ambiguous route bindings, are review candidates, not observed failures or permission to skip tests.',
        ...(clients.length === 0 ? ['Client sources were not supplied.'] : [])] },
    inputs: { before: before.map(identity), after: after.map(identity), clients: clients.map(identity) } };
}

function validateInputs(before: readonly BridgeFactsDocument[], after: readonly BridgeFactsDocument[],
  clients: readonly BridgeFactsDocument[], limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new BridgeJoinValidationError('Contract output limit must be 1..1000.');
  const all = [...before, ...after, ...clients];
  const domain = all.find((doc) => doc.target !== null)?.target ?? null;
  if (before.length === 0 || after.length === 0 || !['http', 'persistence', null].includes(domain ?? null) ||
    new Set(all.map((doc) => doc.project)).size !== 1 ||
    all.some((doc) => doc.target !== null && doc.target !== domain) ||
    [...before, ...after].some((doc) => doc.platform !== 'sql' &&
      !(doc.platform === 'openapi' && doc.target === null && doc.facts.length === 0) && !doc.roles?.includes('server')) ||
    clients.some((doc) => doc.platform === 'sql' || (domain === 'http' && !doc.roles?.includes('client')))) {
    throw new BridgeJoinValidationError('Contract diff requires matching declaration snapshots and fixed clients from one project and domain.');
  }
  const inventory = (docs: readonly BridgeFactsDocument[]) => JSON.stringify(docs.map((doc) =>
    JSON.stringify([doc.platform, doc.tool.name, doc.service ?? null, doc.dispatch ?? null, doc.sourceSets ?? null])).sort());
  if (inventory(before) !== inventory(after)) throw new BridgeJoinValidationError('Contract diff producer inventories differ; recapture both snapshots.');
  const facts = [...before, ...after].flatMap((doc) => doc.facts.filter(isDeclaration));
  if (facts.length > MAX_CONTRACT_DECLARATIONS || facts.reduce((sum, fact) => sum + (fact.dataContract?.fields.length ?? 0), 0) > MAX_CONTRACT_COMPARISON_FIELDS) {
    throw new BridgeJoinValidationError('Contract comparison budget exceeded; narrow the producer capture scope.');
  }
}
function isDeclaration(fact: BridgeFact): boolean { return ['route-contract', 'route-decl', 'relation-decl'].includes(fact.kind); }
function keyFor(fact: BridgeFact, document: BridgeFactsDocument): string {
  return JSON.stringify([fact.service ?? document.service ?? 'default', fact.kind, fact.pathAnchor ?? null, fact.method ?? null, fact.channel]);
}
function declarations(documents: readonly BridgeFactsDocument[]): Map<string, Declaration[]> {
  const result = new Map<string, Declaration[]>();
  for (const document of documents) for (const fact of document.facts) {
    if (!isDeclaration(fact) || fact.dynamic) continue;
    const key = keyFor(fact, document);
    result.set(key, [...(result.get(key) ?? []), { fact, document }]);
  }
  for (const [key, items] of result) result.set(key, [...new Map(items.map((item) =>
    [JSON.stringify([endpoint(item), item.fact.dataContract]), item])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item));
  return result;
}
function endpoint({ fact, document }: Declaration): BridgeEndpoint {
  return { platform: document.platform, ...(fact.location === undefined ? {} : { location: fact.location }),
    ...(fact.symbol === undefined ? {} : { symbol: fact.symbol }) };
}
function identity(document: BridgeFactsDocument) {
  return { platform: document.platform, tool: document.tool, generatedAt: document.generatedAt,
    project: document.project, target: document.target,
    ...(document.roles === undefined ? {} : { roles: document.roles }),
    ...(document.service === undefined ? {} : { service: document.service }),
    ...(document.dispatch === undefined ? {} : { dispatch: document.dispatch }),
    ...(document.sourceSets === undefined ? {} : { sourceSets: document.sourceSets }),
    ...(document.limitationScopes === undefined ? {} : { limitationScopes: document.limitationScopes }),
    ...(document.sourceModifiedAt === undefined ? {} : { sourceModifiedAt: document.sourceModifiedAt }),
    normalizedDocumentSha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    freshness: 'unknown-source-build-alignment' };
}
function compareFields(before: DataContract, after: DataContract): ContractFieldChange[] {
  const map = (contract: DataContract) => new Map(contract.fields.map((field) => [JSON.stringify([field.in, field.path]), field]));
  const left = map(before), right = map(after);
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((key) => {
    const a = left.get(key), b = right.get(key);
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    return [{ reason: a === undefined ? 'field-added' : b === undefined ? 'field-removed' : 'field-changed',
      ...(a === undefined ? {} : { before: a }), ...(b === undefined ? {} : { after: b }) } as ContractFieldChange];
  });
}
/** 기존 이름·route 조인을 재사용하고 같은 시점의 근거에서만 호출 후보를 얻는다. */
function connectedCallers(declarations_: readonly BridgeFactsDocument[], clients: readonly BridgeFactsDocument[]) {
  const result = new Map<string, BridgeEndpoint[]>();
  const docs = declarations_.map((doc): BridgeFactsDocument => ({ ...doc, facts: doc.facts.filter(isDeclaration),
    ...(doc.target === 'http' ? { roles: ['server'] } : {}) }));
  const clientDocs = clients.map((doc): BridgeFactsDocument => ({ ...doc,
    facts: doc.facts.filter((fact) => !isDeclaration(fact)), ...(doc.target === 'http' ? { roles: ['client'] } : {}) }));
  const joined = joinBridgeDocuments([...docs, ...clientDocs], { composition: 'trace' });
  if (isBridgeJoinDeferred(joined)) throw new BridgeJoinValidationError('Contract caller join is deferred; split input domains.');
  for (const relation of joined.matchedRelations) result.set(JSON.stringify(['default', 'relation-decl', null, null, relation.channel]), [...relation.uses]);
  for (const column of joined.matchedColumns) result.set(JSON.stringify(['default', 'relation-decl', null, column.column, column.channel]), [...column.uses]);
  for (const scope of joined.routes?.scopes ?? []) {
    const callIndex = { decl: new Map<number, BridgeEndpoint[]>(), contract: new Map<number, BridgeEndpoint[]>() };
    for (const call of scope.calls) for (const side of ['decl', 'contract'] as const) {
      const outcome = call[side];
      if (outcome?.status !== 'matched' && outcome?.status !== 'ambiguous') continue;
      for (const target of outcome.targets) {
        const values = callIndex[side].get(target.id) ?? [];
        values.push(call.endpoint);
        callIndex[side].set(target.id, values);
      }
    }
    for (const declaration of [...scope.decls, ...scope.contracts]) {
      const d = declaration.declaration;
      const side = declaration.kind === 'route-contract' ? 'contract' : 'decl';
      const key = JSON.stringify([scope.scope, declaration.kind, d.anchor, d.method, d.template]);
      result.set(key, [...(result.get(key) ?? []), ...(callIndex[side].get(d.id) ?? [])]);
    }
  }
  for (const [key, items] of result) result.set(key, [...new Map(items.map((item) => [JSON.stringify(item), item])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item));
  return { callers: result, limitations: joined.limitations };
}
