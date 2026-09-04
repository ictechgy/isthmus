import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseBridgeFactsDocument,
  type BridgeFactsDocument,
} from '../exchange/parse.ts';
import { joinBridgeDocuments } from '../join/join.ts';
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

/** 저장된 교환 JSON을 제품 파서로 검증한다. */
async function loadDocument(relativePath: string): Promise<BridgeFactsDocument> {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseBridgeFactsDocument(JSON.parse(text));
}
