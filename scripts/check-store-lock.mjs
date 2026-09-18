#!/usr/bin/env node
/** Built-runtime acceptance using process/pipe events, never timed polling. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const transaction = pathToFileURL(join(root, 'lib/store/transaction.js')).href;
assert.ok(existsSync(fileURLToPath(transaction)), 'Run npm run build before check:locks.');
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-lock-acceptance-')));
const directory = join(temporary, '中文项目 with spaces', '.mellos');
const file = join(directory, 'map.json');
const lock = join(directory, '.write-lock');
const workers = new Set();
mkdirSync(directory, { recursive: true });

function worker(mode, target = file, label = mode) {
  const owned = relative(temporary, target);
  assert.ok(owned && !owned.startsWith('..') && !isAbsolute(owned), 'Worker target must stay inside this test directory.');
  const child = spawn(process.execPath, [join(root, 'scripts/fixtures/store-lock-worker.mjs'), mode, transaction, target, label], {
    cwd: temporary, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  let buffer = '', stderr = '', failure, closed = false, waiting;
  const messages = [];
  function fail(error) { failure ??= error; if (waiting) { waiting.reject(failure); waiting = undefined; } }
  function deliver() {
    if (!waiting || messages.length === 0) return;
    const { type, resolve, reject } = waiting;
    waiting = undefined;
    const message = messages.shift();
    if (message.type !== type) reject(new Error(`${mode}: expected ${type}, received ${JSON.stringify(message)}`));
    else resolve(message);
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { messages.push(JSON.parse(line)); deliver(); }
      catch (error) { fail(error); }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', fail);
  child.stdin.on('error', fail);
  // One failure deadline per worker, never an observation/retry timer.
  const deadline = setTimeout(() => {
    fail(new Error(`${mode}: process event deadline exceeded. ${stderr}`));
    child.kill('SIGKILL');
  }, 20000);
  const ended = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true; clearTimeout(deadline); deliver();
    if (waiting) fail(new Error(`${mode}: exited before ${waiting.type} (code=${code}, signal=${signal}). ${stderr}`));
    resolve({ code, signal });
  }));
  const handle = {
    next(type) {
      if (failure) return Promise.reject(failure);
      if (waiting) return Promise.reject(new Error(`${mode}: overlapping event waits.`));
      if (closed && messages.length === 0) return Promise.reject(new Error(`${mode}: no ${type} event before exit. ${stderr}`));
      return new Promise((resolve, reject) => { waiting = { type, resolve, reject }; deliver(); });
    },
    send(command) { child.stdin.write(command + '\n'); },
    async exit(killed = false) {
      const result = await ended;
      if (failure) throw failure;
      if (killed) assert.ok(result.signal || result.code !== 0, `${mode}: expected forced termination.`);
      else assert.equal(result.code, 0, `${mode}: ${stderr}`);
    },
    kill() { assert.equal(child.kill('SIGKILL'), true, `${mode}: process was already gone.`); },
    async cleanup() { if (!closed) child.kill('SIGKILL'); await ended; },
  };
  workers.add(handle);
  return handle;
}

async function write(target, label, expected = 'OK', mode = 'write') {
  const writer = worker(mode, target, label);
  const result = await writer.next('result');
  await writer.exit();
  assert.equal(result.code, expected, result.message);
  assert.equal(result.executed, expected === 'OK', 'Refused writes must never enter the callback.');
}

async function release(holder) {
  holder.send('release'); await holder.next('released'); await holder.exit();
}

function identity(path) {
  const value = statSync(path, { bigint: true });
  assert.ok(value.isFile());
  return [value.dev, value.ino, value.birthtimeNs];
}

function snapshot(path) {
  const value = lstatSync(path, { bigint: true });
  return value.isDirectory()
    ? { inode: value.ino, mtime: value.mtimeNs, children: Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])) }
    : { inode: value.ino, mtime: value.mtimeNs, bytes: readFileSync(path).toString('base64') };
}

try {
  const first = worker('hold');
  await first.next('locked');
  const permanent = identity(lock);
  await write(file, 'must not write', 'BUSY');
  await write(join(directory, 'pages/另一页.json'), 'named page must not write', 'BUSY');
  assert.equal(existsSync(file), false);
  await release(first);
  await write(file, '正常释放之后');
  assert.deepEqual(identity(lock), permanent);

  // Release and close are separate operations. Closing A's old descriptor
  // after B takes over must not release B's independently opened lock.
  const old = worker('old-fd'); await old.next('locked');
  old.send('unlock'); await old.next('unlocked');
  const successor = worker('hold'); await successor.next('locked');
  old.send('close'); await old.next('closed'); await old.exit();
  await write(file, 'old cleanup must not unlock successor', 'BUSY');
  await release(successor);
  await write(file, '交接之后');
  assert.deepEqual(identity(lock), permanent);

  const doomed = worker('hold'); await doomed.next('locked');
  const kernelWait = worker('wait-for-kernel-release'); await kernelWait.next('waiting');
  doomed.kill(); await doomed.exit(true);
  await kernelWait.next('locked');
  await release(kernelWait);
  await write(file, '进程终止之后');
  assert.deepEqual(identity(lock), permanent);

  // A permanent file also excludes the frozen 0.24.0 mkdir/owner protocol.
  const beforeLegacy = readFileSync(file, 'utf8');
  await write(file, 'old protocol must not enter', 'BUSY', 'legacy');
  assert.equal(readFileSync(file, 'utf8'), beforeLegacy);
  assert.deepEqual(identity(lock), permanent);

  for (const label of ['重新启动一', '重新启动二', '重新启动三']) await write(file, label);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')),
    ['正常释放之后', '交接之后', '进程终止之后', '重新启动一', '重新启动二', '重新启动三']);
  assert.deepEqual(identity(lock), permanent);

  const legacyDirectory = join(temporary, '旧项目', '.mellos', '.write-lock');
  mkdirSync(join(legacyDirectory, '.reap'), { recursive: true });
  writeFileSync(join(legacyDirectory, 'owner.json'), '{"pid":2147483647,"token":"legacy-owner"}\n');
  writeFileSync(join(legacyDirectory, '.reap', 'keep.txt'), 'preserve recovery evidence');
  const legacySnapshot = snapshot(legacyDirectory);
  const legacyFile = join(dirname(legacyDirectory), 'map.json');
  await write(legacyFile, 'must preserve old directory', 'LOCK_MIGRATION_REQUIRED');
  assert.equal(existsSync(legacyFile), false);
  assert.deepEqual(snapshot(legacyDirectory), legacySnapshot);
  console.log('Store lock acceptance passed: cross-process BUSY without callback, permanent file identity, successor cleanup, forced termination recovery, old-writer exclusion, preserved migration evidence, and Unicode process restarts.');
  console.log('All coordination used process/pipe events; only the termination test used an upstream blocking OS lock wait. Product contention remains immediate BUSY.');
} finally {
  await Promise.all([...workers].map(child => child.cleanup()));
  assert.equal(dirname(temporary), realpathSync(tmpdir()));
  assert.ok(basename(temporary).startsWith('mellos-lock-acceptance-'));
  rmSync(temporary, { recursive: true, force: true });
}
