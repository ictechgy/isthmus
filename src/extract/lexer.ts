/**
 * extract-js의 무의존 JS/TS 토크나이저다.
 *
 * 목적은 정적 브리지 호출 탐지이므로 완전한 문법이 아니라 브리지 API 인식에
 * 필요한 토큰 종류만 구분한다. 주석·공백은 건너뛰고, 문자열 리터럴은 해석된
 * 값을, 보간이 있는 템플릿은 값 없는 template 토큰으로 남긴다.
 */

/** 토큰의 어휘 종류다. */
export type JsTokenKind =
  | 'identifier'
  | 'keyword'
  | 'string'
  | 'template'
  | 'number'
  | 'punct'
  | 'other';

/** 소스 텍스트의 한 어휘다. line·column은 1부터 센다. */
export interface JsToken {
  readonly kind: JsTokenKind;
  /** 소스에 있던 원문이다. */
  readonly text: string;
  /**
   * 리터럴로 확정된 문자열 값이다. string과 보간 없는 template에만 있다 —
   * `dynamic: false` 사실의 이름 후보로만 쓸 수 있다.
   */
  readonly value?: string;
  /** 소스 시작점부터의 문자 오프셋이다. */
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

const keywords = new Set([
  'await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of',
  'return', 'static', 'switch', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'yield', 'from', 'as', 'get', 'set',
]);

/**
 * 한 토큰으로 묶는 복합 구두점이다 — 긴 것부터 앞에 둬야 `===`가 `=`+`==`로
 * 쪼개지지 않는다. 비교 연산이 `=`로 보이면 스캐너가 대입으로 오인해 살아 있는
 * 바인딩을 지우므로 비교·대입·증감 연산자 전부를 포함한다.
 */
const multiCharPuncts = [
  '>>>=',
  '===', '!==', '>>>', '**=', '<<=', '>>=', '&&=', '||=', '??=',
  '=>', '?.', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '...',
];

/**
 * 정규식 리터럴이 시작될 수 있는 위치인지 추정한다.
 *
 * JS 문법상 나눗셈과 정규식은 앞 토큰으로만 구분된다 — 식별자·숫자·문자열·
 * `)`·`]`·`}` 뒤의 `/`는 나눗셈이다. 잘못 판정하면 `/` 이후가 문자열로 삼켜져
 * 위치가 어긋나므로 보수적으로 나눗셈 쪽으로 본다.
 */
function isRegexPosition(previous: JsToken | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === 'identifier' || previous.kind === 'number' ||
    previous.kind === 'string' || previous.kind === 'template') {
    return false;
  }
  if (previous.kind === 'punct' &&
    (previous.text === ')' || previous.text === ']' || previous.text === '}' ||
      // `count++ / total`의 `/`는 나눗셈이다 — 증감 뒤를 정규식 위치로 보면
      // 뒤 텍스트가 통째로 삼켜진다.
      previous.text === '++' || previous.text === '--')) {
    return false;
  }
  return true;
}

/** 소스를 토큰 열로 바꾼다. 해석 불가 구간도 위치를 보존한 채 other로 남긴다. */
export function tokenizeJsSource(source: string): JsToken[] {
  const tokens: JsToken[] = [];
  let index = 0;
  let line = 1;
  let columnOffset = 0;
  let byteColumn = 1;
  const push = (kind: JsTokenKind, start: number, startLine: number,
    startColumn: number, value?: string): void => {
    tokens.push({
      kind,
      text: source.slice(start, index),
      ...(value === undefined ? {} : { value }),
      offset: start,
      line: startLine,
      column: startColumn,
    });
  };
  const advance = (end: number): void => {
    while (index < end) {
      if (source[index] === '\n') {
        line++;
      }
      index++;
    }
  };
  while (index < source.length) {
    // 어휘 분기가 index를 한 번에 옮겨도, 위치 계산은 원문을 한 번만 훑는다.
    while (columnOffset < index) {
      const point = source.codePointAt(columnOffset)!;
      byteColumn = point === 10 ? 1 : byteColumn + (point > 0xffff ? 4 : point >= 0x800 ? 3 : point >= 0x80 ? 2 : 1);
      columnOffset += point > 0xffff ? 2 : 1;
    }
    const start = index;
    const startLine = line;
    const startColumn = byteColumn;
    const char = source[index]!;
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      advance(index + 1);
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      advance(close === -1 ? source.length : close + 2);
      continue;
    }
    if (char === '/' && isRegexPosition(tokens.at(-1))) {
      // 정규식 본문을 훑는다. 문자 클래스 안의 `/`는 종료가 아니다.
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length) {
        const c = source[cursor]!;
        if (c === '\\') cursor += 2;
        else if (c === '[') { inClass = true; cursor++; }
        else if (c === ']') { inClass = false; cursor++; }
        else if (c === '/' && !inClass) { cursor++; break; }
        else if (c === '\n') break;
        else cursor++;
      }
      advance(cursor);
      push('other', start, startLine, startColumn);
      continue;
    }
    if (char === '\'' || char === '"') {
      const value = readQuoted(source, index, char);
      advance(value.end);
      if (value.closed) push('string', start, startLine, startColumn, value.text);
      else push('other', start, startLine, startColumn);
      continue;
    }
    if (char === '`') {
      const template = readTemplate(source, index);
      advance(template.end);
      push('template', start, startLine, startColumn, template.value);
      continue;
    }
    if (isIdentifierStart(char)) {
      while (index < source.length && isIdentifierPart(source[index]!)) index++;
      const text = source.slice(start, index);
      push(keywords.has(text) ? 'keyword' : 'identifier',
        start, startLine, startColumn);
      continue;
    }
    if (char >= '0' && char <= '9') {
      while (index < source.length &&
        /[A-Za-z0-9_.xXbBoO]/.test(source[index]!)) index++;
      push('number', start, startLine, startColumn);
      continue;
    }
    const multi = multiCharPuncts.find((punct) => source.startsWith(punct, index));
    if (multi !== undefined) {
      advance(index + multi.length);
      push('punct', start, startLine, startColumn);
      continue;
    }
    if (isPunct(char)) {
      index++;
      push('punct', start, startLine, startColumn);
      continue;
    }
    index++;
    push('other', start, startLine, startColumn);
  }
  return tokens;
}

