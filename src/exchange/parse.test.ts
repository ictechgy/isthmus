import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBridgeFactsDocument } from './parse.ts';

const emptyDocument = {
  format: 'bridge-facts',
  version: 1,
  tool: { name: 'dartograph', version: '0.1.0' },
  generatedAt: '2026-09-04T12:00:00Z',
  platform: 'dart',
  target: null,
  project: '/fixture',
  facts: [],
  limitations: [],
};

test('source mtime은 추출 시각과 별도로 검증하고 생략과 미래 관찰값을 보존한다', () => {
  assert.equal('sourceModifiedAt' in parseBridgeFactsDocument(emptyDocument), false);
  for (const sourceModifiedAt of ['1985-10-26T08:15:00.000Z', '2030-01-01T00:00:00Z']) {
    assert.equal(parseBridgeFactsDocument({ ...emptyDocument, sourceModifiedAt }).sourceModifiedAt, sourceModifiedAt);
  }
  for (const sourceModifiedAt of [null, 0, '', '2026-02-31T00:00:00Z', '2026-01-01T00:00:00']) {
    assert.throws(() => parseBridgeFactsDocument({ ...emptyDocument, sourceModifiedAt }), /Invalid sourceModifiedAt/);
  }
});

const validMethodFact = {
  kind: 'method-invoke',
  channel: 'dev.isthmus/camera',
  method: 'takePhoto',
  dynamic: false,
  location: { path: 'lib/camera.dart', line: 13, column: 18 },
  symbol: { qualifiedName: 'Camera.takePhoto', usr: 'dart:takePhoto' },
};

test('완전한 bridge-facts v1 문서를 파싱한다', () => {
  const parsed = parseBridgeFactsDocument(emptyDocument);

  assert.deepEqual(parsed, emptyDocument);
});

test('go 문서는 사실 없이 limitation만 싣는다', () => {
  const goDocument = {
    ...emptyDocument,
    platform: 'go',
    limitations: ['unscanned-ffi-interop: 2 Go source files use cgo'],
  };
  const parsed = parseBridgeFactsDocument(goDocument);

  assert.equal(parsed.platform, 'go');
  assert.deepEqual(parsed.limitations, goDocument.limitations);
});

test('go 문서에 어떤 fact kind도 허용하지 않는다', () => {
  // 호출 측·수신 측 종류 모두 거부돼야 한다 — go는 어느 쪽도 아니다.
  // 계약이 정의한 kind 전체를 순회해 집합이 바뀌어도 회귀가 따라온다.
  const allKinds = [
    'channel-create', 'channel-register', 'method-invoke', 'method-handle',
    'module-export', 'module-import', 'component-export', 'component-require',
  ];
  for (const kind of allKinds) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform: 'go',
        facts: [{ ...validMethodFact, kind }],
      }),
      /Fact kind is not valid for platform/,
    );
  }
});

test('go·rust 문서는 target을 null 또는 persistence로만 싣는다', () => {
  // go·rust는 브리지 메커니즘에 참여하지 않는다 — bridge target은 입력 오류다.
  for (const platform of ['go', 'rust']) {
    for (const target of ['flutter', 'react-native', 'capacitor']) {
      assert.throws(
        () => parseBridgeFactsDocument({
          ...emptyDocument,
          platform,
          target,
        }),
        /Go\/Rust documents may only carry a null or persistence target/,
      );
    }
  }
});

