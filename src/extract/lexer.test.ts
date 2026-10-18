import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenizeJsSource } from './lexer.ts';

test('토큰 열은 UTF-8 바이트이고 원문 offset은 UTF-16을 유지한다', () => {
  const prefix = "'한글😀'; ";
  const source = prefix + 'NativeModules.Camera.open();\n/*é*/ emitter();\n😀 receiver';
  const tokens = tokenizeJsSource(source);
  const module = tokens.find(({ text }) => text === 'NativeModules')!;
  assert.equal(module.column, Buffer.byteLength(prefix) + 1);
  assert.equal(module.offset, prefix.length);
  assert.equal(tokens.find(({ text }) => text === 'emitter')?.column, Buffer.byteLength('/*é*/ ') + 1);
  assert.equal(tokens.find(({ text }) => text === 'receiver')?.column, Buffer.byteLength('😀 ') + 1);
  assert.equal(tokens.find(({ text }) => text === 'receiver')?.line, 3);
});

test('식별자·키워드·문자열을 위치와 함께 토큰화한다', () => {
  const tokens = tokenizeJsSource(
    "const name = requireNativeComponent('X');\nimport { NativeModules } from 'react-native';",
  );
  assert.equal(tokens[0]?.kind, 'keyword');
  assert.equal(tokens[0]?.text, 'const');
  const string = tokens.find((token) => token.kind === 'string');
  assert.equal(string?.value, 'X');
  assert.equal(string?.line, 1);
  assert.equal(tokens.at(-1)?.text, ';');
  assert.equal(tokens.at(-1)?.line, 2);
});

test('줄·블록 주석은 토큰을 만들지 않는다', () => {
  const tokens = tokenizeJsSource(
    '// requireNativeComponent(\'Fake\')\n/* NativeModules.Fake */ real',
  );
  assert.deepEqual(tokens.map((token) => token.text), ['real']);
});

test('보간 없는 템플릿은 값을, 보간 있는 템플릿은 값 없이 읽는다', () => {
  const tokens = tokenizeJsSource('`Plain` + `Has${inner}`');
  assert.equal(tokens[0]?.kind, 'template');
  assert.equal(tokens[0]?.value, 'Plain');
  assert.equal(tokens[2]?.kind, 'template');
  assert.equal(tokens[2]?.value, undefined);
});

test('보간 안의 주석과 중첩 중괄호가 종료 백틱 판정을 깨지 않는다', () => {
  const tokens = tokenizeJsSource(
    'const s = `a${ { x: 1 } /* } { */ }b`; call()',
  );
  const template = tokens.find((token) => token.kind === 'template');
  assert.equal(template?.value, undefined);
  assert.equal(tokens.at(-3)?.text, 'call');
  assert.equal(tokens.at(-2)?.text, '(');
  assert.ok(tokens.at(-3)?.line === 1);
});

test('정규식 위치의 /는 리터럴을 한 토큰으로 삼키고 나눗셈은 한 글자만 뗀다', () => {
  const tokens = tokenizeJsSource('a / b; const r = /a[/]b/; c');
  const slash = tokens.find((token) => token.text === '/');
  assert.equal(slash?.kind, 'other');
  // 문자 클래스 안의 `/`를 종료로 오인하면 이 토큰이 여럿으로 쪼개진다.
  const regex = tokens.find((token) => token.text === '/a[/]b/');
  assert.equal(regex?.kind, 'other');
  assert.equal(tokens.at(-1)?.text, 'c');
});

test('닫히지 않은 문자열은 other로 남기고 뒤 위치를 보존한다', () => {
  const tokens = tokenizeJsSource("const s = 'open\nnext()");
  assert.equal(tokens.find((token) => token.text.includes('open'))?.kind, 'other');
  assert.equal(tokens.at(-3)?.text, 'next');
  assert.equal(tokens.at(-3)?.line, 2);
});

test('이스케이프 시퀀스를 해석된 값으로 읽는다', () => {
  const tokens = tokenizeJsSource(String.raw`'a\nb' + 'xA' + 'A'`);
  const strings = tokens.filter((token) => token.kind === 'string');
  assert.equal(strings[0]?.value, 'a\nb');
  assert.equal(strings[1]?.value, 'xA');
  assert.equal(strings[2]?.value, 'A');
});

test('닫는 괄호 뒤의 /는 나눗셈으로 읽어 정규식으로 삼키지 않는다', () => {
  const tokens = tokenizeJsSource('(a) / b; { c / d }');
  const slashes = tokens.filter((token) => token.text === '/');
  // 정규식 위치가 아니면 한 글자 토큰만 생긴다.
  assert.equal(slashes.length, 2);
  assert.ok(slashes.every((token) => token.kind === 'other'));
});

test('숫자·복합 구두점·비해석 이스케이프를 토큰화한다', () => {
  const tokens = tokenizeJsSource("0x1F => 1.5 ...rest?.x 'a\\q'");
  assert.equal(tokens[0]?.kind, 'number');
  assert.equal(tokens[1]?.text, '=>');
  assert.equal(tokens[3]?.text, '...');
  assert.equal(tokens[5]?.text, '?.');
  // 알 수 없는 이스케이프는 `\`가 사라진 문자다.
  assert.equal(tokens.at(-1)?.value, 'aq');
});

