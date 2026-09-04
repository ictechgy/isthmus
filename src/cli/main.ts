#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { runCheckCommand } from './check-command.ts';

const result = await runCheckCommand(
  process.argv.slice(2),
  (path) => readFile(path, 'utf8'),
);

process.stdout.write(result.standardOutput);
process.stderr.write(result.standardError);
process.exitCode = result.exitCode;