test('계약 밖 추가 필드는 검증 경계를 넘어 출력되지 않는다', () => {
  const parsed = parseBridgeFactsDocument({
    ...emptyDocument,
    target: 'flutter',
    privateDocumentField: 'do-not-copy',
    tool: { ...emptyDocument.tool, privateToolField: 'do-not-copy' },
    facts: [
      {
        kind: 'method-invoke',
        channel: 'dev.isthmus/camera',
        method: 'takePhoto',
        dynamic: false,
        privateFactField: 'do-not-copy',
        location: {
          path: 'lib/camera.dart',
          line: 1,
          column: 2,
          privatePath: '/private/source.dart',
        },
        symbol: {
          qualifiedName: 'Camera.takePhoto',
          usr: 'dart:takePhoto',
          privateToken: 'do-not-copy',
        },
      },
    ],
  });

  assert.equal(JSON.stringify(parsed).includes('private'), false);
  assert.deepEqual(parsed.facts[0]?.location, {
    path: 'lib/camera.dart',
    line: 1,
    column: 2,
  });
  assert.deepEqual(parsed.facts[0]?.symbol, {
    qualifiedName: 'Camera.takePhoto',
    usr: 'dart:takePhoto',
  });
});

test('target은 facts 존재 여부와 일치해야 한다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      facts: [
        {
          kind: 'method-invoke',
          channel: 'dev.isthmus/camera',
          method: 'takePhoto',
          dynamic: false,
          location: { path: 'lib/camera.dart', line: 1, column: 2 },
        },
      ],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Target must be set exactly when facts are present.',
    },
  );
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, target: 'flutter' }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Target must be set exactly when facts are present.',
    },
  );
});

test('한 문서의 fact 수가 안전 상한을 넘으면 정규화 전에 거부한다', () => {
  const maximumFacts = 100_000;
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      target: 'flutter',
      facts: Array(maximumFacts + 1).fill(validMethodFact),
    }),
    {
      name: 'BridgeFactsValidationError',
      message: `Facts exceed the ${maximumFacts} item limit.`,
    },
  );
});

test('플랫폼은 자기 역할의 fact kind만 생산할 수 있다', () => {
  const invalidCases = [
    {
      platform: 'dart',
      fact: { ...validMethodFact, kind: 'method-handle' },
    },
    {
      platform: 'swift',
      fact: { ...validMethodFact, kind: 'method-invoke' },
    },
    {
      platform: 'swift',
      fact: {
        kind: 'module-import',
        channel: 'CameraModule',
        dynamic: false,
        location: { path: 'ios/Camera.swift', line: 1, column: 1 },
      },
    },
  ];

  for (const { platform, fact } of invalidCases) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform,
        target: 'flutter',
        facts: [fact],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Fact kind is not valid for platform at index 0.',
      },
    );
  }
});

test('module·component fact는 이름 기반 조인 대상으로 받아들인다', () => {
  const supportedFacts = [
    { platform: 'js', kind: 'module-import' },
    { platform: 'swift', kind: 'module-export' },
    { platform: 'js', kind: 'component-require' },
    { platform: 'kotlin', kind: 'component-export' },
  ];

  for (const { platform, kind } of supportedFacts) {
    const parsed = parseBridgeFactsDocument({
      ...emptyDocument,
      platform,
      target: 'react-native',
      facts: [
        {
          kind,
          channel: 'CameraModule',
          dynamic: false,
          location: { path: 'src/camera.ts', line: 1, column: 1 },
        },
      ],
    });

    assert.equal(parsed.facts[0]?.kind, kind);
    assert.equal(parsed.facts[0]?.channel, 'CameraModule');
  }
});

test('method가 아닌 fact에는 method 필드를 허용하지 않는다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      target: 'flutter',
      facts: [
        {
          kind: 'channel-create',
          channel: 'dev.isthmus/camera',
          method: 'smuggled\nmethod',
          dynamic: false,
          location: { path: 'lib/camera.dart', line: 1, column: 2 },
        },
      ],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Unexpected method at index 0.',
    },
  );
});

test('channel null은 귀속할 수 없는 method-handle에만 허용한다', () => {
  const invalidFacts = [
    { ...validMethodFact, channel: null },
    {
      kind: 'channel-create',
      channel: null,
      dynamic: false,
      location: { path: 'lib/camera.dart', line: 1, column: 1 },
    },
    {
      kind: 'channel-register',
      channel: null,
      dynamic: false,
      location: { path: 'ios/Camera.swift', line: 1, column: 1 },
    },
  ];

  for (const fact of invalidFacts) {
    const platform = fact.kind === 'channel-register' ? 'swift' : 'dart';
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform,
        target: 'flutter',
        facts: [fact],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Invalid fact channel at index 0.',
      },
    );
  }
});

