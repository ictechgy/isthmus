#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { runCheckCommand } from './check-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';

const arguments_ = process.argv.slice(2);
const readTextFile = (path: string) => readFile(path, 'utf8');
const result =
  arguments_[0] === 'retentions'
    ? await runRetentionsCommand(arguments_, readTextFile, () => new Date())
    : await runCheckCommand(arguments_, readTextFile);

process.stdout.write(result.standardOutput);
process.stderr.write(result.standardError);
process.exitCode = result.exitCode;