/** 식별자 시작 문자다. */
function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

/** 식별자 후속 문자다. */
function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

/** 단일 문자로 읽는 구두점이다. */
function isPunct(char: string): boolean {
  return /[()[\]{}<>:;,.=!&|?+\-*%^~@#]/.test(char);
}

/** 따옴표 문자열을 읽어 해석된 값과 끝 위치를 돌려준다. */
function readQuoted(
  source: string,
  start: number,
  quote: string,
): { readonly end: number; readonly closed: boolean; readonly text: string } {
  let cursor = start + 1;
  let text = '';
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '\\') {
      const escaped = cookEscape(source, cursor);
      text += escaped.text;
      cursor = escaped.end;
      continue;
    }
    if (char === quote) return { end: cursor + 1, closed: true, text };
    if (char === '\n') return { end: cursor, closed: false, text };
    text += char;
    cursor++;
  }
  return { end: cursor, closed: false, text };
}

/**
 * 백틱 템플릿을 읽는다.
 *
 * 보간 `${...}`이 있으면 이름을 정적으로 확정할 수 없으므로 value를 두지
 * 않는다. 중첩 템플릿·중괄호 깊이를 세어 종료 백틱을 정확히 찾는다.
 */
function readTemplate(
  source: string,
  start: number,
): { readonly end: number; readonly value?: string } {
  let cursor = start + 1;
  let interpolated = false;
  let text = '';
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '\\') {
      const escaped = cookEscape(source, cursor);
      text += escaped.text;
      cursor = escaped.end;
      continue;
    }
    if (char === '`') {
      return { end: cursor + 1, ...(interpolated ? {} : { value: text }) };
    }
    if (char === '$' && source[cursor + 1] === '{') {
      interpolated = true;
      cursor = skipInterpolation(source, cursor + 2);
      continue;
    }
    text += char;
    cursor++;
  }
  return { end: cursor, ...(interpolated ? {} : { value: text }) };
}

/** `${` 뒤의 보간 본문을 중괄호 균형으로 건너뛰어 닫는 `}` 다음을 돌려준다. */
function skipInterpolation(source: string, start: number): number {
  let depth = 1;
  let cursor = start;
  while (cursor < source.length && depth > 0) {
    const char = source[cursor]!;
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '\'' || char === '"' || char === '`') {
      cursor = skipStringLike(source, cursor, char);
      continue;
    }
    // 보간 안의 주석도 중괄호 깊이에 섞이면 안 된다.
    else if (char === '/' && source[cursor + 1] === '/') {
      while (cursor < source.length && source[cursor] !== '\n') cursor++;
      continue;
    }
    else if (char === '/' && source[cursor + 1] === '*') {
      const close = source.indexOf('*/', cursor + 2);
      cursor = close === -1 ? source.length : close + 2;
      continue;
    }
    cursor++;
  }
  return cursor;
}

/** 보간 안의 문자열 계열 리터럴을 통째로 건너뛴다. */
function skipStringLike(source: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '\\') { cursor += 2; continue; }
    if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      cursor = skipInterpolation(source, cursor + 2);
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor++;
  }
  return cursor;
}

/** 이스케이프 시퀀스 하나를 해석한다. 알 수 없는 형태는 원문 그대로 둔다. */
function cookEscape(
  source: string,
  start: number,
): { readonly end: number; readonly text: string } {
  const char = source[start + 1];
  if (char === undefined) return { end: start + 1, text: '' };
  const simple: Record<string, string> = {
    n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0',
  };
  const mapped = simple[char];
  if (mapped !== undefined) return { end: start + 2, text: mapped };
  if (char === 'x') {
    const digits = source.slice(start + 2, start + 4);
    if (/^[0-9A-Fa-f]{2}$/.test(digits)) {
      return { end: start + 4, text: String.fromCharCode(parseInt(digits, 16)) };
    }
  }
  if (char === 'u') {
    const braced = source[start + 2] === '{'
      ? source.slice(start + 3, source.indexOf('}', start + 3))
      : source.slice(start + 2, start + 6);
    if (/^[0-9A-Fa-f]+$/.test(braced)) {
      const code = parseInt(braced, 16);
      if (code <= 0x10FFFF) {
        return {
          end: source[start + 2] === '{'
            ? source.indexOf('}', start + 3) + 1
            : start + 6,
          text: String.fromCodePoint(code),
        };
      }
    }
  }
  // 알려지지 않은 이스케이프는 문자 그대로다(ES에서 '\'는 사라진다).
  return { end: start + 2, text: char };
}