test('짝 없는 서러게이트를 문자열 필드와 경로에서 거부한다', () => {
  for (const fact of [
    { kind: 'channel-create', channel: 'a\ud800b', dynamic: false, location: { path: 'a.dart', line: 1, column: 1 } },
    { kind: 'channel-create', channel: 'ok', dynamic: false, location: { path: 'x\udc00y.dart', line: 1, column: 1 } },
  ]) {
    assert.throws(() => parseBridgeFactsDocument({
      ...emptyDocument,
      platform: 'dart',
      target: 'flutter',
      facts: [fact],
    }), { name: 'BridgeFactsValidationError' });
  }
});

test('아스트랄 문자는 유효한 서러게이트 쌍으로 그대로 통과한다', () => {
  const document = parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'dart',
    target: 'flutter',
    facts: [{
      kind: 'channel-create',
      channel: '예시/카메라😀',
      dynamic: false,
      location: { path: 'lib/카메라😀.dart', line: 1, column: 1 },
    }],
  });

  assert.equal(document.facts[0]?.channel, '예시/카메라😀');
  assert.equal(document.facts[0]?.location?.path, 'lib/카메라😀.dart');
});

test('귀속할 수 없는 method-handle은 원인을 limitation으로 알려야 한다', () => {
  const unattributedHandler = {
    kind: 'method-handle',
    channel: null,
    method: 'takePhoto',
    dynamic: false,
    location: { path: 'ios/Camera.swift', line: 1, column: 1 },
  };

  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      platform: 'swift',
      target: 'flutter',
      facts: [unattributedHandler],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Unattributed method handles require a limitation.',
    },
  );

  assert.doesNotThrow(() => parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'swift',
    target: 'flutter',
    facts: [unattributedHandler],
    limitations: ['unattributed-method-handles: 1 handler has no channel'],
  }));
});

test('객체가 아닌 JSON 루트를 안전한 검증 오류로 거부한다', () => {
  assert.throws(() => parseBridgeFactsDocument(null), {
    name: 'BridgeFactsValidationError',
    message: 'Bridge facts must be a JSON object.',
  });
});

test('다른 JSON 문서 형식을 bridge-facts로 오인하지 않는다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, format: 'graph' }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Expected format "bridge-facts".',
    },
  );
});

test('지원하지 않는 bridge-facts 버전을 거부한다', () => {
  assert.throws(
    () => parseBridgeFactsDocument({ ...emptyDocument, version: 2 }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Unsupported bridge-facts version; expected version 1.',
    },
  );
});

test('잘못된 문서 메타데이터를 필드별 안전한 오류로 거부한다', () => {
  const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
    [{ ...emptyDocument, tool: { name: '', version: '0.1.0' } }, 'Invalid tool metadata.'],
    [
      { ...emptyDocument, tool: { name: 'dartograph\nevil', version: '0.1.0' } },
      'Invalid tool metadata.',
    ],
    [
      { ...emptyDocument, tool: { name: 'dartograph', version: '0.1.0\u0000evil' } },
      'Invalid tool metadata.',
    ],
    [{ ...emptyDocument, generatedAt: 'not-a-date' }, 'Invalid generatedAt timestamp.'],
    [
      { ...emptyDocument, generatedAt: '2026-09-04T12:00:00' },
      'Invalid generatedAt timestamp.',
    ],
    [
      { ...emptyDocument, generatedAt: '2026-02-31T12:00:00Z' },
      'Invalid generatedAt timestamp.',
    ],
    [{ ...emptyDocument, platform: 'ruby' }, 'Unsupported bridge platform.'],
    [{ ...emptyDocument, target: 'cordova' }, 'Unsupported bridge target.'],
    [{ ...emptyDocument, project: '' }, 'Invalid project path.'],
    [{ ...emptyDocument, project: '/fixture\u0000other' }, 'Invalid project path.'],
    [{ ...emptyDocument, facts: {} }, 'Facts must be an array.'],
    [{ ...emptyDocument, limitations: [1] }, 'Limitations must be strings.'],
  ];

  for (const [input, message] of invalidCases) {
    assert.throws(() => parseBridgeFactsDocument(input), {
      name: 'BridgeFactsValidationError',
      message,
    });
  }
});

