import { runCheckCommand } from './check-command.ts';
import { runDiffCommand } from './diff-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runImpactCommand } from './impact-command.ts';
import { runPreflightCommand } from './preflight-command.ts';
import { runQueryCommand } from './query-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';
import type { CommandResult, ReadTextFile, WriteTextFile } from './command-support.ts';

/**
 * stdio 위의 newline-delimited JSON-RPC 2.0 세션이다.
 *
 * MCP(Model Context Protocol) 클라이언트가 `isthmus serve`를 자식 프로세스로
 * 띄우고 한 줄에 메시지 하나씩 주고받는다. 이 모듈은 프레이밍만 담고, 각
 * 도구 호출은 CLI 명령의 argv로 변환해 같은 실행 경로를 재사용한다 —
 * 보고서 형식·종료 코드·한계 보고가 명령과 정확히 일치하도록 하기 위해서다.
 */

/** 현재 서버가 협상할 수 있는 MCP 프로토콜 개정 목록이다. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** JSON-RPC 오류 코드다. 알 수 없는 상수를 만들지 않는다. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** 한 도구가 tools/list에 노출하는 스키마다. */
interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
}

const DOCUMENTS_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  minItems: 2,
  description:
    'Bridge fact document paths to join (GRAPH-EXCHANGE v1/v2 JSON).',
} as const;

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'check',
    description:
      'Join bridge fact documents and report unmatched calls and handlers. '
      + 'Findings are review candidates with limitations preserved, not '
      + 'delete approvals.',
    inputSchema: {
      type: 'object',
      properties: {
        documents: DOCUMENTS_PROPERTY,
        strict: {
          type: 'boolean',
          description: 'Exit nonzero when any finding exists.',
        },
      },
      required: ['documents'],
      additionalProperties: false,
    },
  },
  {
    name: 'query',
    description:
      'Find both sides of a bridge channel or method name across the joined '
      + 'documents.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          description: 'Channel, method, or qualifiedName to look up.',
        },
        documents: DOCUMENTS_PROPERTY,
      },
      required: ['name', 'documents'],
      additionalProperties: false,
    },
  },
  {
    name: 'graph',
    description:
      'Render matched bridge boundary edges as a JSON, DOT, or Mermaid graph.',
    inputSchema: {
      type: 'object',
      properties: {
        documents: DOCUMENTS_PROPERTY,
        format: {
          type: 'string',
          enum: ['json', 'dot', 'mermaid'],
        },
      },
      required: ['documents'],
      additionalProperties: false,
    },
  },
  {
    name: 'diff',
    description:
      'Compare bridge observations before and after a change. Reports '
      + 'observed differences only; it does not infer revision order.',
    inputSchema: {
      type: 'object',
      properties: {
        before: DOCUMENTS_PROPERTY,
        after: DOCUMENTS_PROPERTY,
        strict: {
          type: 'boolean',
          description: 'Exit nonzero only for new errors.',
        },
      },
      required: ['before', 'after'],
      additionalProperties: false,
    },
  },
  {
    name: 'impact',
    description:
      'Inspect which bridge dependencies a changed file or symbol reaches. '
      + 'Exactly one of file, symbol, or changes selects the subject.',
    inputSchema: {
      type: 'object',
      properties: {
        documents: DOCUMENTS_PROPERTY,
        file: { type: 'string', description: 'Changed relative file path.' },
        symbol: { type: 'string', description: 'Changed symbol name or USR.' },
        changes: {
          type: 'string',
          description: 'Path to a changes.json document.',
        },
        runtime: {
          type: 'string',
          description: 'Optional runtime evidence document path.',
        },
        revision: { type: 'string' },
        strict: { type: 'boolean' },
        compact: { type: 'boolean' },
      },
      required: ['documents'],
      additionalProperties: false,
    },
  },
  {
    name: 'preflight',
    description:
      'Trace cross-language impact from a producer analysis context. The '
      + 'context JSON is produced by scripts/capture-preflight.mjs.',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Path to the captured preflight context JSON.',
        },
        runtime: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional runtime evidence document paths.',
        },
        expectations: { type: 'string' },
        revision: { type: 'string' },
        summary: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        explain: { type: 'string' },
        strict: { type: 'boolean' },
        compact: { type: 'boolean' },
      },
      required: ['context'],
      additionalProperties: false,
    },
  },
  {
    name: 'retentions',
    description:
      'Produce external retention evidence for a native analyzer. Pass the '
      + 'result to cartograph dead --external-retentions.',
    inputSchema: {
      type: 'object',
      properties: {
        documents: DOCUMENTS_PROPERTY,
        producer: {
          type: 'string',
          enum: ['cartograph'],
          description: 'Only cartograph is supported today.',
        },
      },
      required: ['documents', 'producer'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

/** 세션이 외부에 필요로 하는 주입이다. */
export interface McpServerDependencies {
  readonly readTextFile: ReadTextFile;
  readonly writeTextFile?: WriteTextFile | undefined;
  readonly producerVersion?: string | undefined;
}

/** JSON-RPC 메시지 한 건을 처리해 응답 라인을 반환하는 세션이다. */
export interface McpSession {
  readonly handleLine: (line: string) => Promise<string | undefined>;
}

/**
 * MCP 세션을 만든다. 반환된 handleLine은 한 줄의 JSON-RPC 메시지를 받아
 * 응답이 필요하면 직렬화된 한 줄을, 알림이면 undefined를 돌려준다.
 */
export function createMcpSession(dependencies: McpServerDependencies): McpSession {
  return {
    handleLine: (line) => handleMessage(dependencies, line),
  };
}

async function handleMessage(
  dependencies: McpServerDependencies,
  line: string,
): Promise<string | undefined> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(errorResponse(undefined, PARSE_ERROR, 'Parse error'));
  }
  if (Array.isArray(message)) {
    // MCP는 배치를 쓰지 않는다. 첫 요소의 id도 모르므로 요청 전체를 거부한다.
    return JSON.stringify(
      errorResponse(undefined, INVALID_REQUEST, 'Batch requests are not supported'),
    );
  }
  if (!isRequestMessage(message)) {
    return JSON.stringify(errorResponse(undefined, INVALID_REQUEST, 'Invalid request'));
  }
  if (message.id === undefined) {
    // 알림은 응답하지 않는다. initialized 등 어떤 알림이든 조용히 무시한다.
    return undefined;
  }
  const response = await dispatchRequest(dependencies, message.method, message.id, message.params);
  return JSON.stringify(response);
}

interface RequestMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

function isRequestMessage(value: unknown): value is RequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

async function dispatchRequest(
  dependencies: McpServerDependencies,
  method: string,
  id: string | number | null,
  params: unknown,
): Promise<JsonRpcResponse> {
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: initializeResult(dependencies, params),
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOL_DEFINITIONS },
      };
    case 'tools/call':
      return toolsCallResult(dependencies, id, params);
    default:
      return errorResponse(id, METHOD_NOT_FOUND, 'Method not found');
  }
}

