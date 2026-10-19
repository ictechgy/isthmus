import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
import type { BridgeJoinResult } from '../join/join.ts';
import {
  createBridgeGraph,
  renderBridgeGraph,
  type BridgeGraphDocument,
} from './graph.ts';

const dartDocument = await loadDocument(
  '../../experiments/phase-0/expected/dart.json',
);
const swiftDocument = await loadDocument(
  '../../experiments/phase-0/expected/swift.json',
);

test('매치된 브리지 위치를 안정적인 노드와 경계 간선으로 만든다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);

  const graph = createBridgeGraph(joined);

  assert.equal(graph.format, 'isthmus-graph');
  assert.equal(graph.version, 1);
  assert.deepEqual(graph.nodes.map(({ id }) => id), [
    'dart:lib/camera_bridge.dart:3:23',
    'dart:lib/camera_bridge.dart:6:23',
    'swift:ios/Runner/CameraPlugin.swift:11:17',
    'swift:ios/Runner/CameraPlugin.swift:13:18',
  ]);
  assert.deepEqual(graph.edges, [
    {
      from: 'dart:lib/camera_bridge.dart:3:23',
      to: 'swift:ios/Runner/CameraPlugin.swift:11:17',
      kind: 'channel',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
    },
    {
      from: 'dart:lib/camera_bridge.dart:6:23',
      to: 'swift:ios/Runner/CameraPlugin.swift:13:18',
      kind: 'method',
      target: 'flutter',
      channel: 'dev.isthmus/camera',
      method: 'takePhoto',
    },
  ]);
  assert.deepEqual(graph.limitations, joined.limitations);
});

test('graph json 형식은 결정적 문서와 마지막 개행을 출력한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const graph = createBridgeGraph(joined);

  const output = renderBridgeGraph(graph, 'json');

  assert.equal(JSON.parse(output).format, 'isthmus-graph');
  assert.ok(output.indexOf('"edges"') < output.indexOf('"format"'));
  assert.equal(output.endsWith('\n'), true);
  assert.equal(output, renderBridgeGraph(graph, 'json'));
});

test('graph dot 형식은 위치 노드와 채널·메서드 간선을 출력한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const graph = createBridgeGraph(joined);

  const output = renderBridgeGraph(graph, 'dot');

  assert.equal(output.startsWith('digraph isthmus {\n  rankdir=LR;\n'), true);
  assert.equal(
    output.includes(
      '"dart:lib/camera_bridge.dart:3:23" -> '
      + '"swift:ios/Runner/CameraPlugin.swift:11:17" '
      + '[label="channel dev.isthmus/camera"]',
    ),
    true,
  );
  assert.equal(
    output.includes('[label="method dev.isthmus/camera#takePhoto"]'),
    true,
  );
  assert.equal(output.endsWith('}\n'), true);
});

test('graph mermaid 형식은 결정적 노드 번호와 경계 간선을 출력한다', () => {
  const joined = joinBridgeDocuments([dartDocument, swiftDocument]);
  const graph = createBridgeGraph(joined);

  const output = renderBridgeGraph(graph, 'mermaid');

  assert.equal(output.startsWith('flowchart LR\n'), true);
  assert.equal(
    output.includes(
      'n0 -->|"channel dev.isthmus/camera"| n2',
    ),
    true,
  );
  assert.equal(
    output.includes(
      'n1 -->|"method dev.isthmus/camera#takePhoto"| n3',
    ),
    true,
  );
  assert.equal(output.endsWith('\n'), true);
});

test('graph mermaid 형식은 외부 경로의 문법 제어 문자를 이스케이프한다', () => {
  const graph: BridgeGraphDocument = {
    format: 'isthmus-graph',
    version: 1,
    nodes: [
      {
        id: 'dart:unsafe',
        platform: 'dart',
        location: {
          path: 'evil"\n  attacker --> victim',
          line: 1,
          column: 1,
        },
      },
    ],
    edges: [],
    limitations: [],
  };

  const output = renderBridgeGraph(graph, 'mermaid');

  assert.equal(output.includes('evil&quot;&#10;  attacker --&gt; victim'), true);
  assert.equal(output.includes('\n  attacker --> victim'), false);
});