test('잘못된 사실을 필드별 검증 오류로 거부한다', () => {
  const invalidCases: ReadonlyArray<readonly [unknown, string]> = [
    [null, 'Fact at index 0 must be a JSON object.'],
    [{ ...validMethodFact, kind: 'unknown' }, 'Invalid fact kind at index 0.'],
    [{ ...validMethodFact, channel: '' }, 'Invalid fact channel at index 0.'],
    [
      { ...validMethodFact, channel: 'dev.isthmus/\u0000camera' },
      'Invalid fact channel at index 0.',
    ],
    [
      { ...validMethodFact, method: undefined },
      'Method fact at index 0 requires a method name.',
    ],
    [
      { ...validMethodFact, method: 'take\nPhoto' },
      'Method fact at index 0 requires a method name.',
    ],
    [{ ...validMethodFact, dynamic: 'no' }, 'Invalid dynamic flag at index 0.'],
    [
      { ...validMethodFact, location: { path: '', line: 0, column: 0 } },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: '/private/Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: '../private/Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: 'C:\\private\\Plugin.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: 'ios/Plugin\nInjected.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      {
        ...validMethodFact,
        location: { path: 'ios/Plugin\u2028Injected.swift', line: 1, column: 1 },
      },
      'Invalid fact location at index 0.',
    ],
    [
      { ...validMethodFact, method: 'take\u2029Photo' },
      'Method fact at index 0 requires a method name.',
    ],
    [
      {
        ...validMethodFact,
        location: {
          path: 'lib/camera.dart',
          line: Number.MAX_SAFE_INTEGER + 1,
          column: 1,
        },
      },
      'Invalid fact location at index 0.',
    ],
    [
      { ...validMethodFact, symbol: { qualifiedName: '' } },
      'Invalid fact symbol at index 0.',
    ],
    [
      { ...validMethodFact, symbol: { qualifiedName: 'Camera\u0000Plugin' } },
      'Invalid fact symbol at index 0.',
    ],
    [
      {
        ...validMethodFact,
        symbol: { qualifiedName: 'CameraPlugin.register', usr: 's:\rregister' },
      },
      'Invalid fact symbol at index 0.',
    ],
  ];

  for (const [fact, message] of invalidCases) {
    assert.throws(
      () => parseBridgeFactsDocument({ ...emptyDocument, facts: [fact] }),
      { name: 'BridgeFactsValidationError', message },
    );
  }
});

test('mechanism 필드는 이름 경계 사실에만 허용하고 생략은 core로 읽는다', () => {
  const boundaryKinds = [
    { platform: 'js', kind: 'module-import' },
    { platform: 'js', kind: 'component-require' },
    { platform: 'swift', kind: 'module-export' },
    { platform: 'kotlin', kind: 'component-export' },
  ];

  for (const { platform, kind } of boundaryKinds) {
    const parsed = parseBridgeFactsDocument({
      ...emptyDocument,
      platform,
      target: 'react-native',
      facts: [
        {
          kind,
          channel: 'CameraModule',
          mechanism: 'expo',
          dynamic: false,
          location: { path: 'src/camera.ts', line: 1, column: 1 },
        },
      ],
    });

    assert.equal(parsed.facts[0]?.mechanism, 'expo');
  }

  // 생략된 사실은 필드를 만들지 않는다 — 소비자가 core로 읽는다.
  const omitted = parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'js',
    target: 'react-native',
    facts: [
      {
        kind: 'module-import',
        channel: 'CameraModule',
        dynamic: false,
        location: { path: 'src/camera.ts', line: 1, column: 1 },
      },
    ],
  });
  assert.equal(omitted.facts[0]?.mechanism, undefined);
});

