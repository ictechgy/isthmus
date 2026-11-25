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
  // 템플릿 보간 안 정규식 후보의 실패 경로를 원문 전체에서 함께 기억한다(템플릿이 많은 긴 한 줄도 선형이다).
  const regexMemo = new RegexFailureMemo(source.length);
  let index = 0;
  let line = 1;
  let columnOffset = 0;
  let byteColumn = 1;
  // 토큰마다 조건부 스프레드로 임시 객체를 만들면 추출 시간의 큰 몫을 차지한다 —
  // 키 집합과 순서가 같은 고정 리터럴 두 개로 만든다.
  const push = (kind: JsTokenKind, start: number, startLine: number,
    startColumn: number, value?: string): void => {
    const text = source.slice(start, index);
    tokens.push(value === undefined
      ? { kind, text, offset: start, line: startLine, column: startColumn }
      : { kind, text, value, offset: start, line: startLine, column: startColumn });
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
    // 리터럴 읽기가 끝 위치를 잘못 주더라도 한 글자는 전진해 같은 위치를 다시 읽지 않는다.
    if (char === '\'' || char === '"') {
      const value = readQuoted(source, index, char);
      advance(Math.max(value.end, start + 1));
      if (value.closed) push('string', start, startLine, startColumn, value.text);
      else push('other', start, startLine, startColumn);
      continue;
    }
    if (char === '`') {
      const template = readTemplate(source, index, regexMemo);
      advance(Math.max(template.end, start + 1));
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
      // 이스케이프 해석이 커서를 되돌리거나 세우면 같은 위치를 끝없이 다시 읽는다.
      cursor = Math.max(escaped.end, cursor + 1);
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
  regexMemo: RegexFailureMemo,
): { readonly end: number; readonly value?: string } {
  let cursor = start + 1;
  let interpolated = false;
  let text = '';
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === '\\') {
      const escaped = cookEscape(source, cursor);
      text += escaped.text;
      cursor = Math.max(escaped.end, cursor + 1);
      continue;
    }
    if (char === '`') {
      return { end: cursor + 1, ...(interpolated ? {} : { value: text }) };
    }
    if (char === '$' && source[cursor + 1] === '{') {
      interpolated = true;
      cursor = skipInterpolation(source, cursor + 2, regexMemo);
      continue;
    }
    text += char;
    cursor++;
  }
  return { end: cursor, ...(interpolated ? {} : { value: text }) };
}

/**
 * 보간 본문에서 바로 앞 코드가 끝난 모양이다 — 다음 `/`가 정규식 리터럴의 시작인지 가른다. `value`는 값이 끝난
 * 자리(이름·숫자·리터럴·닫는 괄호·증감 뒤)라 `/`가 나눗셈이고, `operator`는 값이 시작될 자리(보간 시작·연산자·여는
 * 괄호·식 앞 예약어 뒤)라 정규식이며, `dot`은 속성 이름이 올 자리(`.` 뒤)라 그 뒤 예약어도 이름이다.
 */
type InterpolationPrevious = 'value' | 'operator' | 'dot';

/**
 * 뒤에 식이 오는 예약어다 — 이 낱말 뒤의 `/`는 정규식 리터럴이다(`typeof /x/`, `return /x/.test(s)`). 토크나이저의
 * keywords와 달리 문맥 키워드(`get`·`set`·`of`·`as`·`from`·`async`·`static`)는 넣지 않는다 — 보간 안에서는 대개 값 이름이라
 * (`size.get / 2`) 그 뒤 `/`를 정규식으로 읽으면 나눗셈이 보간 끝을 삼킬 수 있다.
 */
const expressionKeywords = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'return', 'throw', 'typeof', 'void', 'yield',
]);

/**
 * 닫히지 않은 정규식 후보가 지나간 (위치, 문자 클래스 안 여부)를 원문 하나에 대해 기억한다. 같은 위치·상태에서 훑으면
 * 결과가 같으므로 나중 후보가 그 자리에 닿으면 바로 닫히지 않는다고 판정한다 — 판정은 바꾸지 않고, 닫히지 않는 후보가
 * 많은 긴 한 줄(압축된 코드)에서 후보마다 줄 끝까지 다시 훑는 이차 시간만 없앤다. 자리마다 상태별로 많아야 한 번 표시한다.
 */
class RegexFailureMemo {
  /** 표시할 원문의 길이다. */
  private readonly length: number;
  /** 위치마다 1(클래스 밖)·2(클래스 안) 비트다. 첫 실패 때 만든다. */
  private marks: Uint8Array | undefined;

  /** @param length 표시할 원문의 길이다. */
  constructor(length: number) {
    this.length = length;
  }

