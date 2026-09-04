#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { runCheckCommand } from './check-command.ts';
import { runGraphCommand } from './graph-command.ts';
import { runQueryCommand } from './query-command.ts';
import { runRetentionsCommand } from './retentions-command.ts';

const arguments_ = process.argv.slice(2);
const readTextFile = (path: string) => readFile(path, 'utf8');
const result =
  arguments_[0] === 'retentions'
    ? await runRetentionsCommand(arguments_, readTextFile, () => new Date())
    : arguments_[0] === 'query'
      ? await runQueryCommand(arguments_, readTextFile)
      : arguments_[0] === 'graph'
        ? await runGraphCommand(arguments_, readTextFile)
        : await runCheckCommand(arguments_, readTextFile);

process.stdout.write(result.standardOutput);
process.stderr.write(result.standardError);
process.exitCode = result.exitCode;