test('mechanism은 허용 값·허용 종류·react-native target 안에서만 유효하다', () => {
  const boundaryFact = {
    kind: 'module-import',
    channel: 'CameraModule',
    dynamic: false,
    location: { path: 'src/camera.ts', line: 1, column: 1 },
  };

  // 허용 값 밖 mechanism은 거부한다.
  for (const mechanism of ['hermes', 'EXPO', 1, true]) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform: 'js',
        target: 'react-native',
        facts: [{ ...boundaryFact, mechanism }],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Invalid fact mechanism at index 0.',
      },
    );
  }

  // 이름 경계가 아닌 종류에는 mechanism을 실을 수 없다.
  for (const kind of ['method-invoke', 'channel-create']) {
    const fact = {
      ...boundaryFact,
      kind,
      ...(kind === 'method-invoke' ? { method: 'takePhoto' } : {}),
      mechanism: 'expo',
    };
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform: 'js',
        target: 'react-native',
        facts: [fact],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Invalid fact mechanism at index 0.',
      },
    );
  }

  // mechanism은 react-native 해석 경로 어휘다 — 다른 target 문서엔 못 실린다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      platform: 'dart',
      target: 'flutter',
      facts: [{ ...boundaryFact, mechanism: 'expo' }],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Mechanism requires the react-native target at fact index 0.',
    },
  );

  // capacitor 등 다른 target 문서에도 mechanism은 실을 수 없다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      platform: 'js',
      target: 'capacitor',
      facts: [{ ...boundaryFact, mechanism: 'expo' }],
    }),
    {
      name: 'BridgeFactsValidationError',
      message: 'Mechanism requires the react-native target at fact index 0.',
    },
  );
});

test('mechanism은 dynamic 사실에도 실려 정규화 뒤에도 보존된다', () => {
  const parsed = parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'js',
    target: 'react-native',
    facts: [{
      kind: 'module-import',
      channel: 'nameExpr',
      mechanism: 'expo',
      dynamic: true,
      location: { path: 'src/boundary.ts', line: 3, column: 1 },
    }],
  });

  assert.equal(parsed.facts[0]?.mechanism, 'expo');
  assert.equal(parsed.facts[0]?.dynamic, true);
});

test('optional 필드는 module-import에만 허용하고 정규화 뒤에도 보존된다', () => {
  const parsed = parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'js',
    target: 'react-native',
    facts: [{
      kind: 'module-import',
      channel: 'CameraModule',
      optional: true,
      dynamic: false,
      location: { path: 'src/camera.ts', line: 1, column: 1 },
    }],
  });
  assert.equal(parsed.facts[0]?.optional, true);

  // module-import가 아닌 종류에는 optional을 실을 수 없다 — 부재 허용은
  // 모듈 조회 API에만 있는 의미다. 수신 측 종류는 네이티브 플랫폼에서도 거부다.
  for (const { platform, kind } of [
    { platform: 'js', kind: 'component-require' },
    { platform: 'swift', kind: 'module-export' },
    { platform: 'kotlin', kind: 'component-export' },
  ]) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform,
        target: 'react-native',
        facts: [{
          kind,
          channel: 'CameraModule',
          optional: true,
          dynamic: false,
          location: { path: 'src/camera.ts', line: 1, column: 1 },
        }],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Invalid fact optional flag at index 0.',
      },
    );
  }

  // `true`가 아닌 값은 전부 거부다 — 존재 자체가 증거인 표식이라
  // `false`를 실은 사실은 부재 허용이 아니라 오선언이다.
  for (const optional of [false, 'yes', 1]) {
    assert.throws(
      () => parseBridgeFactsDocument({
        ...emptyDocument,
        platform: 'js',
        target: 'react-native',
        facts: [{
          kind: 'module-import',
          channel: 'CameraModule',
          optional,
          dynamic: false,
          location: { path: 'src/camera.ts', line: 1, column: 1 },
        }],
      }),
      {
        name: 'BridgeFactsValidationError',
        message: 'Invalid fact optional flag at index 0.',
      },
    );
  }
});