test('텍스트 그래프는 분석 한계를 문법 안전한 한 줄 주석으로 보존한다', () => {
  const graph = {
    ...createBridgeGraph(joinBridgeDocuments([dartDocument, swiftDocument])),
    limitations: [
      {
        platform: 'dart' as const,
        target: 'flutter' as const,
        tool: 'test-tool',
        message: 'dynamic-name:\nflowchart TD\u0085subgraph X',
      },
      {
        platform: 'swift' as const,
        target: null,
        tool: 'test-tool',
        message: 'objective-c-sources: 2 file(s)',
      },
    ],
  };

  const dot = renderBridgeGraph(graph, 'dot');
  const mermaid = renderBridgeGraph(graph, 'mermaid');

  assert.equal(
    dot.includes(
      '  // limitation: dart/flutter/test-tool: dynamic-name: flowchart TD subgraph X\n',
    ),
    true,
  );
  assert.equal(
    dot.includes(
      '  // limitation: swift/null/test-tool: objective-c-sources: 2 file(s)\n',
    ),
    true,
  );
  assert.equal(
    mermaid.includes(
      '  %% limitation: dart/flutter/test-tool: dynamic-name: flowchart TD subgraph X\n',
    ),
    true,
  );
  assert.equal(dot.includes('\nflowchart TD'), false);
  assert.equal(mermaid.includes('\nflowchart TD'), false);
  assert.equal(dot.includes('\u0085'), false);
  assert.equal(mermaid.includes('\u0085'), false);
});

/**
 * Mermaid가 렌더 전에 텍스트 전체에서 찾는 지시문 정규식이다(mermaid 11.4.1
 * `diagram-api/regexes.ts`의 `directiveRegex`). 따옴표 라벨·`%%` 주석 안인지 보지 않고, 닫는 `}%%`가
 * 없으면 텍스트 끝까지 지운다. 패키지를 들이지 않고 정규식만 옮겨 출력에 지시문이 없는지 본다.
 * 원본은 `u` 플래그가 없고 맨 중괄호를 글자로 쓰므로 플래그도 그대로 둔다(`u`면 문법 오류다).
 */
const mermaidDirectivePattern =
  /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;

test('graph mermaid 형식은 분석 대상 문자열의 %%{...}%% 지시문을 중화한다', () => {
  // 채널·위치 경로·한계 문구는 분석 대상 저장소가 정할 수 있는 문자열이고 파서는 `%`·`{`·`:`를 받는다.
  const channel = "x%%{init: {'themeCSS': '.edgePaths{display:none}'}}%%";
  const document = (
    platform: 'dart' | 'swift',
    kind: 'channel-create' | 'channel-register',
    location: { path: string; line: number; column: number },
    limitations: readonly string[],
  ) => parseBridgeFactsDocument({
    format: 'bridge-facts',
    version: 1,
    tool: { name: `test-${platform}`, version: '0.0.0' },
    generatedAt: '2026-09-04T12:00:00Z',
    platform,
    target: 'flutter',
    project: '/fixture',
    facts: [{ kind, channel, dynamic: false, location }],
    limitations,
  });
  const graph = createBridgeGraph(joinBridgeDocuments([
    document('dart', 'channel-create', { path: 'lib/%%{a: {.dart', line: 3, column: 23 },
      ['opaque-handler-bodies: see %%{init: {']),
    document('swift', 'channel-register', { path: 'ios/Runner/CameraPlugin.swift', line: 11, column: 17 }, []),
  ]));

  const mermaid = renderBridgeGraph(graph, 'mermaid');
  const dot = renderBridgeGraph(graph, 'dot');

  assert.deepEqual([...mermaid.matchAll(mermaidDirectivePattern)].map(([match]) => match), []);
  // 라벨의 `%`는 Mermaid 엔터티(지시문 처리 뒤에 풀려 `%`로 보인다), 렌더되지 않는 주석의 `%`는 `%25`다.
  assert.equal(mermaid, [
    'flowchart LR',
    '  %% limitation: dart/flutter/test-dart: opaque-handler-bodies: see %25%25{init: {',
    '  n0["dart<br/>lib/#37;#37;{a: {.dart:3:23"]',
    '  n1["swift<br/>ios/Runner/CameraPlugin.swift:11:17"]',
    "  n0 -->|\"channel x#37;#37;{init: {'themeCSS': '.edgePaths{display:none}'}}#37;#37;\"| n1",
    '',
  ].join('\n'));
  // DOT은 문자열 리터럴 인용만으로 안전하므로 원문을 그대로 싣는다.
  assert.equal(
    dot.includes('  // limitation: dart/flutter/test-dart: opaque-handler-bodies: see %%{init: {\n'),
    true,
  );
  assert.equal(dot.includes(`[label=${JSON.stringify(`channel ${channel}`)}];`), true);
});

