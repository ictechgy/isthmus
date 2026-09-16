import { createInterface } from 'node:readline';

import { createMcpSession } from './mcp-server.ts';
import type {
  CommandResult,
  ReadTextFile,
  WriteTextFile,
} from './command-support.ts';

export const serveUsage = 'Usage: isthmus serve';

/** 세션이 읽는 NDJSON 입력과 응답을 쓰는 싱크다. 테스트는 메모리로 주입한다. */
export interface ServeIo {
  readonly lines: AsyncIterable<string>;
  readonly writeLine: (line: string) => void;
}

/**
 * stdin의 한 줄씩 들어오는 JSON-RPC 메시지를 MCP 세션에 넘기고
 * 응답을 stdout에 쓴다. stdin이 닫히면 0으로 끝난다 — 세션은
 * 상태를 쌓지 않으므로 종료 시 잃는 것이 없다.
 */
export async function runServeCommand(
  arguments_: readonly string[],
  readTextFile: ReadTextFile,
  writeTextFile?: WriteTextFile,
  producerVersion?: string,
  io?: ServeIo,
): Promise<CommandResult> {
  if (arguments_[0] !== 'serve' || arguments_.length !== 1) {
    return {
      standardOutput: '',
      standardError: `${serveUsage}\n`,
      exitCode: 64,
    };
  }
  const session = createMcpSession({
    readTextFile,
    writeTextFile,
    producerVersion,
  });
  const { lines, writeLine } = io ?? stdioLines();
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const response = await session.handleLine(line);
    if (response !== undefined) {
      writeLine(response);
    }
  }
  return { standardOutput: '', standardError: '', exitCode: 0 };
}

/** stdin을 줄 단위로 읽고 stdout에 한 줄씩 쓰는 기본 IO다. */
function stdioLines(): ServeIo {
  return {
    lines: createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    }),
    writeLine: (line) => process.stdout.write(`${line}\n`),
  };
}