const sqlDocument = {
  ...emptyDocument,
  platform: 'sql',
  target: 'persistence',
};

const goPersistenceDocument = {
  ...emptyDocument,
  platform: 'go',
  target: 'persistence',
};

const rustPersistenceDocument = {
  ...emptyDocument,
  platform: 'rust',
  target: 'persistence',
};

const kotlinPersistenceDocument = {
  ...emptyDocument,
  platform: 'kotlin',
  target: 'persistence',
};

const validRelationDecl = {
  kind: 'relation-decl',
  channel: 'public.users',
  dynamic: false,
  symbol: { qualifiedName: 'public.users' },
};

const validRelationUse = {
  kind: 'relation-use',
  channel: 'users',
  dynamic: false,
  location: { path: 'db/access.go', line: 10, column: 5 },
};

test('relation-decl은 소스 위치 없이 정규 식별자만으로 올 수 있다', () => {
  const parsed = parseBridgeFactsDocument({
    ...sqlDocument,
    facts: [validRelationDecl],
  });

  assert.equal(parsed.facts[0]?.kind, 'relation-decl');
  assert.equal('location' in (parsed.facts[0] ?? {}), false);
  assert.equal(parsed.facts[0]?.symbol?.qualifiedName, 'public.users');
});

test('relation-decl은 symbol과 리터럴 이름을 요구한다', () => {
  // 카탈로그 선언은 항상 리터럴이고 진단을 가리킬 정규 식별자가 필요하다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...sqlDocument,
      facts: [{ ...validRelationDecl, dynamic: true }],
    }),
    /Relation declarations require a symbol and must be literal/,
  );
  const { symbol: _symbol, ...noSymbol } = validRelationDecl;
  assert.throws(
    () => parseBridgeFactsDocument({
      ...sqlDocument,
      facts: [noSymbol],
    }),
    /Relation declarations require a symbol and must be literal/,
  );
});

test('relation-decl은 한정 schema.name 채널을 요구한다', () => {
  // 선언 측 채널은 항상 한정 형태다 — 비한정 선언은 조인 의미가 없다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...sqlDocument,
      facts: [{ ...validRelationDecl, channel: 'users' }],
    }),
    /qualified schema\.name channel/,
  );
  assert.throws(
    () => parseBridgeFactsDocument({
      ...sqlDocument,
      facts: [{ ...validRelationDecl, channel: 'public.' }],
    }),
    /qualified schema\.name channel/,
  );
  // 식별자 안의 escape된 점은 한정 세그먼트로 세지 않는다.
  const parsed = parseBridgeFactsDocument({
    ...sqlDocument,
    facts: [{ ...validRelationDecl, channel: 'public.a%2Eb' }],
  });
  assert.equal(parsed.facts[0]?.channel, 'public.a%2Eb');
});

test('relation-use는 소스 위치가 필수다', () => {
  const { location: _location, ...noLocation } = validRelationUse;
  assert.throws(
    () => parseBridgeFactsDocument({
      ...goPersistenceDocument,
      facts: [noLocation],
    }),
    /Fact at index 0 requires a location/,
  );
});