test('그래프 간선 수가 안전 상한을 넘으면 생성 전에 거부한다', () => {
  const joined: BridgeJoinResult = {
    deferred: false,
    observedFacts: 0,
    matchedChannels: [
      {
        target: 'flutter',
        channel: 'dev.isthmus/large',
        creations: Array.from({ length: 317 }, (_, index) => ({
          platform: 'dart',
          location: { path: `lib/caller-${index}.dart`, line: 1, column: 1 },
        })),
        registrations: Array.from({ length: 317 }, (_, index) => ({
          platform: 'swift',
          location: { path: `ios/receiver-${index}.swift`, line: 1, column: 1 },
        })),
      },
    ],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations: [],
  };

  assert.throws(
    () => createBridgeGraph(joined),
    {
      name: 'BridgeGraphLimitError',
      message: 'Bridge graph exceeds the 100000 edge limit.',
    },
  );
});

test('같은 위치에 서로 다른 심볼이 있으면 노드를 손실 병합하지 않는다', () => {
  const joined: BridgeJoinResult = {
    deferred: false,
    observedFacts: 0,
    matchedChannels: [],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        method: 'first',
        invocations: [
          {
            platform: 'dart',
            location: { path: 'lib/first.dart', line: 1, column: 1 },
          },
        ],
        handlers: [
          {
            platform: 'swift',
            location: { path: 'ios/Plugin.swift', line: 5, column: 7 },
            symbol: { qualifiedName: 'FirstPlugin.handle' },
          },
        ],
      },
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        method: 'second',
        invocations: [
          {
            platform: 'dart',
            location: { path: 'lib/second.dart', line: 1, column: 1 },
          },
        ],
        handlers: [
          {
            platform: 'swift',
            location: { path: 'ios/Plugin.swift', line: 5, column: 7 },
            symbol: { qualifiedName: 'SecondPlugin.handle' },
          },
        ],
      },
    ],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations: [],
  };

  assert.throws(
    () => createBridgeGraph(joined),
    {
      name: 'BridgeGraphValidationError',
      message: 'Bridge graph node has conflicting symbols.',
    },
  );
});

test('같은 위치의 심볼 있는 증거로 기존 노드를 보강한다', () => {
  const receiver = {
    platform: 'swift' as const,
    location: { path: 'ios/Plugin.swift', line: 5, column: 7 },
  };
  const joined: BridgeJoinResult = {
    deferred: false,
    observedFacts: 0,
    matchedChannels: [
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        creations: [
          {
            platform: 'dart',
            location: { path: 'lib/plugin.dart', line: 1, column: 1 },
          },
        ],
        registrations: [receiver],
      },
    ],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        method: 'invoke',
        invocations: [
          {
            platform: 'dart',
            location: { path: 'lib/plugin.dart', line: 2, column: 1 },
          },
        ],
        handlers: [
          { ...receiver, symbol: { qualifiedName: 'Plugin.handle' } },
        ],
      },
    ],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations: [],
  };

  const graph = createBridgeGraph(joined);
  const receiverNode = graph.nodes.find(({ id }) => id.startsWith('swift:'));

  assert.deepEqual(receiverNode?.symbol, { qualifiedName: 'Plugin.handle' });
});

