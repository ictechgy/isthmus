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
