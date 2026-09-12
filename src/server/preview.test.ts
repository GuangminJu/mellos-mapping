import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PageId } from '../store/store.js';
import { previewFile } from '../preview/publisher.js';
import { buildServer } from './server.js';

let directory: string;
let stateFile: string;
let client: Client;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'mellos-preview-mcp-'));
  stateFile = join(directory, '.mellos', 'map.json');
  const server = buildServer(stateFile, join(directory, 'user-config.json'));
  const [a,b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'preview-test', version: '1' });
  await Promise.all([server.connect(b), client.connect(a)]);
});
afterEach(async () => { await client.close(); rmSync(directory, { recursive: true, force: true }); });
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { error: result.isError === true, text: (result.content as {text: string}[])[0]!.text };
}
const ghost = { page: 'desktop', layers: [{ id: 'base', name: '基础', rank: 0 }], nodes: [{ id: 'core', label: '核心', layer: 'base' }] };

describe('Markdown surface over the real MCP protocol', () => {
  it('prepares the desktop terminal without launching an external pane or exporting files', async () => {
    await call('mmap_declare', ghost);
    const opened = await call('mmap_open', { surface: 'codex-terminal', page: 'desktop' });
    expect(opened.error, opened.text).toBe(false);
    expect(opened.text).toContain('terminal: ready-to-start');
    const result = JSON.parse(opened.text.slice(opened.text.indexOf('{'), opened.text.lastIndexOf('}') + 1));
    expect(result.args).toEqual([expect.stringContaining('watch.mjs'), '--file', stateFile, '--page', 'desktop']);
    expect(result.hostOpen).toEqual({ placement: 'right', target: { type: 'terminal' } });
    expect((await call('mmap_open', { surface: 'codex-terminal', page: 'typo' })).error).toBe(true);
    expect((await call('mmap_open', { surface: 'codex-terminal', window: true })).error).toBe(true);
  });
  it('activates without a terminal, refreshes after writes, and cleans up deleted views', async () => {
    expect((await call('mmap_declare', ghost)).error).toBe(false);
    const opened = await call('mmap_open', { surface: 'markdown', page: 'desktop' });
    expect(opened.error).toBe(false);
    expect(opened.text).toContain('preview: ready');
    expect(opened.text).toContain('Visibility and automatic file-viewer refresh are not confirmed');
    const path = previewFile(stateFile, 'desktop' as PageId);
    const before = readFileSync(path, 'utf8');
    expect(before).toContain('待开发');
    const updated = await call('mmap_update', { page: 'desktop', updates: [{ id: 'core', status: 'done', evidence: '测试通过' }] });
    expect(updated.error).toBe(false);
    expect(updated.text).toContain('preview: updated');
    expect(updated.text).not.toContain('pane: CLOSED');
    const current = readFileSync(path, 'utf8');
    expect(current).toContain('已验证 **1 / 1**');
    expect(current).toContain('测试通过');
    expect(current.match(/images\/\w+\.svg/)?.[0]).not.toBe(before.match(/images\/\w+\.svg/)?.[0]);
    expect((await call('mmap_update', { page: 'desktop', updates: [{ id: 'absent', status: 'done' }] })).error).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(current);
    expect((await call('mmap_remove', { pages: ['desktop'] })).error).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain('地图已删除');
  });

  it('does not misreport a saved map as failed when only preview output fails', async () => {
    await call('mmap_declare', ghost);
    await call('mmap_open', { surface: 'markdown', page: 'desktop' });
    const path = previewFile(stateFile, 'desktop' as PageId);
    rmSync(path);
    mkdirSync(path); // reproducible filesystem failure at the document commit
    const result = await call('mmap_update', { page: 'desktop', updates: [{ id: 'core', status: 'done', evidence: '已验证' }] });
    expect(result.error).toBe(false);
    expect(result.text).toContain('preview: STALE');
    expect(result.text).toContain('do not repeat the map mutation');
    expect(JSON.parse(readFileSync(join(directory, '.mellos', 'pages', 'desktop.json'), 'utf8')).nodes[0].status).toBe('done');
  });

  it('rejects conflicting surface options and does not enable misspelled pages', async () => {
    expect((await call('mmap_open', { surface: 'markdown', window: true })).error).toBe(true);
    expect((await call('mmap_open', { surface: 'web', window: true })).error).toBe(true);
    expect((await call('mmap_open', { surface: 'web', page: 'typo' })).error).toBe(true);
    expect((await call('mmap_open', { surface: 'markdown', page: 'typo' })).error).toBe(true);
  });
});
