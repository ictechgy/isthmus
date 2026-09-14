import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptKartographImpact } from './kartograph-impact.ts';

const metadata = { id: 'kotlin-0', project: '/app', tool: { name: 'kartograph', version: '1' },
  requested: { files: ['android/Helper.kt'], symbols: [] } };
const node = (usr: string) => ({ usr, qualifiedName: `demo.${usr}`, kind: 'method', presentIn: ['current'],
  observedIn: ['current'], location: { path: `android/${usr}.kt`, line: 1, column: 1 },
  pathStatus: 'complete', pathOmissions: [], paths: [] as unknown[] });
const path = (ids: string[]) => ({ revision: 'current', changed: ids.at(-1), nodes: ids,
  edges: ids.slice(0, -1).map((id, index) => ({ source: id, target: ids[index + 1], kind: 'call',
    origin: 'bytecode', traversal: 'dependency' })) });
const report = () => ({ format: 'kartograph-impact', version: 1, status: 'found', inputs: { current: { revision: 'a'.repeat(40), scope: 'fixture' } },
  changed: [node('Helper')], affected: [
    { ...node('Handler'), paths: [path(['Handler', 'Helper'])] },
    { ...node('Entry'), paths: [path(['Entry', 'Handler', 'Helper'])] },
  ], unresolved: [] as unknown[], limitations: ['potential-impact: review candidates'],
  truncated: { results: false, depth: false, budget: false }, navigation: { offset: 0, hasNext: false, hasPrevious: false } });

test('Kotlin 실제 의존 경로를 역방향 영향 숲으로 만들고 런타임 origin을 보존한다', () => {
  const raw = report();
  raw.affected[0]!.paths[0]!.edges[0]!.origin = 'runtimeModel';
  const result = adaptKartographImpact(raw, metadata);
  assert.equal(result.platform, 'kotlin');
  assert.equal(result.roots[0]?.id, 'Helper');
  assert.equal(result.affected.find(({ symbol }) => symbol.id === 'Entry')?.via, 'Handler');
  assert.equal(result.affected.find(({ symbol }) => symbol.id === 'Entry')?.depth, 2);
  assert.ok(result.affected.find(({ symbol }) => symbol.id === 'Handler')?.relationships.includes('origin:runtimeModel'));
  assert.deepEqual(result.limitations, raw.limitations);
  assert.equal(result.truncated, false);
});

test('이전 시점만 있는 경로와 누락된 중간 심볼을 현재 의존성으로 만들지 않는다', () => {
  const raw = report();
  raw.affected[0]!.paths[0]!.revision = 'base';
  raw.affected[1]!.paths = [path(['Entry', 'Missing', 'Helper'])];
  const result = adaptKartographImpact(raw, metadata);
  assert.deepEqual(result.affected, []);
  assert.equal(result.truncated, true);
  assert.ok(result.limitations.some((value) => value.startsWith('kartograph-unrepresented-paths:')));
  assert.throws(() => adaptKartographImpact({ ...raw, inputs: { ...raw.inputs, base: {} } }, metadata), /current/i);
});

test('이전 시점에만 있는 심볼의 생략을 두 번 세지 않는다', () => {
  const raw = report();
  const result = adaptKartographImpact({ ...raw, affected: [{ ...node('Removed'), presentIn: ['base'] }] }, metadata);
  assert.ok(result.limitations.some((value) => value.startsWith('kartograph-unrepresented-paths: 1 ')));
  assert.equal(result.truncated, true);
});

test('경로 생략·페이지 잘림·찾지 못한 선택은 공백으로 보존한다', () => {
  const raw = report();
  const missing = adaptKartographImpact({ ...raw, changed: [], affected: [], status: 'notFound',
    unresolved: [{ requested: 'Missing', reason: 'notFound', candidates: [] }],
    truncated: { ...raw.truncated, results: true }, navigation: { offset: 1, hasNext: true, hasPrevious: true } }, metadata);
  assert.equal(missing.truncated, true);
  assert.ok(missing.limitations.some((value) => value.startsWith('kartograph-unresolved:')));
  const partial = adaptKartographImpact({ ...raw, affected: [{ ...raw.affected[0], pathStatus: 'partial',
    pathOmissions: [{ revision: 'current', reason: 'pathBudget', requiredEdges: 3 }] }] }, metadata);
  assert.equal(partial.truncated, true);
});

test('위조한 경로 방향·순환·타입·신원 충돌을 거부한다', () => {
  const raw = report();
  for (const invalid of [
    { ...raw, version: 2 }, { ...raw, status: 'invented' },
    { ...raw, changed: [...raw.changed, node('Helper')] },
    { ...raw, truncated: { results: 'no', depth: false, budget: false } },
    { ...raw, affected: [{ ...node('Handler'), paths: [path(['Handler', 'Handler', 'Helper'])] }] },
    { ...raw, affected: [{ ...node('Handler'), paths: [{ ...path(['Handler', 'Helper']), edges: [] }] }] },
    { ...raw, affected: [{ ...node('Handler'), paths: [{ ...path(['Handler', 'Helper']), changed: 'Other' }] }] },
    { ...raw, affected: [{ ...node('Handler'), paths: [{ ...path(['Handler', 'Helper']), edges: [
      { source: 'Other', target: 'Helper', kind: 'call', origin: 'bytecode', traversal: 'dependency' },
    ] }] }] },
    { ...raw, affected: [{ ...node('Handler'), paths: [{ ...path(['Handler', 'Helper']), edges: [
      { source: 'Helper', target: 'Handler', kind: 'call', origin: 'bytecode', traversal: 'overrideContract' },
    ] }] }] },
  ]) assert.throws(() => adaptKartographImpact(invalid, metadata));
});

test('반대 방향 override 근거를 임의 호출로 바꾸지 않는다', () => {
  const raw = report();
  raw.affected[0]!.paths[0]!.edges[0] = { source: 'Helper', target: 'Handler', kind: 'override',
    origin: 'bytecode', traversal: 'overrideContract' };
  assert.ok(adaptKartographImpact(raw, metadata).affected[0]?.relationships.includes('traversal:overrideContract'));
});

test('소스 위치를 알 수 없으면 신원을 유지하고 위치 공백을 알린다', () => {
  const raw = report();
  raw.changed[0]!.location.path = '/outside/Helper.kt';
  const result = adaptKartographImpact(raw, metadata);
  assert.equal(result.roots[0]?.location, undefined);
  assert.ok(result.limitations.some((value) => value.startsWith('kartograph-unresolved-locations:')));
});

test('JVM의 line-only 위치는 열 번호를 만들지 않고 소스 경로와 줄을 보존한다', () => {
  const raw = report();
  const result = adaptKartographImpact({ ...raw, changed: [{ ...raw.changed[0],
    location: { path: 'android/Helper.kt', line: 19, column: null } }] }, metadata);
  assert.deepEqual(result.roots[0]?.location, { path: 'android/Helper.kt', line: 19 });
  assert.ok(result.limitations.some((value) => value.startsWith('kartograph-partial-source-locations:')));
});
