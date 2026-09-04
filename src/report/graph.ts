import type {
  BridgeLocation,
  BridgePlatform,
  BridgeSymbol,
  BridgeTarget,
} from '../exchange/parse.ts';
import type {
  BridgeEndpoint,
  BridgeJoinResult,
  JoinLimitation,
} from '../join/join.ts';
import { compareStrings } from '../compare.ts';
import { encodeSortedJson } from './sorted-json.ts';

/** 소스 위치 하나를 나타내는 경계 그래프 노드다. */
export interface BridgeGraphNode {
  readonly id: string;
  readonly platform: BridgePlatform;
  readonly location: BridgeLocation;
  readonly symbol?: BridgeSymbol;
}

/** 호출 측 위치에서 수신 측 위치로 향하는 경계 간선이다. */
export interface BridgeGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'channel' | 'method';
  readonly target: BridgeTarget;
  readonly channel: string;
  readonly method?: string;
}

/** 매치된 경계 간선만 담는 그래프 문서다. */
export interface BridgeGraphDocument {
  readonly format: 'isthmus-graph';
  readonly version: 1;
  readonly nodes: readonly BridgeGraphNode[];
  readonly edges: readonly BridgeGraphEdge[];
  readonly limitations: readonly JoinLimitation[];
}

/** 한 번에 생성할 수 있는 경계 그래프 간선 수다. */
export const MAX_GRAPH_EDGES = 100_000;

/** 입력 증거의 곱이 안전한 그래프 크기를 넘었음을 나타낸다. */
export class BridgeGraphLimitError extends Error {
  constructor() {
    super(`Bridge graph exceeds the ${MAX_GRAPH_EDGES} edge limit.`);
    this.name = 'BridgeGraphLimitError';
  }
}

/** 같은 위치 노드가 서로 모순된 심볼을 가졌음을 나타낸다. */
export class BridgeGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeGraphValidationError';
  }
}

/** 경계 그래프를 요청한 출력 형식으로 렌더링한다. */
export function renderBridgeGraph(
  graph: BridgeGraphDocument,
  format: 'json' | 'dot' | 'mermaid',
): string {
  if (format === 'json') return encodeSortedJson(graph);
  if (format === 'dot') return renderDot(graph);
  return renderMermaid(graph);
}

