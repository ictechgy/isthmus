import assert from 'node:assert/strict';
import test from 'node:test';
import { templateInterpolationCode, tokenizeJsSource } from './lexer.ts';

/**
 * 렉서가 쓰는 문자열 연산(첨자·length·slice·codePointAt·startsWith·indexOf)만 흉내 내는 대역이다 — 토큰화 작업량을
 * 시간 대신 읽은 글자 수로 잰다. 첨자 읽기와 codePointAt은 1, startsWith는 비교한 길이, indexOf는 훑은 거리로 센다.
 * 렉서가 다른 문자열 속성을 쓰기 시작하면 대역에 없어 바로 실패한다(조용히 덜 세지 않는다).
 */
function countingSource(text: string): { readonly source: string; readonly reads: () => number } {
  let reads = 0;
  const methods: Readonly<Record<string, unknown>> = {
    slice: (start?: number, end?: number) => text.slice(start, end),
    codePointAt: (position: number) => {
      reads++;
      return text.codePointAt(position);
    },
    startsWith: (search: string, position = 0) => {
      reads += search.length;
      return text.startsWith(search, position);
    },
    indexOf: (search: string, position = 0) => {
      const found = text.indexOf(search, position);
      reads += (found === -1 ? text.length : found + search.length) - position;
      return found;
    },
  };
  const source = new Proxy(methods, {
    get(target, key) {
      if (key === 'length') return text.length;
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        reads++;
        return text[Number(key)];
      }
      if (typeof key === 'string' && Object.hasOwn(target, key)) return target[key];
      throw new Error(`countingSource does not support ${String(key)}`);
    },
  });
  return { source: source as unknown as string, reads: () => reads };
}

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

test('중괄호 유니코드 이스케이프는 16진수 구간 바로 뒤의 }만 닫는 괄호로 본다', () => {
  // 뒤 리터럴·다음 줄의 `}`는 이 이스케이프를 닫지 않는다 — 16진수가 아닌 첫 글자에서 판정이 끝난다.
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string, string | null]>]> = [
    ["'\\u{41' + '}'", [['string', "'\\u{41'", 'u{41'], ['punct', '+', null], ['string', "'}'", '}']]],
    ["'\\u{\\u{41}'", [['string', "'\\u{\\u{41}'", 'u{A']]],
    ["'\\u{41 }'", [['string', "'\\u{41 }'", 'u{41 }']]],
    ["'\\u{0000000041}'", [['string', "'\\u{0000000041}'", 'A']]],
    ['`\\u{1F600}` + `\\u{1F600`;\n}', [
      ['template', '`\\u{1F600}`', '😀'], ['punct', '+', null], ['template', '`\\u{1F600`', 'u{1F600'],
      ['punct', ';', null], ['punct', '}', null],
    ]],
  ];
  for (const [source, expected] of cases) {
    const tokens = tokenizeJsSource(source);
    assert.deepEqual(tokens.map((token) => [token.kind, token.text, token.value ?? null]), expected, source);
  }
});

