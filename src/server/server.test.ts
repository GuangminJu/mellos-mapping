/**
 * Integration spec for Layer 3 — a real MCP client talking to the server over
 * an in-memory transport, with a real state file on disk. Pins the wire-level
 * contract: tool names, schema acceptance, error surfacing, and that the
 * watcher-visible file actually changes.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildServer, launchedAsEntry, resolveStateFile } from './server.js';

let dir: string;
let client: Client;
let stateFile: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-mapping-server-'));
  stateFile = join(dir, '.mellos', 'map.json');
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
  it('exposes exactly the five mmap tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['mmap_declare', 'mmap_remove', 'mmap_setup', 'mmap_update', 'mmap_view']);
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
    expect(declared.text).toContain('map now: 2 layer(s), 2 node(s) [2 planned], 1 edge(s)');

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

  it('writes a paged call to its own file, isolated from the default page', async () => {
    await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
    });
    const defaultBefore = readFileSync(stateFile, 'utf8');

    const paged = await callText('mmap_declare', {
      page: 'pages-feature',
      title: '多页支持',
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'tabs', label: '标签栏', layer: 'base', status: 'in-progress' }],
    });
    expect(paged.isError).toBe(false);
    expect(paged.text).toContain('[page: pages-feature]');

    // the page landed in its own file; the default page is untouched
    const pageFile = join(dir, '.mellos', 'pages', 'pages-feature.json');
    expect((JSON.parse(readFileSync(pageFile, 'utf8')) as { title: string }).title).toBe('多页支持');
    expect(readFileSync(stateFile, 'utf8')).toBe(defaultBefore);

    // view targets pages independently
    const pagedView = await callText('mmap_view', { page: 'pages-feature' });
    expect(pagedView.text).toContain('标签栏');
    const defaultView = await callText('mmap_view', {});
    expect(defaultView.text).not.toContain('标签栏');
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

describe('mapping policy setup — the flow enforces itself over the wire', () => {
  const DECLARE = {
    layers: [{ id: 'base', name: 'Base', rank: 0 }],
    nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
  };

  it('a declare on an unconfigured project carries the setup nudge; configuring stops it', async () => {
    const first = await callText('mmap_declare', DECLARE);
    expect(first.isError).toBe(false);
    expect(first.text).toContain('mapping policy not set');
    for (const option of ['always', 'complex', 'on-request']) expect(first.text).toContain(option);
    expect(first.text).toContain('Ask the user');

    const set = await callText('mmap_setup', { policy: 'complex' });
    expect(set.isError).toBe(false);
    expect(set.text).toContain('mapping policy set: complex');
    const configFile = join(dir, '.mellos', 'config.json');
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({ version: 1, policy: 'complex' });

    const second = await callText('mmap_declare', { nodes: [{ id: 'more', label: 'More', layer: 'base' }] });
    expect(second.isError).toBe(false);
    expect(second.text).not.toContain('note:');
  });

  it('reads back: unconfigured hands the question to the user, configured reports the choice', async () => {
    const unset = await callText('mmap_setup', {});
    expect(unset.isError).toBe(false);
    expect(unset.text).toContain('mapping policy not set');
    expect(unset.text).toContain('Ask the user');

    await callText('mmap_setup', { policy: 'on-request' });
    const read = await callText('mmap_setup', {});
    expect(read.text).toBe('mapping policy: on-request — map only when the user explicitly asks');
  });

  it('rejects a policy outside the enum at the schema boundary', async () => {
    const bad = await callText('mmap_setup', { policy: 'sometimes' });
    expect(bad.isError).toBe(true);
  });

  it('a broken config file is surfaced on declare and on read, never treated as unset', async () => {
    const configFile = join(dir, '.mellos', 'config.json');
    await callText('mmap_declare', DECLARE); // creates .claude/
    writeFileSync(configFile, 'not json');

    const read = await callText('mmap_setup', {});
    expect(read.isError).toBe(true);
    expect(read.text).toContain('not valid JSON');

    const declared = await callText('mmap_declare', { nodes: [{ id: 'more', label: 'More', layer: 'base' }] });
    expect(declared.isError).toBe(false); // the ledger still works —
    expect(declared.text).toContain('note:'); // — but the breakage is named
    expect(declared.text).toContain('not valid JSON');
  });
});

describe('resolveStateFile', () => {
  it('resolves MELLOS_MAPPING_CWD, then CLAUDE_PROJECT_DIR, then the process cwd', () => {
    expect(
      resolveStateFile({ MELLOS_MAPPING_CWD: 'D:\\override', CLAUDE_PROJECT_DIR: 'D:\\proj' }, 'C:\\elsewhere'),
    ).toBe(join('D:\\override', '.mellos', 'map.json'));
    expect(resolveStateFile({ CLAUDE_PROJECT_DIR: 'D:\\proj' }, 'C:\\elsewhere')).toBe(
      join('D:\\proj', '.mellos', 'map.json'),
    );
    expect(resolveStateFile({}, 'C:\\elsewhere')).toBe(join('C:\\elsewhere', '.mellos', 'map.json'));
  });
});

describe('launchedAsEntry', () => {
  const selfUrl = import.meta.url;
  const selfPath = fileURLToPath(selfUrl);

  it('recognizes the entry even when argv[1] is an unnormalized path to the same file', () => {
    // npm bin shims and shells hand over symlinked or relative paths; the
    // guard must compare real paths, not raw strings.
    const unnormalized = join(selfPath, '..', 'server.test.ts');
    expect(launchedAsEntry(unnormalized, selfUrl)).toBe(true);
  });

  it('rejects a different file and a missing argv[1]', () => {
    expect(launchedAsEntry(selfPath.replace('server.test.ts', 'server.ts'), selfUrl)).toBe(false);
    expect(launchedAsEntry(undefined, selfUrl)).toBe(false);
  });

  it('falls back to URL equality when the path does not exist', () => {
    const ghost = join(tmpdir(), 'mellos-launched-as-entry-does-not-exist.mjs');
    expect(launchedAsEntry(ghost, selfUrl)).toBe(false);
    expect(launchedAsEntry(ghost, pathToFileURL(ghost).href)).toBe(true);
  });
});