  /** 그 위치·상태에서 시작한 훑기가 닫히지 않는다고 알려져 있는지 본다. */
  failsFrom(position: number, inClass: boolean): boolean {
    return this.marks !== undefined && (this.marks[position]! & (inClass ? 2 : 1)) !== 0;
  }

  /** 닫히지 않은 훑기가 그 위치를 그 상태로 지나갔다고 표시한다. */
  markFailed(position: number, inClass: boolean): void {
    this.marks ??= new Uint8Array(this.length);
    this.marks[position]! |= inClass ? 2 : 1;
  }
}

/** 정규식 리터럴이 넘지 못하는 줄 끝 글자다. */
function isLineTerminator(char: string | undefined): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/**
 * `start`의 `/`에서 정규식 리터럴을 읽어 같은 줄에서 닫히면 플래그 뒤 위치를, 닫히지 않으면 undefined를 돌려준다. 문자
 * 클래스 안의 `/`와 이스케이프한 글자는 끝이 아니다. 닫히지 않으면 같은 경로를 다시 따라가며 memo에 표시한다.
 */
function readRegexLiteral(source: string, start: number, memo: RegexFailureMemo): number | undefined {
  const walk = (mark: boolean): number | undefined => {
    let cursor = start + 1;
    let inClass = false;
    while (cursor < source.length && !memo.failsFrom(cursor, inClass)) {
      if (mark) memo.markFailed(cursor, inClass);
      const char = source[cursor]!;
      if (isLineTerminator(char) || (char === '\\' && (cursor + 1 >= source.length || isLineTerminator(source[cursor + 1])))) {
        return undefined;
      }
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        cursor++;
        while (cursor < source.length && isIdentifierPart(source[cursor]!)) cursor++;
        return cursor;
      }
      cursor++;
    }
    return undefined;
  };
  const end = walk(false);
  if (end === undefined) walk(true);
  return end;
}

/**
 * 보간 본문에서 중괄호·따옴표·백틱·주석이 아닌 코드 한 단위를 읽고 다음 위치를 돌려준다 — 공백 하나, 낱말·숫자 하나,
 * 정규식 리터럴 하나, `++`·`--` 하나, 그 밖의 글자 하나다. frame.previous를 그 단위 뒤의 모양으로 바꾼다.
 *
 * 정규식 리터럴을 통째로 건너뛰는 것이 목적이다 — 그 안의 따옴표·백틱·중괄호·`//`(`` `${s.replace(/"/g, '')}` ``,
 * `/\//g`, `/{/`)를 문자열·템플릿·깊이·주석으로 읽으면 보간 끝을 놓쳐 템플릿이 파일 뒤쪽까지 이어졌고, 그 뒤 코드의
 * 사실과 계수가 조용히 사라졌다. 정규식인지는 토크나이저(isRegexPosition)처럼 앞 코드로 가르되 앞이 연산자·여는 괄호·
 * 보간 시작·식 앞 예약어일 때만 정규식 자리로 본다. 같은 줄에서 닫히지 않는 후보는 나눗셈으로 본다(전과 같은 읽기다) —
 * 정규식이 아닌 `/`(깨진 코드 등)가 줄 끝까지 삼키지 않게 한다. 판정은 앞 코드와 그 위치부터 줄 끝까지의 글자로만
 * 정해지므로(memo는 판정을 바꾸지 않는다) 같은 템플릿 원문을 읽는 skipInterpolation과 templateInterpolationCode가 같은
 * 경계를 찾는다.
 */
function readInterpolationCode(
  source: string,
  start: number,
  frame: { previous: InterpolationPrevious },
  memo: RegexFailureMemo,
): number {
  const char = source[start]!;
  if (char === ' ' || char === '\n' || char === '\t' || char === '\r' ||
    (char.charCodeAt(0) >= 0x80 && /\s/u.test(char))) {
    return start + 1;
  }
  if (isIdentifierPart(char)) {
    let end = start + 1;
    while (end < source.length && isIdentifierPart(source[end]!)) end++;
    // 속성 이름(`x.return`)은 예약어여도 값이다.
    const word = source.slice(start, end);
    frame.previous = frame.previous !== 'dot' && expressionKeywords.has(word) ? 'operator' : 'value';
    return end;
  }
  if (char === '/' && frame.previous === 'operator') {
    const end = readRegexLiteral(source, start, memo);
    if (end !== undefined) {
      frame.previous = 'value';
      return end;
    }
  }
  if ((char === '+' || char === '-') && source[start + 1] === char) {
    // `count++ / total`의 `/`는 나눗셈이다(토크나이저와 같다).
    frame.previous = 'value';
    return start + 2;
  }
  frame.previous = valueEndingCharacter(char, frame.previous) ? 'value' : char === '.' ? 'dot' : 'operator';
  return start + 1;
}

