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

describe('revising a live map over the wire', () => {
  const GHOST = {
    layers: [
      { id: 'base', name: 'Base', rank: 0 },
      { id: 'top', name: 'Top', rank: 10 },
    ],
    lanes: [{ id: 'l', label: 'Lane' }],
    groups: [{ id: 'g', label: 'Group', layer: 'base' }],
    nodes: [
      { id: 'core', label: 'Core', layer: 'base' },
      { id: 'shell', label: 'Shell', layer: 'top' },
    ],
  };
  const onDisk = (): { title?: string; layers: Array<{ id: string; name: string }>; nodes: Array<Record<string, string>> } =>
    JSON.parse(readFileSync(stateFile, 'utf8'));

  it('moves a node to another band and persists it', async () => {
    await callText('mmap_declare', GHOST);
    const moved = await callText('mmap_update', { updates: [{ id: 'core', layer: 'top' }] });
    expect(moved.isError).toBe(false);
    expect(onDisk().nodes.find((n) => n['id'] === 'core')?.['layer']).toBe('top');
  });

  it('renames a band, a group and a lane in one call', async () => {
    await callText('mmap_declare', GHOST);
    const renamed = await callText('mmap_update', {
      layers: [{ id: 'base', name: '原语层', rank: 1 }],
      groups: [{ id: 'g', label: '新子系统' }],
      lanes: [{ id: 'l', label: '新泳道' }],
    });
    expect(renamed.isError).toBe(false);
    const view = await callText('mmap_view', {});
    expect(view.text).toContain('原语层');
    expect(onDisk().layers.find((l) => l.id === 'base')).toMatchObject({ name: '原语层', rank: 1 });
  });

  it('clears evidence and the title with null, leaving absent keys behind', async () => {
    await callText('mmap_declare', { ...GHOST, title: '演示' });
    await callText('mmap_update', { updates: [{ id: 'core', status: 'done', evidence: 'spec green' }] });
    expect(onDisk().nodes.find((n) => n['id'] === 'core')?.['evidence']).toBe('spec green');

    const cleared = await callText('mmap_update', { updates: [{ id: 'core', evidence: null }] });
    expect(cleared.isError).toBe(false);
    expect(onDisk().nodes.find((n) => n['id'] === 'core')).not.toHaveProperty('evidence');

    expect((await callText('mmap_declare', { title: null })).isError).toBe(false);
    expect(onDisk()).not.toHaveProperty('title');
  });

  it('refuses a node that dives into the page the call targets', async () => {
    const refused = await callText('mmap_declare', {
      page: 'alpha',
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base', submap: 'alpha' }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('own page');
  });

  it('refuses a revision that revises nothing', async () => {
    await callText('mmap_declare', GHOST);
    const empty = await callText('mmap_update', {});
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain('nothing to revise');
  });
});

describe('mmap_view answers "which pages does this project have?"', () => {
  it('names the default page as present or absent, plus every named page and the one shown', async () => {
    const emptyProject = await callText('mmap_view', {});
    expect(emptyProject.text).toContain('pages: (default: absent) — this view: (default)');

    await callText('mmap_declare', {
      page: 'alpha',
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
    });
    // a project whose work lives on named pages: discoverable without the default file
    const stillNoDefault = await callText('mmap_view', {});
    expect(stillNoDefault.text).toContain('pages: (default: absent), alpha — this view: (default)');

    await callText('mmap_declare', { layers: [{ id: 'base', name: 'Base', rank: 0 }] });
    const viewingAlpha = await callText('mmap_view', { page: 'alpha' });
    expect(viewingAlpha.text).toContain('pages: (default), alpha — this view: alpha');
  });
});

/**
 * The advertised schema is the only documentation a model reads before it
 * calls, so it is specified as strictly as the behavior behind it.
 */
interface JsonSchemaNode {
  readonly description?: string;
  readonly properties?: Record<string, JsonSchemaNode>;
  readonly items?: JsonSchemaNode;
}

describe('the advertised tool schemas', () => {
  const schemaOf = async (tool: string): Promise<JsonSchemaNode> => {
    const found = (await client.listTools()).tools.find((t) => t.name === tool);
    if (found === undefined) throw new Error(`no such tool: ${tool}`);
    return found.inputSchema as unknown as JsonSchemaNode;
  };

  it('gives every field its own schema — no field is advertised as a $ref to another', async () => {
    for (const tool of (await client.listTools()).tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('$ref');
    }
  });

  it('describes a node id as a node id, and the page as the page', async () => {
    const declare = await schemaOf('mmap_declare');
    // The regression this pins: one shared id instance made zod-to-json-schema
    // emit every later id as a pointer to `page`, so the model read "node id =
    // the page this call targets".
    expect(declare.properties?.['nodes']?.items?.properties?.['id']?.description).toContain('node');
    expect(declare.properties?.['nodes']?.items?.properties?.['id']?.description).not.toContain('page');
    expect(declare.properties?.['page']?.description).toContain('page');
    expect(declare.properties?.['nodes']?.items?.properties?.['layer']?.description).toContain('band');
  });

  it('states the domain rules the map really enforces', async () => {
    const declare = await schemaOf('mmap_declare');
    const rank = declare.properties?.['layers']?.items?.properties?.['rank'];
    expect(rank?.description).toContain('0 = bottom');
    expect(declare.properties?.['nodes']?.items?.properties?.['status']?.description).toContain('regressed');
  });

  it('refuses an unknown key instead of dropping it, and names the key', async () => {
    const misspelled = await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodez: [{ id: 'core', label: 'Core', layer: 'base' }],
    });
    expect(misspelled.isError).toBe(true);
    expect(misspelled.text).toContain('nodez');

    // ...at every depth: a misspelled field inside an item is the dangerous
    // one, because the item itself still applies
    const inner = await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base', evidance: 'typo' }],
    });
    expect(inner.isError).toBe(true);
    expect(inner.text).toContain('evidance');
  });

  it('accepts evidence on declare, so finished work can be mapped with its proof', async () => {
    const declared = await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base', status: 'done', evidence: 'vitest: 225 passed' }],
    });
    expect(declared.isError).toBe(false);
    const onDisk = JSON.parse(readFileSync(stateFile, 'utf8')) as { nodes: Array<{ evidence?: string }> };
    expect(onDisk.nodes[0]?.evidence).toBe('vitest: 225 passed');
  });

  it('refuses an empty title — a blank is not how a field is cleared', async () => {
    const blank = await callText('mmap_declare', { title: '' });
    expect(blank.isError).toBe(true);
  });
});

