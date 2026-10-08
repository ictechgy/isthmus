import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from './parse.ts';
import { parseNavigationFactsDocument, NavigationValidationError } from './navigation.ts';

const input = () => ({ format: 'navigation-facts', version: 1, tool: { name: 'tsograph', version: 'test' },
  generatedAt: '2026-01-01T00:00:00.000Z', platform: 'js', project: '/work/example',
  facts: [{ kind: 'screen-route', urlTemplate: '/catalog/{}', dynamic: false,
    location: { path: 'src/router.ts', line: 3, column: 1 }, screen: { usr: 'src/screen.ts#Catalog', qualifiedName: 'Catalog' } }],
  limitations: [],
});

test('navigation URLs and graph symbols are separate from backend route declarations', () => {
  const document = parseNavigationFactsDocument(input());
  assert.equal(document.facts[0]?.urlTemplate, '/catalog/{}');
  assert.equal(document.facts[0]?.screen?.usr, 'src/screen.ts#Catalog');
  assert.throws(() => parseBridgeFactsDocument(input()));
});

test('navigation parsing rejects unsafe locations, missing identities and undeclared fields', () => {
  for (const edit of [
    (value: any) => { value.facts[0].location.path = '../outside.ts'; },
    (value: any) => { value.facts[0].screen.usr = ''; },
    (value: any) => { value.facts[0].method = 'GET'; },
    (value: any) => { value.facts[0].urlTemplate = 'relative'; },
    (value: any) => { value.tool.extra = true; },
    (value: any) => { value.generatedAt = 'not-time'; },
    (value: any) => { value.platform = 'sql'; },
  ]) {
    const value = input(); edit(value);
    assert.throws(() => parseNavigationFactsDocument(value), NavigationValidationError);
  }
});

test('dynamic screen mapping retains uncertainty rather than a guessed symbol', () => {
  const value = input();
  const raw = { ...value, facts: [{ kind: 'screen-route', urlTemplate: null, dynamic: true,
    location: value.facts[0]!.location }] };
  assert.equal(parseNavigationFactsDocument(raw).facts[0]?.screen, undefined);
  assert.throws(() => parseNavigationFactsDocument({ ...raw, facts: [{ ...raw.facts[0], dynamic: false }] }), NavigationValidationError);
});