test('persistence 도메인의 kind는 플랫폼 역할을 따른다', () => {
  // sql은 선언 측, 나머지 플랫폼은 사용 측이다 — 역할이 뒤집힌 사실은 거부다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...sqlDocument,
      facts: [{ ...validRelationUse }],
    }),
    /Fact kind is not valid for platform/,
  );
  assert.throws(
    () => parseBridgeFactsDocument({
      ...goPersistenceDocument,
      facts: [{ ...validRelationDecl }],
    }),
    /Fact kind is not valid for platform/,
  );
  // bridge 도메인 kind는 persistence target에 실을 수 없다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...goPersistenceDocument,
      facts: [{ ...validMethodFact }],
    }),
    /Fact kind is not valid for platform/,
  );
  // relation kind는 bridge target에 실을 수 없다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      facts: [{ ...validRelationUse }],
    }),
    /Fact kind is not valid for platform/,
  );
});

test('rust 문서도 persistence target에서 relation-use를 싣는다', () => {
  // rust는 go와 같은 코드 측 생산자다 — 동적·정적 관계 사용을 모두 허용한다.
  const parsed = parseBridgeFactsDocument({
    ...rustPersistenceDocument,
    facts: [
      validRelationUse,
      { ...validRelationUse, channel: 'orders', dynamic: true },
    ],
  });
  assert.equal(parsed.platform, 'rust');
  assert.equal(parsed.facts.length, 2);
  assert.throws(
    () => parseBridgeFactsDocument({
      ...rustPersistenceDocument,
      facts: [{ ...validRelationDecl }],
    }),
    /Fact kind is not valid for platform/,
  );
});

test('kotlin 문서도 persistence target에서 relation-use를 싣는다', () => {
  // kotlin은 bridge 수신 측이면서 persistence 호출 측 생산자다 — target이
  // 역할을 가르므로 같은 플랫폼이 두 도메인에서 다른 kind를 낸다.
  const parsed = parseBridgeFactsDocument({
    ...kotlinPersistenceDocument,
    facts: [
      validRelationUse,
      { ...validRelationUse, channel: 'orders', dynamic: true },
    ],
  });
  assert.equal(parsed.platform, 'kotlin');
  assert.equal(parsed.facts.length, 2);
  assert.throws(
    () => parseBridgeFactsDocument({
      ...kotlinPersistenceDocument,
      facts: [{ ...validRelationDecl }],
    }),
    /Fact kind is not valid for platform/,
  );
});

test('rust 문서도 사실이 없을 때만 target을 null로 싣는다', () => {
  // 빈 수확은 persistence target을 남기지 않는다 — 전역 불변을 rust에도 적용한다.
  const parsed = parseBridgeFactsDocument({
    ...emptyDocument,
    platform: 'rust',
  });
  assert.equal(parsed.platform, 'rust');
  assert.equal(parsed.target, null);
  // 사실이 있는데 target이 null이면 거부다 — relation kind는 persistence
  // target에서만 유효하므로 kind 검증이 불변 검사보다 먼저 건다.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...emptyDocument,
      platform: 'rust',
      facts: [validRelationUse],
    }),
    /Fact kind is not valid for platform/,
  );
  // 반대 방향도 거부다 — persistence target인데 사실이 비면 불변 위반.
  assert.throws(
    () => parseBridgeFactsDocument({
      ...rustPersistenceDocument,
      facts: [],
    }),
    /Target must be set exactly when facts are present/,
  );
});

test('sql 문서는 persistence 외 target을 거부한다', () => {
  for (const target of ['flutter', 'react-native', 'capacitor']) {
    assert.throws(
      () => parseBridgeFactsDocument({ ...sqlDocument, target }),
      /Sql documents may only carry a null or persistence target/,
    );
  }
});

test('컬럼 사실은 method를 컬럼 이름으로 싣는다', () => {
  const parsed = parseBridgeFactsDocument({
    ...sqlDocument,
    facts: [
      { ...validRelationDecl, method: 'email', symbol: { qualifiedName: 'public.users.email' } },
    ],
  });
  assert.equal(parsed.facts[0]?.method, 'email');

  const useParsed = parseBridgeFactsDocument({
    ...goPersistenceDocument,
    facts: [{ ...validRelationUse, method: 'email' }],
  });
  assert.equal(useParsed.facts[0]?.method, 'email');
});
