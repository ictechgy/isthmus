import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptCartographImpact, adaptDartographImpact } from './producer-impact.ts';

const metadata = { id: 'swift-1', project: '/project', requested: { files: ['ios/Camera.swift'], symbols: [] },
  tool: { name: 'cartograph', version: '1.0.0' } };

test('adapts Cartograph changeScope and affected relationships, rebasing locations', () => {
  const result = adaptCartographImpact({
    format: 'change-impact', version: 1, level: 'symbol',
    changeScope: [{ name: 'usr-root', qualifiedName: 'Camera.handle', usr: 'usr-root', location: { path: '/project/ios/Camera.swift', line: 8, column: 1 } }],
    affected: [{ symbol: { name: 'usr-child', qualifiedName: 'Widget.build', usr: 'usr-child', location: { path: '/project/lib/widget.dart', line: 2, column: 1 } }, depth: 1, via: 'usr-root', relationship: 'call', edges: ['reference'] }],
    limitations: [], truncated: { depth: false, output: false, sections: [] },
  }, metadata);
  assert.deepEqual(result.roots[0]?.location, { path: 'ios/Camera.swift', line: 8, column: 1 });
  assert.deepEqual(result.affected[0]?.relationships, ['call', 'reference']);
});

test('Dartograph의 정수 truncation·선언 위치·중첩 미귀속 파일을 보존한다', () => {
  const result = adaptDartographImpact({
    version: 1, changed: { symbols: ['Camera.call'], sources: ['lib/camera.dart'], libraries: [], unattributedSources: ['lib/unknown.dart'] },
    impacted: [{ id: 'Widget.build', depth: 1, path: ['Widget.build', 'Camera.call'], source: 'lib/widget.dart', line: 5, column: 2 }],
    limitations: ['dynamic dispatch'], truncated: 3, missingSymbols: ['Missing'],
  }, { ...metadata, id: 'dart-1', requested: { files: ['lib/camera.dart'], symbols: [] }, tool: { name: 'dartograph', version: '1.0.0' } });
  assert.deepEqual(result.roots, [{ id: 'Camera.call', qualifiedName: 'Camera.call', kind: 'declaration' }]);
  assert.equal(result.affected[0]?.via, 'Camera.call');
  assert.deepEqual(result.affected[0]?.symbol.location, { path: 'lib/widget.dart', line: 5, column: 2 });
  assert.equal(result.truncated, true);
  assert.ok(result.limitations.some((item) => item.includes('unattributed')));
  assert.ok(result.limitations.some((item) => item.includes('missing')));
});

test('Dartograph의 알려지지 않은 위치는 만들지 않고 잘못된 누락 수는 거부한다', () => {
  const raw = { version: 1, changed: { symbols: [], libraries: ['library:root'], sources: [], unattributedSources: [] },
    impacted: [{ id: 'consumer', kind: 'file', depth: 1, path: ['consumer', 'library:root'] }],
    limitations: [], truncated: 0, missingSymbols: [] };
  const meta = { ...metadata, id: 'dart', requested: { files: [], symbols: ['library:root'] } };
  const result = adaptDartographImpact(raw, meta);
  assert.equal(result.truncated, false);
  assert.equal(result.affected[0]?.symbol.location, undefined);
  for (const truncated of [true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => adaptDartographImpact({ ...raw, truncated }, meta));
  }
});

test('Cartograph의 일부 미관찰 선택과 일반 그래프 밖 검토를 숨기지 않는다', () => {
  const result = adaptCartographImpact({ format: 'change-impact', version: 1, level: 'symbol',
    changeScope: [{ usr: 'root', qualifiedName: 'Root' }], affected: [], limitations: [],
    selectionIssues: [{ requested: 'Missing', kind: 'symbol', status: 'notFound' }],
    runtimeReview: [{ symbol: { usr: 'root', qualifiedName: 'Root' } }], runtimeDependencies: [],
    truncated: { depth: false, output: false, sections: [] } }, metadata);
  assert.ok(result.limitations.some((item) => item.includes('selection-issues')));
  assert.ok(result.limitations.some((item) => item.includes('runtime-review')));
});

test('rejects missing Cartograph identities and unverifiable Dart paths', () => {
  assert.throws(() => adaptCartographImpact({
    format: 'change-impact', version: 1, level: 'symbol', changeScope: [{ name: 'x', qualifiedName: 'X' }], affected: [], limitations: [], truncated: false,
  }, metadata));
  assert.throws(() => adaptDartographImpact({
    version: 1, changed: { symbols: ['Root'] }, impacted: [{ id: 'Child', depth: 2, path: ['Child', 'Missing', 'Root'] }],
    limitations: [], truncated: true,
  }, { ...metadata, id: 'dart-1', tool: { name: 'dartograph', version: '1.0.0' } }));
});
