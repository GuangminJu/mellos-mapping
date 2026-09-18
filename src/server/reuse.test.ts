import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { resolveProjectDirectory } from '../store/project.js';
import { withStoreLock } from '../store/transaction.js';

let dir: string, file: string, client: Client;
async function connect() {
  const server = buildServer(file, join(dir, 'user-config.json'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'reuse-spec', version: '1' });
  await Promise.all([client.connect(a), server.connect(b)]);
}
beforeEach(async () => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-reuse-'))); file = join(dir, '.mellos/map.json'); await connect(); });
afterEach(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });
const design = { page: 'architecture', title: 'Persistent services', layers: [{ id: 'base', name: 'Base', rank: 0 }, { id: 'top', name: 'Top', rank: 1 }], lanes: [{ id: 'server', label: 'Server' }, { id: 'client', label: 'Client' }], groups: [{ id: 'storage', label: 'Storage', layer: 'base' }], nodes: [{ id: 'store', label: 'Database', layer: 'base', group: 'storage', status: 'done', evidence: 'tests passed', detail: 'Storage contract' }, { id: 'codec', label: 'Encoder', layer: 'base' }, { id: 'api', label: 'Public API', layer: 'top' }], edges: [{ from: 'api', to: 'store', label: 'reads' }] };
async function call(name: string, args: Record<string, unknown> = {}) { return client.callTool({ name, arguments: args }); }
async function data(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const result = await call(name, args);
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent!;
}
const read = (args: Record<string, unknown> = {}) => data('mmap_read', { page: 'architecture', ...args });

it('discovers persisted pages, reads exact IDs after restart, and preserves evidence on incremental edits', async () => {
  await data('mmap_declare', { ...design, expectedRevision: 'absent', context: { summary: 'Payment services', next: 'Verify API' } });
  await client.close(); await connect();
  expect(client.getInstructions()).toContain('new conversation is not a new effort');
  const pages = await read();
  expect(pages.items[0]).toMatchObject({ id: 'architecture', title: 'Persistent services', context: { next: 'Verify API' } });
  const node = await read({ resource: 'nodes', id: 'store', fields: ['detail', 'evidence', 'status'] });
  expect(node.items).toEqual([{ id: 'store', detail: 'Storage contract', evidence: 'tests passed', status: 'done' }]);
  await data('mmap_update', { page: 'architecture', expectedRevision: node.revision, updates: [{ id: 'api', label: 'Gateway' }] });
  expect((await read({ resource: 'nodes', id: 'store', fields: ['evidence', 'status'] })).items[0]).toMatchObject({ status: 'done', evidence: 'tests passed' });
});

it('distinguishes an empty list, absent page and missing ID without creating files', async () => {
  expect((await read()).items).toEqual([]);
  expect(existsSync(file)).toBe(false);
  const missing = await call('mmap_read', { resource: 'map', page: 'typo' });
  expect(missing.isError).toBe(true);
  expect(missing.structuredContent).toMatchObject({ error: { code: 'NOT_FOUND' } });
  await data('mmap_declare', design);
  expect((await call('mmap_read', { resource: 'nodes', page: 'architecture', id: 'typo' })).structuredContent).toMatchObject({ error: { code: 'NOT_FOUND' } });
});

it('uses bounded projected reads, filters and revision-bound cursors', async () => {
  await data('mmap_declare', design);
  const first = await read({ resource: 'nodes', limit: 1 });
  expect(first.items).toHaveLength(1); expect(first.items[0].detail).toBeUndefined();
  const second = await read({ resource: 'nodes', limit: 1, cursor: first.nextCursor });
  expect(second.items[0].id).toBe('codec');
  expect((await read({ resource: 'nodes', status: 'done' })).items.map((n: any) => n.id)).toEqual(['store']);
  expect((await read({ resource: 'nodes', ifRevision: first.revision })).notModified).toBe(true);
  expect((await call('mmap_read', { resource: 'nodes', page: 'architecture', limit: 2, cursor: first.nextCursor })).structuredContent).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
  await data('mmap_update', { page: 'architecture', updates: [{ id: 'api', label: 'Changed' }] });
  expect((await call('mmap_read', { resource: 'nodes', page: 'architecture', limit: 1, cursor: first.nextCursor })).structuredContent).toMatchObject({ error: { code: 'CONFLICT' } });
});

it('rejects stale writes and duplicate creation while returning the new revision', async () => {
  const created = await data('mmap_declare', { ...design, expectedRevision: 'absent' });
  const changed = await data('mmap_update', { page: 'architecture', expectedRevision: created.revision, title: 'New title', kind: 'architecture' });
  expect(changed.revision).not.toBe(created.revision);
  expect((await call('mmap_update', { page: 'architecture', expectedRevision: created.revision, updates: [{ id: 'api', label: 'Stale' }] })).structuredContent).toMatchObject({ error: { code: 'CONFLICT' } });
  expect((await call('mmap_declare', { ...design, expectedRevision: 'absent' })).structuredContent).toMatchObject({ error: { code: 'CONFLICT' } });
  expect((await read({ resource: 'map' })).items[0]).toMatchObject({ title: 'New title', kind: 'architecture' });
});

