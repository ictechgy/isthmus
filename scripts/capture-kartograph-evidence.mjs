import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBridgeFactsDocument } from '../dist/exchange/parse.js';
import { parseLanguageTraversal } from '../dist/exchange/language-traversal.js';
import { parseKartographFreshness, parseKartographReceipt } from '../dist/exchange/kartograph-receipt.js';
import { compareKartographReceipt } from '../dist/report/kartograph-receipt.js';
import { encodeSortedJson } from '../dist/report/sorted-json.js';
import { runChild } from './run-child.mjs';

const MAX = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** 명시적으로 승인한 Kartograph 실행 문맥만 사용하며 source/config 검증은 native verifier에 맡긴다. */
export async function captureKartographEvidence(raw, base = process.cwd(), onStep = () => {}) {
  const fail = message => { throw new Error(message); };
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\x00-\x1f\x7f]/u.test(value);
  if (raw?.format !== 'isthmus-kartograph-capture' || raw.version !== 1 || !Array.isArray(raw.command)
    || raw.command.length < 1 || raw.command.length > 32 || !raw.command.every(text)
    || !text(raw.project) || !text(raw.snapshot) || !text(raw.output)
    || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(raw.scope ?? '')
    || !Array.isArray(raw.runtimeFiles) || raw.runtimeFiles.length > 100 || !raw.runtimeFiles.every(text)
    || raw.inputBindings !== undefined && !text(raw.inputBindings)) fail('Invalid Kartograph capture configuration.');
  const project = resolve(base, raw.project), snapshot = resolve(base, raw.snapshot), output = resolve(base, raw.output);
  if (!isAbsolute(raw.command[0])) fail('Kartograph command must be an explicit absolute executable path.');
  const command = raw.command[0], prefix = raw.command.slice(1);
  const runtimeFiles = [command, ...raw.runtimeFiles.map(path => resolve(base, path))];
  const read = async path => {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.size > MAX) fail('Capture input must be a bounded regular file.');
    const bytes = await readFile(path);
    if (bytes.length > MAX) fail('Capture input grew beyond its size limit.');
    return bytes;
  };
  const producerHash = async () => {
    const digests = [];
    for (const path of runtimeFiles) {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.size > 512 * 1024 * 1024) fail('Producer input must be a bounded regular file.');
      const digest = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(path)) {
        bytes += chunk.length;
        if (bytes > 512 * 1024 * 1024) fail('Producer input grew beyond its size limit.');
        digest.update(chunk);
      }
      digests.push(digest.digest('hex'));
    }
    return hash(JSON.stringify(digests));
  };
  const execute = (stage, args, allowed = [0]) => {
    const result = runChild(command, [...prefix, ...args], { cwd: project, timeout: 60_000, maxBuffer: MAX });
    onStep(stage, result);
    if (result.error || !allowed.includes(result.status) || typeof result.stdout !== 'string' || result.stdout.length > MAX) {
      fail(`Kartograph ${stage} failed; no completed receipt was written.`);
    }
    return result;
  };
  const snapshotBytes = await read(snapshot), sourceSnapshot = JSON.parse(snapshotBytes.toString('utf8'));
  const producerBefore = await producerHash();
  const version = /^kartograph ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)\s*$/u.exec(execute('version', ['--version']).stdout)?.[1];
  if (version === undefined || sourceSnapshot.toolVersion !== version) fail('Snapshot and Kartograph analyzer versions differ.');
  const common = ['--project', project, '--graph-file', snapshot];
  const verify = () => {
    const result = execute('verify-snapshot', ['verify-snapshot', ...common, '--scope', raw.scope,
      ...(raw.inputBindings === undefined ? [] : ['--input-bindings', resolve(base, raw.inputBindings)])], [0, 1]);
    const value = JSON.parse(result.stdout), parsed = parseKartographFreshness(value);
    if (result.status !== (parsed.status === 'matched' ? 0 : 1)) fail('Native freshness status contradicts its exit code.');
    return value;
  };
  const before = verify();
  // 기존 디렉터리를 재사용하지 않아 오래된 출력과 새 receipt를 섞지 않는다.
  await mkdir(output, { mode: 0o700 });
  await writeFile(resolve(output, 'snapshot.json'), snapshotBytes, { flag: 'wx', mode: 0o600 });
  const factsText = execute('schema', ['schema', ...common, '--format', 'json']).stdout;
  const facts = parseBridgeFactsDocument(JSON.parse(factsText));
  if (facts.platform !== 'kotlin' || facts.target !== 'persistence' || resolve(facts.project) !== project
    || facts.tool.name !== 'kartograph' || facts.tool.version !== version) fail('Schema output does not match the selected producer/project.');
  await writeFile(resolve(output, 'persistence.json'), factsText, { flag: 'wx', mode: 0o600 });
  const artifacts = [{ id: 'kartograph-persistence', role: 'bridge-facts', sha256: hash(factsText) }];
  const roots = [...new Set(facts.facts.flatMap(fact => fact.symbol?.usr ? [fact.symbol.usr] : []))].sort();
  const limitations = [];
  if (roots.length > 1000) fail('Kartograph capture roots exceed their limit.');
  if (roots.length > 0) {
    const rootsPath = resolve(output, 'roots.json');
    await writeFile(rootsPath, JSON.stringify(roots) + '\n', { flag: 'wx', mode: 0o600 });
    const traversalText = execute('impact', ['impact', ...common, '--format', 'language-traversal', '--roots-from', rootsPath]).stdout;
    const traversal = parseLanguageTraversal(JSON.parse(traversalText));
    if (traversal.platform !== 'kotlin' || traversal.direction !== 'dependents' || resolve(traversal.project) !== project
      || traversal.tool.name !== 'kartograph' || traversal.tool.version !== version) fail('Traversal output does not match the selected producer/project.');
    await writeFile(resolve(output, 'reverse.json'), traversalText, { flag: 'wx', mode: 0o600 });
    artifacts.push({ id: 'kartograph-reverse', role: 'traversal', sha256: hash(traversalText) });
  } else limitations.push('no-persistence-symbol-roots');
  const after = verify();
  const receipt = { format: 'isthmus-kartograph-receipt', version: 1, producer: { name: 'kartograph', version }, scope: raw.scope,
    snapshotSha256: hash(snapshotBytes), producerSha256: producerBefore,
    witnessCount: sourceSnapshot.provenance?.witnesses?.length ?? 0, before, after, artifacts, limitations,
    stableSnapshot: hash(await read(snapshot)) === hash(snapshotBytes), stableProducer: await producerHash() === producerBefore };
  const parsed = parseKartographReceipt(receipt);
  await writeFile(resolve(output, 'receipt.json'), encodeSortedJson(receipt), { flag: 'wx', mode: 0o600 });
  return { nativeAtCapture: compareKartographReceipt(parsed, true, []).nativeAtCapture, receipt, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('Usage: node capture-kartograph-evidence.mjs <capture.json>\n'); process.exitCode = 64; }
  else {
    try {
      const config = resolve(process.argv[2]);
      const entry = await lstat(config);
      if (!entry.isFile() || entry.size > 1024 * 1024) throw new Error('Invalid capture config.');
      const result = await captureKartographEvidence(JSON.parse(await readFile(config, 'utf8')), dirname(config));
      process.stdout.write(JSON.stringify({ nativeAtCapture: result.nativeAtCapture, currentVerification: 'unverified' }) + '\n');
    } catch { process.stderr.write('Kartograph capture failed; check the explicit producer, snapshot, scope and input bindings.\n'); process.exitCode = 2; }
  }
}