/**
 * Everything the tools accept is eventually drawn into a terminal, so the
 * boundary keeps escape sequences out of the store rather than trusting each
 * renderer to defuse them later.
 */
describe('control characters at the tool boundary', () => {
  // Built from code points rather than written as escapes, so that reading
  // this file (or grepping it) shows exactly which character is under test.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const NEWLINE = String.fromCharCode(0x0a);
  const BASE = { layers: [{ id: 'base', name: 'Base', rank: 0 }] };

  it('refuses an ESC sequence in a label — a map may not repaint the terminal', async () => {
    const attack = await callText('mmap_declare', {
      ...BASE,
      nodes: [{ id: 'core', label: `${ESC}[2JCore`, layer: 'base' }],
    });
    expect(attack.isError).toBe(true);
    expect(attack.text).toContain('control characters');
  });

  it('refuses a newline in a label — it would break the box the label sits in', async () => {
    const broken = await callText('mmap_declare', {
      ...BASE,
      nodes: [{ id: 'core', label: `Core${NEWLINE}and more`, layer: 'base' }],
    });
    expect(broken.isError).toBe(true);
  });

  it('refuses control characters in a title and in evidence too', async () => {
    expect((await callText('mmap_declare', { title: `${ESC}]0;pwned` })).isError).toBe(true);
    await callText('mmap_declare', { ...BASE, nodes: [{ id: 'core', label: 'Core', layer: 'base' }] });
    const evidence = await callText('mmap_update', {
      updates: [{ id: 'core', status: 'done', evidence: `passed${BEL}` }],
    });
    expect(evidence.isError).toBe(true);
  });

  it('accepts newlines in detail — a design note is written in paragraphs', async () => {
    const declared = await callText('mmap_declare', {
      ...BASE,
      nodes: [{ id: 'core', label: 'Core', layer: 'base', detail: `Responsibility.${NEWLINE}Contract.` }],
    });
    expect(declared.isError).toBe(false);
    const onDisk = JSON.parse(readFileSync(stateFile, 'utf8')) as { nodes: Array<{ detail?: string }> };
    expect(onDisk.nodes[0]?.detail).toBe(`Responsibility.${NEWLINE}Contract.`);
  });

  it('refuses a BEL in detail — newline and tab are the only controls a note may carry', async () => {
    const noisy = await callText('mmap_declare', {
      ...BASE,
      nodes: [{ id: 'core', label: 'Core', layer: 'base', detail: `Ready${BEL}` }],
    });
    expect(noisy.isError).toBe(true);
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