it('updates edge endpoints and clears labels without an intermediate deletion', async () => {
  await data('mmap_declare', design);
  await data('mmap_update', { page: 'architecture', edges: [{ from: 'api', to: 'store', newTo: 'codec', label: null }] });
  expect((await read({ resource: 'edges' })).items).toEqual([{ id: 'api->codec', from: 'api', to: 'codec' }]);
  expect((await call('mmap_update', { page: 'architecture', edges: [{ from: 'api', to: 'codec', newFrom: 'store' }] })).isError).toBe(true);
  expect((await read({ resource: 'edges' })).items[0].id).toBe('api->codec');
});

it('validates coordinated group moves and lane ordering against the final map', async () => {
  await data('mmap_declare', design);
  await data('mmap_batch', { page: 'architecture', operations: [
    { op: 'remove', data: { edges: [{ from: 'api', to: 'store' }] } },
    { op: 'update', data: { groups: [{ id: 'storage', layer: 'top' }], updates: [{ id: 'store', layer: 'top' }], laneOrder: ['client', 'server'] } },
    { op: 'declare', data: { edges: [{ from: 'store', to: 'codec' }] } },
  ] });
  expect((await read({ resource: 'nodes', id: 'store' })).items[0]).toMatchObject({ layer: 'top', group: 'storage', status: 'done' });
  expect((await read({ resource: 'lanes' })).items.map((l: any) => l.id)).toEqual(['client', 'server']);
  expect((await call('mmap_update', { page: 'architecture', laneOrder: ['client', 'client'] })).isError).toBe(true);
});

it('leaves byte-identical state after a failed mixed transaction', async () => {
  await data('mmap_declare', design);
  const pageFile = join(dir, '.mellos/pages/architecture.json'), before = readFileSync(pageFile, 'utf8');
  expect((await call('mmap_batch', { page: 'architecture', operations: [{ op: 'update', data: { title: 'Must rollback' } }, { op: 'remove', data: { nodes: ['unknown'] } }] })).isError).toBe(true);
  expect(readFileSync(pageFile, 'utf8')).toBe(before);
});

it('reads bounded neighborhoods with exact missing-root errors', async () => {
  await data('mmap_declare', design);
  expect((await read({ resource: 'neighborhood', id: 'api', direction: 'dependencies' })).items.map((n: any) => n.id)).toEqual(['store', 'api']);
  expect((await call('mmap_read', { resource: 'neighborhood', page: 'architecture', id: 'missing' })).isError).toBe(true);
});

it('checks only referenced files and reports affected consumers without changing verification status', async () => {
  writeFileSync(join(dir, 'store.ts'), 'original');
  const sha256 = createHash('sha256').update('original').digest('hex');
  await data('mmap_declare', design);
  await data('mmap_update', { page: 'architecture', updates: [{ id: 'store', sources: [{ path: 'store.ts', sha256 }] }] });
  expect((await read({ resource: 'changes', id: 'store' })).items[0].state).toBe('unchanged');
  writeFileSync(join(dir, 'store.ts'), 'edited');
  expect((await read({ resource: 'changes', id: 'store' })).items[0]).toMatchObject({ state: 'changed', affectedConsumers: ['api'] });
  expect((await read({ resource: 'nodes', id: 'store' })).items[0].status).toBe('done');
  expect(JSON.parse(readFileSync(join(dir, '.mellos/pages/architecture.json'), 'utf8')).version).toBe(2);
  expect((await call('mmap_update', { page: 'architecture', updates: [{ id: 'store', sources: [{ path: '../outside' }] }] })).isError).toBe(true);
});

it('deletes default and named pages with revision and inbound-reference checks', async () => {
  await data('mmap_declare', design);
  const created = await data('mmap_declare', { title: 'Default' });
  await data('mmap_remove', { deletePage: true, expectedRevision: created.revision });
  expect(existsSync(file)).toBe(false);
  await data('mmap_declare', { page: 'child', title: 'Child' });
  await data('mmap_update', { page: 'architecture', updates: [{ id: 'api', submap: 'child' }] });
  expect((await call('mmap_remove', { page: 'child', deletePage: true })).structuredContent).toMatchObject({ error: { code: 'REFERENCED' } });
  const deleted = await data('mmap_remove', { page: 'child', deletePage: true, references: 'keep' });
  expect(deleted.references).toEqual([{ page: 'architecture', node: 'api' }]);
  expect(existsSync(join(dir, '.mellos/pages/child.json'))).toBe(false);
});

it('holds a cooperative lock, refuses another owner and releases after an exception', () => {
  expect(() => withStoreLock(file, () => withStoreLock(file, () => 1))).toThrow('Another writer');
  expect(existsSync(join(dir, '.mellos/.write-lock'))).toBe(true);
  expect(withStoreLock(file, () => 2)).toBe(2);
});

it('finds the nearest project without crossing nested repositories or worktree roots', () => {
  mkdirSync(join(dir, '.git')); mkdirSync(join(dir, 'src/deep'), { recursive: true });
  expect(resolveProjectDirectory(join(dir, 'src/deep'))).toBe(dir);
  writeFileSync(join(dir, 'src/.git'), 'gitdir: elsewhere');
  expect(resolveProjectDirectory(join(dir, 'src/deep'))).toBe(join(dir, 'src'));
});

it('does not adopt a global store across a home or temporary-directory boundary', () => {
  mkdirSync(join(dir, '.mellos/pages'), { recursive: true });
  mkdirSync(join(dir, 'new-project/src'), { recursive: true });
  const start = join(dir, 'new-project/src');
  expect(resolveProjectDirectory(start, [dir])).toBe(start);
  expect(resolveProjectDirectory(dir, [dir])).toBe(dir);
});
