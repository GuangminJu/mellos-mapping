/**
 * Integration spec for Layer 3 — a real MCP client talking to the server over
 * an in-memory transport, with a real state file on disk. Pins the wire-level
 * contract: tool names, schema acceptance, error surfacing, and that the
 * watcher-visible file actually changes.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, resolveStateFile } from './server.js';

let dir: string;
let client: Client;
let stateFile: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-mapping-server-'));
  stateFile = join(dir, '.claude', 'mellos-mapping.json');
  const server = buildServer(stateFile);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function callText(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content as Array<{ type: string; text: string }>)[0];
  return { text: content?.text ?? '', isError: result.isError === true };
}

describe('mellos-mapping MCP server', () => {
  it('exposes exactly the four mmap tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['mmap_declare', 'mmap_remove', 'mmap_update', 'mmap_view']);
  });

  it('declares a ghost design and persists it to the project state file', async () => {
    const declared = await callText('mmap_declare', {
      title: '演示',
      layers: [
        { id: 'base', name: '原语层', rank: 0 },
        { id: 'top', name: '编排层', rank: 1 },
      ],
      nodes: [
        { id: 'core', label: '核心', layer: 'base' },
        { id: 'shell', label: '外壳', layer: 'top' },
      ],
      edges: [{ from: 'shell', to: 'core' }],
    });
    expect(declared.isError).toBe(false);
    expect(declared.text).toBe('map now: 2 layer(s), 2 node(s) [2 planned], 1 edge(s)');

    const onDisk = JSON.parse(readFileSync(stateFile, 'utf8')) as { title: string; nodes: unknown[] };
    expect(onDisk.title).toBe('演示');
    expect(onDisk.nodes).toHaveLength(2);
  });

  it('refuses an upward edge over the wire and leaves the file unchanged', async () => {
    await callText('mmap_declare', {
      layers: [
        { id: 'base', name: 'Base', rank: 0 },
        { id: 'top', name: 'Top', rank: 1 },
      ],
      nodes: [
        { id: 'core', label: 'Core', layer: 'base' },
        { id: 'shell', label: 'Shell', layer: 'top' },
      ],
    });
    const before = readFileSync(stateFile, 'utf8');

    const refused = await callText('mmap_declare', { edges: [{ from: 'core', to: 'shell' }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('not strictly downward');
    expect(readFileSync(stateFile, 'utf8')).toBe(before);
  });

  it('updates progress and renders the picture through mmap_view', async () => {
    await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
    });
    await callText('mmap_update', { updates: [{ id: 'core', status: 'done', evidence: 'spec passed' }] });

    const view = await callText('mmap_view', {});
    expect(view.isError).toBe(false);
    expect(view.text).toContain('■ Core');
    expect(view.text).toContain('Base');
  });

  it('renders the empty-map hint before anything is declared', async () => {
    const view = await callText('mmap_view', {});
    expect(view.isError).toBe(false);
    expect(view.text).toContain('declare layers and nodes');
  });

  it('removes a node and its edges in one revision', async () => {
    await callText('mmap_declare', {
      layers: [
        { id: 'base', name: 'Base', rank: 0 },
        { id: 'top', name: 'Top', rank: 1 },
      ],
      nodes: [
        { id: 'core', label: 'Core', layer: 'base' },
        { id: 'shell', label: 'Shell', layer: 'top' },
      ],
      edges: [{ from: 'shell', to: 'core' }],
    });
    const removed = await callText('mmap_remove', { nodes: ['shell'] });
    expect(removed.isError).toBe(false);
    expect(removed.text).toBe('map now: 2 layer(s), 1 node(s) [1 planned], 0 edge(s)');
  });
});

describe('resolveStateFile', () => {
  it('prefers MELLOS_MAPPING_CWD over the process cwd', () => {
    expect(resolveStateFile({ MELLOS_MAPPING_CWD: 'D:\\proj' }, 'C:\\elsewhere')).toBe(
      join('D:\\proj', '.claude', 'mellos-mapping.json'),
    );
    expect(resolveStateFile({}, 'C:\\elsewhere')).toBe(join('C:\\elsewhere', '.claude', 'mellos-mapping.json'));
  });
});
