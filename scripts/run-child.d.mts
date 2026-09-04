import type { SpawnSyncReturns } from 'node:child_process';

export interface RunChildOptions {
  readonly cwd?: string;
  readonly maxBuffer?: number;
  readonly timeout?: number;
  readonly stdio?: 'inherit';
}

export type RunChildResult = SpawnSyncReturns<string> & {
  readonly error?: NodeJS.ErrnoException;
};

export function runChild(
  command: string,
  arguments_: readonly string[],
  options?: RunChildOptions,
): RunChildResult;