test('닫히지 않은 템플릿과 보간 안 문자열의 중괄호를 견딘다', () => {
  const unterminated = tokenizeJsSource('`never closed');
  assert.equal(unterminated[0]?.kind, 'template');
  const tokens = tokenizeJsSource("`a${'b}c'}d` end");
  assert.equal(tokens.at(-1)?.text, 'end');
});

test('비교·증감·복합 대입 연산자가 한 토큰이다', () => {
  const tokens = tokenizeJsSource("a === b !== c++ --d += e");
  assert.deepEqual(
    tokens.map((token) => token.text),
    ['a', '===', 'b', '!==', 'c', '++', '--', 'd', '+=', 'e'],
  );
});

test('닫히지 않은 \\u{ 이스케이프는 알 수 없는 이스케이프로 읽고 커서를 되돌리지 않는다', () => {
  // 닫는 `}`가 없고 뒤가 16진수뿐이면 끝 위치가 0으로 계산돼 같은 따옴표를 끝없이 다시 읽었다.
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string, string | null]>]> = [
    ['x;\n"\\u{41"', [['identifier', 'x', null], ['punct', ';', null], ['string', '"\\u{41"', 'u{41']]],
    ['x;\n"\\u{41\n', [['identifier', 'x', null], ['punct', ';', null], ['other', '"\\u{41', null]]],
    ['const a=`x`;\n`\\u{41`', [
      ['keyword', 'const', null], ['identifier', 'a', null], ['punct', '=', null],
      ['template', '`x`', 'x'], ['punct', ';', null], ['template', '`\\u{41`', 'u{41'],
    ]],
  ];
  for (const [source, expected] of cases) {
    const tokens = tokenizeJsSource(source);
    assert.deepEqual(tokens.map((token) => [token.kind, token.text, token.value ?? null]), expected, source);
    assert.ok(tokens.every((token, index) => index === 0 || token.offset > tokens[index - 1]!.offset), source);
  }
});

test('중괄호 유니코드 이스케이프는 범위 안의 16진수만 코드 포인트로 읽는다', () => {
  const tokens = tokenizeJsSource("'\\u{41}' + '\\u{1F600}' + '\\u{}' + '\\u{110000}' + '\\u{4G}'");
  assert.deepEqual(
    tokens.filter((token) => token.kind === 'string').map((token) => token.value),
    ['A', '😀', 'u{}', 'u{110000}', 'u{4G}'],
  );
});

test('보간 안의 문자열·주석·이스케이프·중첩 템플릿을 건너뛰어 종료 백틱을 찾는다', () => {
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
    // 중첩 템플릿 안 보간의 문자열·블록 주석 속 `}`, 이스케이프된 백틱, 줄 주석 속 백틱은 경계가 아니다.
    ['const s = `a${ `b${ "x}" /* } */ }c\\`` // `\n}d`; after()', [
      ['keyword', 'const'], ['identifier', 's'], ['punct', '='],
      ['template', '`a${ `b${ "x}" /* } */ }c\\`` // `\n}d`'],
      ['punct', ';'], ['identifier', 'after'], ['punct', '('], ['punct', ')'],
    ]],
    // 보간 안의 따옴표 문자열은 줄바꿈에서 멈추지 않는다.
    ["`${ 'p\nq}' }e`; next", [['template', "`${ 'p\nq}' }e`"], ['punct', ';'], ['identifier', 'next']]],
    // 닫히지 않은 중첩과 끝의 백슬래시는 소스 끝까지 한 토큰이다.
    ['`${ `x${ {', [['template', '`${ `x${ {']]],
    ['`${ "\\', [['template', '`${ "\\']]],
  ];
  for (const [source, expected] of cases) {
    const tokens = tokenizeJsSource(source);
    assert.deepEqual(tokens.map((token) => [token.kind, token.text]), expected, source);
    assert.ok(tokens.every((token) => token.kind !== 'template' || token.value === undefined), source);
  }
});

test('깊게 중첩된 템플릿도 호출 스택을 넘기지 않고 한 template 토큰으로 읽는다', () => {
  const depth = 10_000;
  const nested = '`${'.repeat(depth) + '`x`' + '}`'.repeat(depth);
  const tokens = tokenizeJsSource(`${nested};after`);
  assert.deepEqual(
    tokens.map((token) => [token.kind, token.text, token.value ?? null]),
    [['template', nested, null], ['punct', ';', null], ['identifier', 'after', null]],
  );
});

test('증감 연산 뒤의 /는 정규식이 아니라 나눗셈이다', () => {
  const tokens = tokenizeJsSource('count++ / total');
  // `/`는 구두점 집합에 없어 나눗셈도 정규식도 other로 남는다 — 중요한 것은
  // 정규식으로 삼켜 뒤 토큰을 잃지 않는 것이다.
  assert.deepEqual(
    tokens.map((token) => [token.kind, token.text]),
    [
      ['identifier', 'count'],
      ['punct', '++'],
      ['other', '/'],
      ['identifier', 'total'],
    ],
  );
});
