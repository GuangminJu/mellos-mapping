import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openWebPreview, webRuntimeFile } from './launcher.js';
import { STORE_LOCK_PROTOCOL } from '../store/transaction.js';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.mocked(spawn).mockClear();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each([undefined, STORE_LOCK_PROTOCOL])('reuses only a viewer that shares the writer protocol: %s', async protocol => {
  const root = mkdtempSync(join(tmpdir(), 'mellos-viewer-protocol-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, '.mellos', 'map.json');
  const token = '1'.repeat(48);
  const methods: string[] = [];
  const server = createServer((req, res) => {
    methods.push(req.method!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ file, formats: [1, 2], surfaces: ['web'], lockProtocol: protocol }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  mkdirSync(dirname(webRuntimeFile(file)), { recursive: true });
  writeFileSync(webRuntimeFile(file), JSON.stringify({ port: address.port, token }));
  if (protocol === undefined) {
    await expect(openWebPreview(file, 'must-not-launch.mjs')).rejects.toMatchObject({ code: 'LOCK_MIGRATION_REQUIRED' });
  } else {
    await expect(openWebPreview(file, 'must-not-launch.mjs')).resolves.toBe(`http://127.0.0.1:${address.port}/${token}/`);
  }
  expect(methods).toEqual(['GET']);
  expect(spawn).not.toHaveBeenCalled();
});

it('refuses an older viewer that recovers while waiting for a new service to start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mellos-viewer-recovery-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, '.mellos', 'map.json');
  const token = '2'.repeat(48);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    // The old service is initially unavailable, then resumes without the new
    // lock protocol. Discovery during the startup wait must also reject it.
    res.statusCode = requests.length === 1 ? 503 : 200;
    res.end(JSON.stringify({ file, formats: [1, 2], surfaces: ['web', 'web-terminal'] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  mkdirSync(dirname(webRuntimeFile(file)), { recursive: true });
  writeFileSync(webRuntimeFile(file), JSON.stringify({ port: address.port, token }));
  const entry = join(root, 'new-web.mjs');
  writeFileSync(entry, '// The process boundary is stubbed; discovery uses the real HTTP service.\n');
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

  await expect(openWebPreview(file, entry, undefined, true)).rejects.toMatchObject({ code: 'LOCK_MIGRATION_REQUIRED' });
  expect(spawn).toHaveBeenCalledOnce();
  expect(requests).toEqual([`GET /${token}/api/health`, `GET /${token}/api/health`]);
});