/**
 * 보간 본문에서 그 글자 뒤의 `/`를 나눗셈으로 볼 글자인지다 — 닫는 `)`·`]`, 값 뒤의 TS non-null 단언 `!`(`count! / total` —
 * `a != b`의 `!`도 값 뒤지만 바로 뒤 `=`가 다시 연산자 자리로 돌린다), JSX 닫는 태그의 `<`(`</a>` — 비교 대상으로 정규식을
 * 두는 코드는 없다), 이름의 일부인 비ASCII 글자다. 잘못 보더라도 나눗셈 쪽이라 정규식으로 삼키지 않는다.
 */
function valueEndingCharacter(char: string, previous: InterpolationPrevious): boolean {
  if (char === ')' || char === ']' || char === '<' || char.charCodeAt(0) >= 0x80) return true;
  return char === '!' && previous === 'value';
}

/**
 * 보간 건너뛰기가 지금 읽는 문맥이다. 보간 본문은 중괄호 깊이와 바로 앞 코드의 모양(정규식 판정)을, 그 안의 문자열
 * 계열 리터럴(따옴표·중첩 템플릿)은 닫는 따옴표를 기억한다.
 */
type InterpolationFrame =
  | { readonly kind: 'interpolation'; depth: number; previous: InterpolationPrevious }
  | { readonly kind: 'quoted'; readonly quote: string };

/**
 * `${` 뒤의 보간 본문을 중괄호 균형으로 건너뛰어 닫는 `}` 다음을 돌려준다.
 *
 * 보간 안의 문자열과 중첩 템플릿, 그 안의 보간은 명시적 스택으로 따라간다 —
 * 중첩마다 재귀하면 수천 단계로 중첩된 템플릿 파일 하나가 호출 스택을 넘긴다.
 * 정규식 리터럴은 readInterpolationCode가 통째로 건너뛴다. 닫히지 않으면 소스 끝을 돌려준다.
 */
