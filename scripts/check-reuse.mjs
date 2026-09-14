#!/usr/bin/env node
/** Real stdio/process acceptance, with completion events rather than API polling. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-reuse-acceptance-')));
mkdirSync(join(dir, '.git'));
const clients = new Set();
async function connect(cwd = dir) {
  const client = new Client({ name: 'reuse-acceptance', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/server.mjs')], cwd, env: getDefaultEnvironment(), stderr: 'pipe' }));
  clients.add(client); return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
function ok(result) { assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent; }
const errorCode = result => result.structuredContent?.error?.code;
try {
  const a = await connect(), b = await connect();
  ok(await call(a, 'mmap_declare', { page: 'persistent', title: 'Shared map', layers: [{ id: 'base', name: 'Base', rank: 0 }], nodes: [{ id: 'a', label: 'A', layer: 'base' }, { id: 'b', label: 'B', layer: 'base' }] }));
  // Hold a real lock in a third process until its stdin is released. This makes
  // cross-process exclusion deterministic rather than hoping requests overlap.
  const holder = spawn(process.execPath, ['--input-type=module', '-e',
    'import {readSync,writeSync} from "node:fs"; const {withStoreLock}=await import(process.argv[1]); withStoreLock(process.argv[2],()=>{writeSync(1,"locked\\n");readSync(0,Buffer.alloc(1),0,1,null);});',
    pathToFileURL(join(root, 'lib/store/transaction.js')).href, join(dir, '.mellos/map.json')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const ended = new Promise(resolve => holder.once('close', resolve));
  const deadline = setTimeout(() => holder.kill(), 15000);
  try {
    await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); holder.once('exit', () => reject(new Error('Lock holder exited before readiness'))); });
    assert.equal(errorCode(await call(b, 'mmap_update', { page: 'persistent', updates: [{ id: 'a', label: 'Must not write' }] })), 'BUSY');
  } finally { holder.stdin.end('q'); const code = await ended; clearTimeout(deadline); assert.equal(code, 0); }
  const revision = ok(await call(a, 'mmap_read', { resource: 'map', page: 'persistent' })).revision;
  const attempts = await Promise.all([
    call(a, 'mmap_update', { page: 'persistent', expectedRevision: revision, updates: [{ id: 'a', label: 'A revised' }] }),
    call(b, 'mmap_update', { page: 'persistent', expectedRevision: revision, updates: [{ id: 'b', label: 'B revised' }] }),
  ]);
  assert.equal(attempts.filter(r => !r.isError).length, 1);
  assert.ok(attempts.some(r => ['CONFLICT', 'BUSY'].includes(errorCode(r))));
  // Both requests have completed. Reread before retrying the refused writer.
  const refused = attempts.findIndex(r => r.isError);
  const fresh = ok(await call(b, 'mmap_read', { resource: 'map', page: 'persistent' }));
  ok(await call(b, 'mmap_update', { page: 'persistent', expectedRevision: fresh.revision, updates: [{ id: refused === 0 ? 'a' : 'b', label: refused === 0 ? 'A revised' : 'B revised' }] }));
  assert.deepEqual(ok(await call(a, 'mmap_read', { resource: 'nodes', page: 'persistent' })).items.map(n => n.label), ['A revised', 'B revised']);
  // Legacy writers omit CAS but still serialize read/modify/write.
  const legacyArgs = [{ updates: [{ id: 'a', detail: 'A detail' }] }, { updates: [{ id: 'b', detail: 'B detail' }] }];
  const legacy = await Promise.all(legacyArgs.map((args, i) => call(i ? b : a, 'mmap_update', { page: 'persistent', ...args })));
  for (let i = 0; i < legacy.length; i++) { if (errorCode(legacy[i]) === 'BUSY') ok(await call(b, 'mmap_update', { page: 'persistent', ...legacyArgs[i] })); else ok(legacy[i]); }
  assert.deepEqual(ok(await call(a, 'mmap_read', { resource: 'nodes', page: 'persistent', fields: ['detail'] })).items.map(n => n.detail), ['A detail', 'B detail']);
  await a.close(); clients.delete(a);
  mkdirSync(join(dir, 'src'));
  const resumed = await connect(join(dir, 'src'));
  const pages = ok(await call(resumed, 'mmap_read'));
  assert.equal(pages.items[0].id, 'persistent');
  ok(await call(resumed, 'mmap_batch', { page: 'persistent', operations: [{ op: 'update', data: { context: { summary: 'Reused map', next: 'Verify only changed files' }, updates: [{ id: 'a', status: 'done', evidence: 'Independent process acceptance' }] } }] }));
  const final = ok(await call(b, 'mmap_read', { resource: 'map', page: 'persistent' }));
  assert.equal(final.items[0].context.next, 'Verify only changed files');
  assert.equal(existsSync(join(dir, 'src/.mellos')), false);
  console.log('Reuse acceptance: deterministic cross-process exclusion, CAS conflict, legacy writer serialization, process restart, subdirectory discovery and persisted checkpoint passed.');
} finally {
  for (const client of clients) await client.close();
  assert.equal(dirname(dir), realpathSync(tmpdir()));
  assert.ok(basename(dir).startsWith('mellos-reuse-acceptance-'));
  rmSync(dir, { recursive: true, force: true });
}