/** Mermaid flowchart 문법으로 경계 그래프를 렌더링한다. */
function renderMermaid(graph: BridgeGraphDocument): string {
  const identifiers = new Map(
    graph.nodes.map((node, index) => [node.id, `n${index}`]),
  );
  const lines = ['flowchart LR'];
  for (const limitation of graph.limitations) {
    lines.push(`  %% limitation: ${limitationComment(limitation)}`);
  }
  for (const node of graph.nodes) {
    const label = `${mermaidText(node.platform)}<br/>${mermaidText(locationLabel(node.location))}`;
    lines.push(`  ${identifiers.get(node.id)}["${label}"]`);
  }
  for (const edge of graph.edges) {
    const from = identifiers.get(edge.from);
    const to = identifiers.get(edge.to);
    lines.push(`  ${from} -->|"${mermaidText(edgeLabel(edge))}"| ${to}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Mermaid 인용 라벨에서 제어 문자를 HTML 엔터티로 바꾼다. */
function mermaidText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;');
}

/** Graphviz DOT 문법으로 경계 그래프를 렌더링한다. */
function renderDot(graph: BridgeGraphDocument): string {
  const lines = ['digraph isthmus {', '  rankdir=LR;'];
  for (const limitation of graph.limitations) {
    lines.push(`  // limitation: ${limitationComment(limitation)}`);
  }
  for (const node of graph.nodes) {
    const label = `${node.platform}\n${locationLabel(node.location)}`;
    lines.push(`  ${dotString(node.id)} [label=${dotString(label)}];`);
  }
  for (const edge of graph.edges) {
    lines.push(
      `  ${dotString(edge.from)} -> ${dotString(edge.to)} `
      + `[label=${dotString(edgeLabel(edge))}];`,
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** 분석 한계를 텍스트 그래프의 한 줄 주석으로 안전하게 만든다. */
function limitationComment(limitation: JoinLimitation): string {
  const text = `${limitation.platform}/${limitation.tool}: ${limitation.message}`;
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ');
}

/** DOT 문자열 리터럴로 안전하게 이스케이프한다. */
function dotString(value: string): string {
  return JSON.stringify(value);
}

/** 위치를 사람이 읽을 수 있는 경로:줄:열로 만든다. */
function locationLabel(location: BridgeLocation): string {
  return `${location.path}:${location.line}:${location.column}`;
}

/** 간선 종류와 문자열 키를 한 줄 라벨로 만든다. */
function edgeLabel(edge: BridgeGraphEdge): string {
  const key = edge.method === undefined
    ? edge.channel
    : `${edge.channel}#${edge.method}`;
  return `${edge.kind} ${key}`;
}

/** 조인 결과의 매치만 경계 그래프로 바꾼다. */
export function createBridgeGraph(joined: BridgeJoinResult): BridgeGraphDocument {
  assertBridgeGraphSize(joined);
  const nodes = new Map<string, BridgeGraphNode>();
  const edges: BridgeGraphEdge[] = [];
  addChannelEdges(joined, nodes, edges);
  addMethodEdges(joined, nodes, edges);
  return {
    format: 'isthmus-graph',
    version: 1,
    nodes: [...nodes.values()].sort((left, right) => compareStrings(left.id, right.id)),
    edges: edges.sort(compareEdges),
    limitations: joined.limitations,
  };
}

/** 모든 Cartesian 간선 수를 할당 전에 계산해 메모리 폭증을 막는다. */
export function assertBridgeGraphSize(joined: BridgeJoinResult): void {
  let edgeCount = 0;
  const endpointCounts = [
    ...joined.matchedChannels.map(({ creations, registrations }) =>
      [creations.length, registrations.length] as const,
    ),
    ...joined.matchedMethods.map(({ invocations, handlers }) =>
      [invocations.length, handlers.length] as const,
    ),
  ];
  for (const [fromCount, toCount] of endpointCounts) {
    if (
      toCount > 0 &&
      fromCount > Math.floor((MAX_GRAPH_EDGES - edgeCount) / toCount)
    ) {
      throw new BridgeGraphLimitError();
    }
    edgeCount += fromCount * toCount;
  }
}

/** 매치된 채널의 생성→등록 간선을 추가한다. */
function addChannelEdges(
  joined: BridgeJoinResult,
  nodes: Map<string, BridgeGraphNode>,
  edges: BridgeGraphEdge[],
): void {
  for (const match of joined.matchedChannels) {
    for (const creation of match.creations) {
      for (const registration of match.registrations) {
        const from = addNode(nodes, creation);
        const to = addNode(nodes, registration);
        edges.push({
          from,
          to,
          kind: 'channel',
          target: match.target,
          channel: match.channel,
        });
      }
    }
  }
}

/** 매치된 메서드의 호출→핸들러 간선을 추가한다. */
function addMethodEdges(
  joined: BridgeJoinResult,
  nodes: Map<string, BridgeGraphNode>,
  edges: BridgeGraphEdge[],
): void {
  for (const match of joined.matchedMethods) {
    for (const invocation of match.invocations) {
      for (const handler of match.handlers) {
        const from = addNode(nodes, invocation);
        const to = addNode(nodes, handler);
        edges.push({
          from,
          to,
          kind: 'method',
          target: match.target,
          channel: match.channel,
          method: match.method,
        });
      }
    }
  }
}

/** 증거 위치를 그래프 노드로 추가하고 안정 ID를 돌려준다. */
function addNode(
  nodes: Map<string, BridgeGraphNode>,
  endpoint: BridgeEndpoint,
): string {
  const id = endpointId(endpoint);
  const existing = nodes.get(id);
  if (existing === undefined) {
    nodes.set(
      id,
      endpoint.symbol === undefined
        ? { id, platform: endpoint.platform, location: endpoint.location }
        : {
            id,
            platform: endpoint.platform,
            location: endpoint.location,
            symbol: endpoint.symbol,
      },
    );
  } else if (endpoint.symbol !== undefined) {
    const symbol = mergeSymbols(existing.symbol, endpoint.symbol);
    if (symbol === undefined) {
      throw new BridgeGraphValidationError(
        'Bridge graph node has conflicting symbols.',
      );
    }
    nodes.set(id, { ...existing, symbol });
  }
  return id;
}

/** 호환되는 두 심볼을 더 구체적인 선언 식별자로 병합한다. */
function mergeSymbols(
  left: BridgeSymbol | undefined,
  right: BridgeSymbol,
): BridgeSymbol | undefined {
  if (left === undefined) return right;
  if (left.qualifiedName !== right.qualifiedName) return undefined;
  if (left.usr !== undefined && right.usr !== undefined && left.usr !== right.usr) {
    return undefined;
  }
  const usr = left.usr ?? right.usr;
  return usr === undefined
    ? { qualifiedName: left.qualifiedName }
    : { qualifiedName: left.qualifiedName, usr };
}

/** 플랫폼과 소스 위치로 실행 간 안정적인 노드 ID를 만든다. */
function endpointId(endpoint: BridgeEndpoint): string {
  const { path, line, column } = endpoint.location;
  return `${endpoint.platform}:${path}:${line}:${column}`;
}

/** 간선을 종류·from·to 순으로 고정한다. */
function compareEdges(left: BridgeGraphEdge, right: BridgeGraphEdge): number {
  return (
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.from, right.from) ||
    compareStrings(left.to, right.to)
  );
}