function skipInterpolation(source: string, start: number, memo: RegexFailureMemo): number {
  const frames: InterpolationFrame[] = [{ kind: 'interpolation', depth: 1, previous: 'operator' }];
  let cursor = start;
  while (cursor < source.length && frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const char = source[cursor]!;
    if (frame.kind === 'quoted') {
      // 문자열 계열 리터럴은 통째로 건너뛴다 — 줄바꿈에서도 멈추지 않는다.
      if (char === '\\') {
        cursor += 2;
      } else if (frame.quote === '`' && char === '$' && source[cursor + 1] === '{') {
        frames.push({ kind: 'interpolation', depth: 1, previous: 'operator' });
        cursor += 2;
      } else {
        if (char === frame.quote) frames.pop();
        cursor++;
      }
      continue;
    }
    if (char === '{') {
      frame.depth++;
      frame.previous = 'operator';
    }
    else if (char === '}') {
      frame.depth--;
      if (frame.depth === 0) frames.pop();
      else frame.previous = 'value';
    }
    else if (char === '\'' || char === '"' || char === '`') {
      // 리터럴이 닫힌 뒤는 값 뒤다.
      frame.previous = 'value';
      frames.push({ kind: 'quoted', quote: char });
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
    else {
      cursor = readInterpolationCode(source, cursor, frame, memo);
      continue;
    }
    cursor++;
  }
  return cursor;
}

/**
 * 보간 코드 추출이 지금 읽는 문맥이다. 템플릿 글자 부분, 보간 본문(중괄호 깊이, 바로 앞 코드의 모양, 그 보간의 코드 조각
 * 번호), 보간 안의 따옴표 문자열을 구분한다.
 */
type CodeFrame =
  | { readonly kind: 'template' }
  | { readonly kind: 'interpolation'; depth: number; previous: InterpolationPrevious; readonly segment: number }
  | { readonly kind: 'quoted'; readonly quote: string; readonly segment: number };

/**
 * 보간이 있는 템플릿 토큰 원문(여는 백틱부터)에서 보간 본문의 코드를 조각마다 돌려준다 — 중첩 템플릿 안의 보간도 따로
 * 한 조각이다. 템플릿 글자 부분은 어느 조각에도 넣지 않고, 보간 안의 중첩 템플릿 자리는 빈 템플릿(``` `` ```)으로 둔다 —
 * 조각을 다시 토큰화하면 그 자리가 템플릿 토큰이라 태그 호출(`` tag`…` ``)의 대상을 가를 수 있다. 원문의 글자는 많아야
 * 한 조각에 들어가고 중첩 템플릿마다 두 글자만 더하므로 깊게 중첩된 템플릿도 길이에 선형이다.
 *
 * 경계는 토크나이저(readTemplate·skipInterpolation)와 같은 규칙으로 찾는다 — 보간 안의 따옴표 문자열·주석·정규식
 * 리터럴은 중괄호 깊이에 섞지 않고 조각에 그대로 둔다(조각을 다시 토큰화하면 문자열·주석·정규식으로 읽힌다). 닫히지 않은
 * 보간은 원문 끝까지다.
 */
export function templateInterpolationCode(text: string): string[] {
  const segments: string[][] = [];
  const frames: CodeFrame[] = [{ kind: 'template' }];
  const regexMemo = new RegexFailureMemo(text.length);
  let cursor = text.startsWith('`') ? 1 : 0;
  while (cursor < text.length && frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const char = text[cursor]!;
    if (frame.kind === 'template') {
      if (char === '\\') {
        cursor += 2;
      } else if (char === '`') {
        frames.pop();
        cursor++;
      } else if (char === '$' && text[cursor + 1] === '{') {
        frames.push({ kind: 'interpolation', depth: 1, previous: 'operator', segment: segments.push([]) - 1 });
        cursor += 2;
      } else {
        cursor++;
      }
      continue;
    }
    const segment = segments[frame.segment]!;
    if (frame.kind === 'quoted') {
      // 따옴표 문자열은 줄바꿈에서도 닫지 않는다(skipInterpolation과 같다).
      if (char === '\\') {
        segment.push(text.slice(cursor, cursor + 2));
        cursor += 2;
        continue;
      }
      if (char === frame.quote) frames.pop();
      segment.push(char);
      cursor++;
      continue;
    }
    if (char === '{') {
      frame.depth++;
      frame.previous = 'operator';
    } else if (char === '}') {
      frame.depth--;
      if (frame.depth === 0) {
        frames.pop();
        cursor++;
        continue;
      }
      frame.previous = 'value';
    } else if (char === '\'' || char === '"') {
      frame.previous = 'value';
      frames.push({ kind: 'quoted', quote: char, segment: frame.segment });
    } else if (char === '`') {
      // 중첩 템플릿은 글자 부분을 버리고 빈 템플릿 자리만 남긴다 — 그 안의 보간은 새 조각이 된다.
      segment.push('``');
      frame.previous = 'value';
      frames.push({ kind: 'template' });
      cursor++;
      continue;
    } else if (char === '/' && (text[cursor + 1] === '/' || text[cursor + 1] === '*')) {
      const close = text[cursor + 1] === '/' ? text.indexOf('\n', cursor) : text.indexOf('*/', cursor + 2);
      const end = close === -1 ? text.length : text[cursor + 1] === '/' ? close : close + 2;
      segment.push(text.slice(cursor, end));
      cursor = end;
      continue;
    } else {
      // 낱말·정규식 리터럴·그 밖의 코드 글자는 skipInterpolation과 같은 단위로 읽는다.
      const end = readInterpolationCode(text, cursor, frame, regexMemo);
      segment.push(text.slice(cursor, end));
      cursor = end;
      continue;
    }
    segment.push(char);
    cursor++;
  }
  return segments.map((parts) => parts.join(''));
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
    // 닫는 `}`가 없는 `\u{`는 알 수 없는 이스케이프다 — 없음(-1)으로 끝 위치를
    // 계산하면 커서가 소스 앞쪽으로 돌아가 같은 리터럴을 끝없이 다시 읽는다.
    const isBraced = source[start + 2] === '{';
    const close = isBraced ? bracedEscapeClose(source, start + 3) : start + 6;
    const digits = close === -1 ? '' : source.slice(isBraced ? start + 3 : start + 2, close);
    if (/^[0-9A-Fa-f]+$/.test(digits)) {
      const code = parseInt(digits, 16);
      if (code <= 0x10FFFF) {
        return {
          end: isBraced ? close + 1 : close,
          text: String.fromCodePoint(code),
        };
      }
    }
  }
  // 알려지지 않은 이스케이프는 문자 그대로다(ES에서 '\'는 사라진다).
  return { end: start + 2, text: char };
}

/**
 * `\u{` 뒤 `from`부터 16진수 구간을 읽고, 바로 다음 글자가 `}`면 그 위치를, 아니면 -1을 돌려준다.
 *
 * 첫 `}`를 소스 끝까지 찾지 않는다 — 닫히지 않은 `\u{`마다 나머지 소스를 훑으면 토큰화가 입력 크기의
 * 이차가 된다. `}`는 16진수가 아니므로 "첫 `}`까지가 모두 16진수"라는 판정과 결과가 같다.
 */
function bracedEscapeClose(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && isHexDigit(source[cursor]!)) cursor++;
  return source[cursor] === '}' ? cursor : -1;
}

/** 16진수 숫자 한 글자다. */
function isHexDigit(char: string): boolean {
  return /[0-9A-Fa-f]/.test(char);
}