test('닫히지 않은 \\u{ 이스케이프가 많아도 이스케이프마다 소스 끝까지 훑지 않는다', () => {
  // 닫는 `}`를 첫 `}`까지 찾으면 이스케이프마다 파일 끝의 `}`까지 훑어, 토큰화가 입력 크기의 이차였다.
  const size = 1_000;
  const unit = "'\\u{'" + '"\\u{41"' + '`\\u{1F`';
  const text = `${unit.repeat(size)}\n}`;
  const { source, reads } = countingSource(text);
  const tokens = tokenizeJsSource(source);
  assert.equal(tokens.length, 3 * size + 1);
  assert.deepEqual(
    [...new Set(tokens.map((token) => [token.kind, token.value ?? null].join(':')))],
    ['string:u{', 'string:u{41', 'template:u{1F', 'punct:'],
  );
  // 글자마다 위치 계산과 리터럴·이스케이프 판정으로 몇 번씩 읽는다(약 3.7배, 크기와 무관). 이스케이프마다 파일 끝까지
  // 훑으면 약 2,860만 번(약 1,500배)이다.
  assert.ok(reads() <= 8 * text.length, `character reads ${reads()} for ${text.length} characters`);
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

test('value 키는 닫힌 문자열과 보간 없는 템플릿 토큰에만 있고 키 순서는 고정이다', () => {
  const tokens = tokenizeJsSource("const a = '' + 'x' + `y` + `z${w}` + /r/ + 1;\n'open");
  assert.deepEqual(
    tokens.filter((token) => 'value' in token).map((token) => [token.kind, token.text, token.value]),
    [['string', "''", ''], ['string', "'x'", 'x'], ['template', '`y`', 'y']],
  );
  assert.deepEqual(Object.keys(tokens[0]!), ['kind', 'text', 'offset', 'line', 'column']);
  assert.deepEqual(
    Object.keys(tokens.find((token) => token.kind === 'string')!),
    ['kind', 'text', 'value', 'offset', 'line', 'column'],
  );
  assert.equal(tokens.at(-1)?.kind, 'other');
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

test('보간 본문 코드를 조각마다 꺼내고 중첩 템플릿의 글자 부분은 빼며 경계는 토크나이저와 같다', () => {
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['`a${M = other}b${ N.take() }c`', ['M = other', ' N.take() ']],
    // 보간 안 문자열·주석 속 중괄호·백틱은 경계가 아니고 조각에 그대로 남는다(다시 토큰화하면 문자열·주석이다).
    ['`${ f("}") /* } ` */ + g(\'{\') }`', [' f("}") /* } ` */ + g(\'{\') ']],
    ['`${ a // } `\n }`', [' a // } `\n ']],
    // 중첩 템플릿의 글자 부분은 어느 조각에도 없고 자리는 빈 템플릿이다(다시 토큰화하면 템플릿 토큰 — 태그 호출 `tag\`…\``의
    // 대상을 가른다). 그 안의 보간은 따로 한 조각이다.
    ['`${ wrap(`x${M}y`) }`', [' wrap(``) ', 'M']],
    ['`${ M`t`.length + (n = 1) }`', [' M``.length + (n = 1) ']],
    ['`${ { a: 1 }.a }`', [' { a: 1 }.a ']],
    // 이스케이프한 `${`는 보간이 아니고, 이스케이프한 백슬래시 뒤의 `${`는 보간이다.
    ['`\\${x}`', []],
    ['`\\\\${x}`', ['x']],
    // 닫히지 않은 보간은 원문 끝까지다.
    ['`${ M = other', [' M = other']],
  ];
  for (const [text, expected] of cases) {
    assert.deepEqual(templateInterpolationCode(text), expected, text);
    // 토크나이저가 같은 원문을 템플릿 토큰 하나로 읽는다(경계가 같다).
    assert.equal(tokenizeJsSource(text)[0]?.text, text, text);
  }
});

test('깊게 중첩된 템플릿의 보간 코드도 원문 길이에 선형으로 꺼낸다', () => {
  // 조각마다 중첩 템플릿을 다시 꺼내면 중첩 깊이마다 안쪽 원문을 다시 읽어 이차다 — 원문 글자는 많아야 한 조각에 든다.
  const depth = 20_000;
  const text = `\`${'${ f(`'.repeat(depth)}\${M = x}${'`) }'.repeat(depth)}\``;
  const { source, reads } = countingSource(text);
  const segments = templateInterpolationCode(source);
  assert.equal(segments.length, depth + 1);
  assert.equal(segments[0], ' f(``) ');
  assert.equal(segments.at(-1), 'M = x');
  assert.ok(reads() <= 4 * text.length, `character reads ${reads()} for ${text.length} characters`);
});

test('보간 안 정규식 리터럴의 따옴표·백틱·중괄호·슬래시는 템플릿 경계가 아니다', () => {
  // 정규식을 읽지 않던 보간 건너뛰기는 `/"/g`의 `"`를 문자열 시작으로, `/\//g`의 `//`를 줄 주석으로, `/{/`의 `{`를 깊이로
  // 읽어 템플릿이 파일 뒤쪽까지 이어졌다(react-native 0.88.1 `scripts/spm/*.js`의 꼴) — 그 뒤 코드의 사실이 조용히 사라졌다.
  const regexes: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["`${s.replace(/\"/g, '')}`", ["s.replace(/\"/g, '')"]],
    ["`${s.replace(/'/g, '')}`", ["s.replace(/'/g, '')"]],
    ["`${p.replace(/\\//g, '.')}`", ["p.replace(/\\//g, '.')"]],
    ["`${p.replace(/\\/\"/g, '.')}`", ["p.replace(/\\/\"/g, '.')"]],
    ["`${s.replace(/`/g, '')}`", ["s.replace(/`/g, '')"]],
    ["`${s.replace(/{/g, '')}x`", ["s.replace(/{/g, '')"]],
    ["`${s.replace(/}/g, '')}x`", ["s.replace(/}/g, '')"]],
    ["`${s.replace(/[/\"]/g, '')}`", ["s.replace(/[/\"]/g, '')"]],
    ["`${s.replace(/\\${/g, '')}`", ["s.replace(/\\${/g, '')"]],
    // 식 앞 예약어·연산자·화살표 뒤도 정규식 자리다. 중첩 템플릿 안 보간도 같다.
    ['`${typeof /"/}`', ['typeof /"/']],
    ["`${a ?? /'/}`", ["a ?? /'/"]],
    ['`${(x) => /"/.test(x)}`', ['(x) => /"/.test(x)']],
    ['`${`in${s.replace(/"/g, "")}`}`', ['``', 's.replace(/"/g, "")']],
    // 여러 줄로 이어진 메서드 사슬(react-native `quoteIfNeeded`)이다.
    ["`\"${s\n  .replace(/\\\\/g, '\\\\\\\\')\n  .replace(/\"/g, '\\\\\"')}\"`",
      ["s\n  .replace(/\\\\/g, '\\\\\\\\')\n  .replace(/\"/g, '\\\\\"')"]],
  ];
  // 값 뒤의 `/`는 나눗셈이라 그 뒤 따옴표·중괄호를 삼키지 않는다 — 이름(문맥 키워드 `get`·`set`, 속성 자리 예약어 포함)·
  // 숫자·리터럴·정규식·닫는 괄호·증감·TS non-null 단언 뒤, JSX 닫는 태그(`</a>`)도 그렇다. 같은 줄에서 닫히지 않는 후보(`/[`)는
  // 전처럼 나눗셈이다. 템플릿 글자와 뒤에 붙이는 코드에 `/`가 있어 나눗셈을 정규식으로 잘못 읽으면 그 `/`에서 닫혀 경계가
  // 어긋난다.
  const divisions: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['`${a / b}"${c}"/`', ['a / b', 'c']],
    ['`${get / 2}"${set / 3}"/`', ['get / 2', 'set / 3']],
    ['`${x.get / 2 / 3}"/`', ['x.get / 2 / 3']],
    ['`${x.return / 2}"/`', ['x.return / 2']],
    ['`${(a) / 2}"/`', ['(a) / 2']],
    ['`${xs[0] / 2}"/`', ['xs[0] / 2']],
    ['`${{ a: 1 } / 2}"/`', ['{ a: 1 } / 2']],
    ["`${'a' / 2}\"/`", ["'a' / 2"]],
    ['`${`a` / 2}"/`', ['`` / 2']],
    ['`${/a/g / 2}"/`', ['/a/g / 2']],
    ['`${1.5e3 / 2}"/`', ['1.5e3 / 2']],
    ['`${café / 2}"/`', ['café / 2']],
    ['`${i++ / 2}"${j}"/`', ['i++ / 2', 'j']],
    ['`${(done! / total!) * 100}%"/`', ['(done! / total!) * 100']],
    ['`${a !== /"/}`', ['a !== /"/']],
    ['`${<a>{x}</a>}"/`', ['<a>{x}</a>']],
    ['`${f(/[)}"/`', ['f(/[)']],
  ];
  for (const [text, segments] of [...regexes, ...divisions]) {
    const tokens = tokenizeJsSource(`${text}; after('"', "}", a / b);`);
    assert.deepEqual(tokens.slice(0, 3).map((token) => [token.kind, token.text]),
      [['template', text], ['punct', ';'], ['identifier', 'after']], text);
    // 보간 코드 조각도 같은 경계로 꺼낸다(정규식은 조각에 그대로 남는다).
    assert.deepEqual(templateInterpolationCode(text), segments, text);
  }
  // 정규식 리터럴은 줄을 넘지 못한다 — 다음 줄의 `/`에서 닫힌 것으로 보지 않는다.
  const unclosed = tokenizeJsSource('`${f(/x)}"`;\nafter(a / b);');
  assert.deepEqual(unclosed.slice(0, 3).map((token) => token.text), ['`${f(/x)}"`', ';', 'after']);
});

test('보간 안의 닫히지 않는 정규식 후보가 많아도 후보마다 줄 끝까지 다시 훑지 않는다', () => {
  // 한 줄에 템플릿이 많고 템플릿마다 같은 줄에서 닫히지 않는 후보(`/[`)가 있으면 후보마다 줄 끝까지 훑어 이차였다. 실패한
  // 경로를 (위치, 문자 클래스 안 여부)로 기억해 나중 후보는 그 자리에 닿으면 멈춘다.
  const size = 2_000;
  const text = `const t = [${'`${(/[}`, '.repeat(size)}];\nafter();`;
  const { source, reads } = countingSource(text);
  const tokens = tokenizeJsSource(source);
  assert.equal(tokens.filter((token) => token.kind === 'template').length, size);
  assert.equal(tokens.at(-4)?.text, 'after');
  // 토큰화는 글자마다 위치 계산·구두점 판정으로 여러 번 읽는다(main도 이 입력에서 약 11배, 이 판정을 더해 약 14배 — 크기와
  // 무관). 후보마다 줄 끝까지 훑으면 크기의 약 1,000배다.
  assert.ok(reads() <= 20 * text.length, `character reads ${reads()} for ${text.length} characters`);
  const template = `\`${'${(/[}'.repeat(size)}\``;
  const counted = countingSource(template);
  assert.equal(templateInterpolationCode(counted.source).length, size);
  assert.ok(counted.reads() <= 8 * template.length, `character reads ${counted.reads()} for ${template.length} characters`);
});