/** initialize 요청의 프로토콜 버전을 협상하고 서버 정보를 돌려준다. */
function initializeResult(
  dependencies: McpServerDependencies,
  params: unknown,
): Record<string, unknown> {
  const requested = isInitializeParams(params) ? params.protocolVersion : undefined;
  const protocolVersion = requested !== undefined
      && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: {
      name: 'isthmus',
      version: dependencies.producerVersion ?? 'unknown',
    },
  };
}

function isInitializeParams(
  value: unknown,
): value is { readonly protocolVersion: string } {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).protocolVersion === 'string';
}

async function toolsCallResult(
  dependencies: McpServerDependencies,
  id: string | number | null,
  params: unknown,
): Promise<JsonRpcResponse> {
  if (!isToolsCallParams(params)) {
    return errorResponse(id, INVALID_PARAMS, 'tools/call requires name and arguments');
  }
  const tool = TOOL_NAMES.get(params.name);
  if (tool === undefined) {
    return errorResponse(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
  }
  const argv = buildToolArgv(params.name, params.arguments ?? {});
  if (argv === undefined) {
    return errorResponse(id, INVALID_PARAMS, 'Invalid tool arguments');
  }
  const result = await runToolCommand(dependencies, argv);
  return { jsonrpc: '2.0', id, result: commandResultContent(result) };
}

function isToolsCallParams(
  value: unknown,
): value is { readonly name: string; readonly arguments?: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string';
}

/**
 * 도구 인자를 CLI argv로 변환한다. 유효성 검사는 각 명령에 맡기고,
 * 여기서는 형태가 맞지 않는 인자만 undefined로 거른다.
 */
function buildToolArgv(
  toolName: string,
  args: Record<string, unknown>,
): readonly string[] | undefined {
  switch (toolName) {
    case 'check':
      return withDocuments('check', args, (documents) => [
        ...booleanFlag('--strict', args.strict),
        ...documents,
      ]);
    case 'query':
      return typeof args.name === 'string' && args.name.length > 0
        ? withDocuments('query', args, (documents) => [args.name as string, ...documents])
        : undefined;
    case 'graph':
      return withDocuments('graph', args, (documents) => [
        ...enumFlag('--format', args.format, ['json', 'dot', 'mermaid']),
        ...documents,
      ]);
    case 'diff': {
      const before = stringArray(args.before);
      const after = stringArray(args.after);
      if (before === undefined || after === undefined) return undefined;
      return [
        'diff',
        '--before',
        ...before,
        '--after',
        ...after,
        ...booleanFlag('--strict', args.strict),
      ];
    }
    case 'impact': {
      const selectorCount = ['file', 'symbol', 'changes']
        .filter((key) => args[key] !== undefined).length;
      if (selectorCount !== 1) return undefined;
      return withDocuments('impact', args, (documents) => [
        ...valueFlag('--file', args.file),
        ...valueFlag('--symbol', args.symbol),
        ...valueFlag('--changes', args.changes),
        ...documents,
        ...valueFlag('--runtime', args.runtime),
        ...valueFlag('--revision', args.revision),
        ...booleanFlag('--strict', args.strict),
        ...booleanFlag('--compact', args.compact),
      ]);
    }
    case 'preflight': {
      if (typeof args.context !== 'string' || args.context.length === 0) {
        return undefined;
      }
      const runtimePaths = args.runtime === undefined
        ? []
        : stringArray(args.runtime);
      if (runtimePaths === undefined) return undefined;
      const argv = [
        'preflight',
        args.context,
        ...runtimePaths,
        ...valueFlag('--expectations', args.expectations),
        ...valueFlag('--revision', args.revision),
        ...booleanFlag('--summary', args.summary),
        ...booleanFlag('--strict', args.strict),
        ...booleanFlag('--compact', args.compact),
      ];
      if (typeof args.limit === 'number' && Number.isInteger(args.limit)) {
        argv.push('--limit', String(args.limit));
      }
      argv.push(...valueFlag('--explain', args.explain));
      return argv;
    }
    case 'retentions':
      if (args.producer !== 'cartograph') return undefined;
      return withDocuments('retentions', args, (documents) => [
        ...documents,
        '--for',
        'cartograph',
      ]);
    default:
      return undefined;
  }
}

/** documents 인자를 검증하고 argv 앞에 명령 이름을 붙인다. */
function withDocuments(
  command: string,
  args: Record<string, unknown>,
  build: (documents: readonly string[]) => readonly string[],
): readonly string[] | undefined {
  const documents = stringArray(args.documents);
  if (documents === undefined || documents.length < 2) return undefined;
  return [command, ...build(documents)];
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string')
    ? (value as readonly string[])
    : undefined;
}

function booleanFlag(flag: string, value: unknown): readonly string[] {
  return value === true ? [flag] : [];
}

function valueFlag(flag: string, value: unknown): readonly string[] {
  return typeof value === 'string' && value.length > 0 ? [flag, value] : [];
}

function enumFlag(
  flag: string,
  value: unknown,
  allowed: readonly string[],
): readonly string[] {
  return typeof value === 'string' && allowed.includes(value)
    ? [flag, value]
    : [];
}

/** 변환된 argv를 대응하는 명령 실행 함수로 라우팅한다. */
async function runToolCommand(
  dependencies: McpServerDependencies,
  argv: readonly string[],
): Promise<CommandResult> {
  switch (argv[0]) {
    case 'check':
      return runCheckCommand(
        argv,
        dependencies.readTextFile,
        dependencies.writeTextFile,
        undefined,
        dependencies.producerVersion,
      );
    case 'query':
      return runQueryCommand(argv, dependencies.readTextFile);
    case 'graph':
      return runGraphCommand(argv, dependencies.readTextFile);
    case 'diff':
      return runDiffCommand(argv, dependencies.readTextFile);
    case 'impact':
      return runImpactCommand(argv, dependencies.readTextFile);
    case 'preflight':
      return runPreflightCommand(argv, dependencies.readTextFile);
    case 'retentions':
      return dependencies.producerVersion === undefined
        ? {
            standardOutput: '',
            standardError: 'Unable to read package metadata.\n',
            exitCode: 2,
          }
        : runRetentionsCommand(
            argv,
            dependencies.readTextFile,
            () => new Date(),
            dependencies.producerVersion,
          );
    default:
      return {
        standardOutput: '',
        standardError: 'Unknown command.\n',
        exitCode: 64,
      };
  }
}

/**
 * 명령 결과를 MCP 도구 응답으로 옮긴다.
 *
 * stdout에 보고서 문서가 있으면 도구는 일을 한 것이므로 isError를 세지 않는다 —
 * query notFound(64)나 check strict(1)의 정답 문서를 프로토콜 오류로 보내면
 * 소비자가 한계와 조사 결과를 놓친다. 문서가 없는 실패(usage 64·internal 2)만
 * isError로 표시하고 stderr를 함께 실어 원인을 남긴다.
 */
function commandResultContent(result: CommandResult): Record<string, unknown> {
  const content: { type: 'text'; text: string }[] = [];
  if (result.standardOutput.length > 0) {
    content.push({ type: 'text', text: result.standardOutput });
  }
  if (result.standardError.length > 0) {
    content.push({ type: 'text', text: result.standardError });
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: '(no output)\n' });
  }
  return {
    content,
    isError: result.standardOutput.length === 0 && result.exitCode !== 0,
  };
}

function errorResponse(
  id: string | number | null | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}