test('같은 심볼의 USR 있는 증거로 기존 노드를 보강한다', () => {
  const location = { path: 'ios/Plugin.swift', line: 5, column: 7 };
  const joined: BridgeJoinResult = {
    deferred: false,
    observedFacts: 0,
    matchedChannels: [],
    unregisteredChannelCreations: [],
    registrationsWithoutCreations: [],
    matchedMethods: [
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        method: 'first',
        invocations: [
          {
            platform: 'dart',
            location: { path: 'lib/first.dart', line: 1, column: 1 },
          },
        ],
        handlers: [
          {
            platform: 'swift',
            location,
            symbol: { qualifiedName: 'Plugin.handle' },
          },
        ],
      },
      {
        target: 'flutter',
        channel: 'dev.isthmus/test',
        method: 'second',
        invocations: [
          {
            platform: 'dart',
            location: { path: 'lib/second.dart', line: 1, column: 1 },
          },
        ],
        handlers: [
          {
            platform: 'swift',
            location,
            symbol: { qualifiedName: 'Plugin.handle', usr: 's:Plugin.handle' },
          },
        ],
      },
    ],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
    matchedModules: [],
    moduleImportsWithoutExports: [],
    moduleExportsWithoutImports: [],
    matchedComponents: [],
    componentRequiresWithoutExports: [],
    componentExportsWithoutRequires: [],
    matchedRelations: [],
    relationUsesWithoutDecls: [],
    ambiguousRelationUses: [],
    relationDeclsWithoutUses: [],
    matchedColumns: [],
    columnUsesWithoutDecls: [],
    limitations: [],
  };

  const graph = createBridgeGraph(joined);
  const receiverNode = graph.nodes.find(({ id }) => id.startsWith('swift:'));

  assert.deepEqual(receiverNode?.symbol, {
    qualifiedName: 'Plugin.handle',
    usr: 's:Plugin.handle',
  });
});

test('매치된 RN 모듈·컴포넌트를 호출→export 간선으로 만든다', () => {
  const joined = joinBridgeDocuments([
    parseBridgeFactsDocument({
      format: 'bridge-facts',
      version: 1,
      tool: { name: 'isthmus-extract-js', version: '0.1.0' },
      generatedAt: '2026-09-04T12:00:00Z',
      platform: 'js',
      target: 'react-native',
      project: '/fixture',
      facts: [
        {
          kind: 'module-import',
          channel: 'CameraModule',
          dynamic: false,
          location: { path: 'src/camera.ts', line: 2, column: 30 },
        },
        {
          kind: 'component-require',
          channel: 'CameraView',
          dynamic: false,
          location: { path: 'src/Camera.tsx', line: 5, column: 22 },
        },
      ],
      limitations: [],
    }),
    parseBridgeFactsDocument({
      format: 'bridge-facts',
      version: 1,
      tool: { name: 'cartograph', version: '0.1.0' },
      generatedAt: '2026-09-04T12:00:00Z',
      platform: 'swift',
      target: 'react-native',
      project: '/fixture',
      facts: [
        {
          kind: 'module-export',
          channel: 'CameraModule',
          dynamic: false,
          location: { path: 'ios/CameraModule.m', line: 4, column: 1 },
        },
        {
          kind: 'component-export',
          channel: 'CameraView',
          dynamic: false,
          location: { path: 'ios/CameraViewManager.m', line: 9, column: 1 },
        },
      ],
      limitations: [],
    }),
  ]);

  const graph = createBridgeGraph(joined);

  assert.deepEqual(graph.edges, [
    {
      from: 'js:src/Camera.tsx:5:22',
      to: 'swift:ios/CameraViewManager.m:9:1',
      kind: 'component',
      target: 'react-native',
      channel: 'CameraView',
    },
    {
      from: 'js:src/camera.ts:2:30',
      to: 'swift:ios/CameraModule.m:4:1',
      kind: 'module',
      target: 'react-native',
      channel: 'CameraModule',
    },
  ]);
});

test('보류된 조인을 빈 graph로 만들지 않는다', () => {
  const joined = joinBridgeDocuments([
    dartDocument,
    parseBridgeFactsDocument({
      ...swiftDocument,
      limitations: [...swiftDocument.limitations, 'mixed-targets: multiple bridges'],
    }),
  ]);

  assert.throws(
    () => createBridgeGraph(joined),
    /Cannot create a graph from a deferred bridge join\./,
  );
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
