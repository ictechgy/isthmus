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
        tool: 'test-tool',
        message: 'dynamic-name:\nflowchart TD',
      },
    ],
  };

  const dot = renderBridgeGraph(graph, 'dot');
  const mermaid = renderBridgeGraph(graph, 'mermaid');

  assert.equal(
    dot.includes('  // limitation: dart/test-tool: dynamic-name: flowchart TD\n'),
    true,
  );
  assert.equal(
    mermaid.includes('  %% limitation: dart/test-tool: dynamic-name: flowchart TD\n'),
    true,
  );
  assert.equal(dot.includes('\nflowchart TD'), false);
  assert.equal(mermaid.includes('\nflowchart TD'), false);
});

test('그래프 간선 수가 안전 상한을 넘으면 생성 전에 거부한다', () => {
  const joined: BridgeJoinResult = {
    deferred: false,
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
    matchedMethods: [],
    unhandledInvocations: [],
    handlersWithoutInvocations: [],
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
    matchedChannels: [],
    unregisteredChannelCreations: [],
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
    matchedChannels: [],
    unregisteredChannelCreations: [],
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
    limitations: [],
  };

  const graph = createBridgeGraph(joined);
  const receiverNode = graph.nodes.find(({ id }) => id.startsWith('swift:'));

  assert.deepEqual(receiverNode?.symbol, {
    qualifiedName: 'Plugin.handle',
    usr: 's:Plugin.handle',
  });
});

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
