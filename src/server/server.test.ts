/**
 * Integration spec for Layer 3 — a real MCP client talking to the server over
 * an in-memory transport, with a real state file on disk. Pins the wire-level
 * contract: tool names, schema acceptance, error surfacing, and that the
 * watcher-visible file actually changes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { type PageId, VIEWER_STALE_MS, publishViewer, viewerFilePath } from '../store/store.js';

import {
  buildServer,
  launcherArgs,
  launcherPath,
  launchedAsEntry,
  openOutcome,
  projectDirOf,
  resolveStateFile,
} from './server.js';

let dir: string;
let client: Client;
let stateFile: string;
/**
 * The USER-scope configuration, inside the temp tree. Every server this spec
 * builds is handed one: a spec must never be able to read, let alone write,
 * the developer's real configuration.
 */
let userConfigFile: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-mapping-server-'));
  stateFile = join(dir, '.mellos', 'map.json');
  userConfigFile = join(dir, 'home', '.mellos', 'config.json');
  const server = buildServer(stateFile, userConfigFile);
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
  it('exposes exactly the six mmap tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['mmap_declare', 'mmap_open', 'mmap_remove', 'mmap_setup', 'mmap_update', 'mmap_view']);
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
    expect(removed.text).toContain('map now: 2 layer(s), 1 node(s) [1 planned], 0 edge(s)');
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

/**
 * Deleting a page is the one mmap_remove that leaves the map layer entirely:
 * a whole file goes, and no map value can express that. So the spec pins the
 * file system, the refusals, and what the reply promises about them.
 */
describe('mmap_remove deletes whole pages', () => {
  const PAGE = { layers: [{ id: 'base', name: 'Base', rank: 0 }], nodes: [{ id: 'core', label: 'Core', layer: 'base' }] };
  const pageFile = (slug: string): string => join(dir, '.mellos', 'pages', `${slug}.json`);

  it('deletes a named page file, and the pages line stops naming it', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    await callText('mmap_declare', { ...PAGE, page: 'beta' });
    expect((await callText('mmap_view', {})).text).toContain('pages: (default: absent), alpha, beta');

    const removed = await callText('mmap_remove', { pages: ['alpha'] });
    expect(removed.isError).toBe(false);
    expect(removed.text).toContain('deleted page(s): alpha');
    expect(existsSync(pageFile('alpha'))).toBe(false);
    expect(existsSync(pageFile('beta'))).toBe(true);

    // the pages line reads the store, so it tells the truth by itself
    expect((await callText('mmap_view', {})).text).toContain('pages: (default: absent), beta');
  });

  it('deletes a batch, and a bare deletion creates no default page file', async () => {
    for (const slug of ['alpha', 'beta', 'gamma']) await callText('mmap_declare', { ...PAGE, page: slug });
    const removed = await callText('mmap_remove', { pages: ['alpha', 'gamma'] });
    expect(removed.isError).toBe(false);
    expect(removed.text).toContain('deleted page(s): alpha, gamma');
    expect(readdirSync(join(dir, '.mellos', 'pages'))).toEqual(['beta.json']);
    // a call that only deletes pages must touch no map — least of all create one
    expect(existsSync(stateFile)).toBe(false);
  });

  it('refuses to delete the page the same call targets, and deletes nothing', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    const refused = await callText('mmap_remove', { page: 'alpha', nodes: ['core'], pages: ['alpha'] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('the page this call targets');
    expect(existsSync(pageFile('alpha'))).toBe(true);
    // and the map edit it carried did not land either
    expect((await callText('mmap_view', { page: 'alpha' })).text).toContain('Core');
  });

  it('refuses an unknown slug as the typo it probably is, naming the real pages', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    const refused = await callText('mmap_remove', { pages: ['aplha'] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('no page named "aplha"');
    expect(refused.text).toContain('alpha');
    expect(existsSync(pageFile('alpha'))).toBe(true);

    // one bad slug refuses the whole batch: validation runs before any delete
    const batch = await callText('mmap_remove', { pages: ['alpha', 'ghost'] });
    expect(batch.isError).toBe(true);
    expect(existsSync(pageFile('alpha'))).toBe(true);
  });

  it('applies the call\'s map edits first, then deletes the other page', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    await callText('mmap_declare', { ...PAGE, page: 'beta' });
    const both = await callText('mmap_remove', { page: 'alpha', nodes: ['core'], pages: ['beta'] });
    expect(both.isError).toBe(false);
    expect(both.text).toContain('map now: 1 layer(s), 0 node(s)');
    expect(both.text).toContain('deleted page(s): beta');
    expect(existsSync(pageFile('beta'))).toBe(false);
  });

  it('a refused map edit deletes nothing — the edits go first for exactly that', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    await callText('mmap_declare', { ...PAGE, page: 'beta' });
    const refused = await callText('mmap_remove', { page: 'alpha', layers: ['base'], pages: ['beta'] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('still holds node "core"');
    expect(existsSync(pageFile('beta'))).toBe(true);
  });

  it('names the page a deletion failed on, and says the rest is really gone', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'alpha' });
    await callText('mmap_declare', { ...PAGE, page: 'beta' });
    // a DIRECTORY where beta's file was: rm refuses it, alpha is already gone
    rmSync(pageFile('beta'));
    mkdirSync(join(pageFile('beta'), 'wedged'), { recursive: true });

    const partial = await callText('mmap_remove', { pages: ['alpha', 'beta'] });
    expect(partial.isError).toBe(true);
    expect(partial.text).toContain('deleted page(s): alpha');
    expect(partial.text).toContain('could NOT delete: beta');
    expect(partial.text).toContain('gone for good');
    expect(existsSync(pageFile('alpha'))).toBe(false);
  });

  it('leaves a submap reference to the deleted page standing — it never promised existence', async () => {
    await callText('mmap_declare', { ...PAGE, page: 'child' });
    await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base', submap: 'child' }],
    });
    expect((await callText('mmap_remove', { pages: ['child'] })).isError).toBe(false);
    const onDisk = JSON.parse(readFileSync(stateFile, 'utf8')) as { nodes: Array<{ submap?: string }> };
    expect(onDisk.nodes[0]?.submap).toBe('child'); // a dangling dive, and legal
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

  it('refuses an id that is not a slug, wherever an id appears', async () => {
    const BASE = { layers: [{ id: 'base', name: 'Base', rank: 0 }] };
    // The grammar is one rule for every id in the system, so one bad shape is
    // enough per position: an upper-case letter, a space, a leading dash, a
    // blank, and a name longer than the 64-character budget.
    for (const bad of ['Core', 'core node', '-core', '', 'c'.repeat(65)]) {
      const node = await callText('mmap_declare', { ...BASE, nodes: [{ id: bad, label: 'Core', layer: 'base' }] });
      expect(node.isError, `node id "${bad}" was accepted`).toBe(true);
    }
    const layer = await callText('mmap_declare', { layers: [{ id: 'Base', name: 'Base', rank: 0 }] });
    expect(layer.isError).toBe(true);
    const group = await callText('mmap_declare', { ...BASE, groups: [{ id: 'A B', label: 'G', layer: 'base' }] });
    expect(group.isError).toBe(true);
  });

  it('refuses a page slug that is not a slug — before it can name a file', async () => {
    for (const bad of ['../escape', 'Alpha', 'a/b', '']) {
      const paged = await callText('mmap_view', { page: bad });
      expect(paged.isError, `page "${bad}" was accepted`).toBe(true);
    }
    // and nothing was created outside the store's own shape
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a rank outside the band range', async () => {
    for (const rank of [-1, 100, 1.5]) {
      const bad = await callText('mmap_declare', { layers: [{ id: 'base', name: 'Base', rank }] });
      expect(bad.isError, `rank ${rank} was accepted`).toBe(true);
    }
  });

  it('refuses a label longer than the budget every surface shares', async () => {
    const BASE = { layers: [{ id: 'base', name: 'Base', rank: 0 }] };
    const sixty = 'x'.repeat(60);
    const fits = await callText('mmap_declare', { ...BASE, nodes: [{ id: 'core', label: sixty, layer: 'base' }] });
    expect(fits.isError).toBe(false);
    const over = await callText('mmap_declare', { nodes: [{ id: 'more', label: `${sixty}x`, layer: 'base' }] });
    expect(over.isError).toBe(true);
  });

  it('refuses a zoom off the ladder, at both ends', async () => {
    for (const zoom of [-5, 3]) {
      const bad = await callText('mmap_view', { zoom });
      expect(bad.isError, `zoom ${zoom} was accepted`).toBe(true);
    }
  });

  it('refuses an empty updates array — a batch that revises nothing is a mistake', async () => {
    await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
    });
    const before = readFileSync(stateFile, 'utf8');
    for (const args of [{ updates: [] }, { layers: [] }, { groups: [] }, { lanes: [] }]) {
      const empty = await callText('mmap_update', args);
      expect(empty.isError, `${JSON.stringify(args)} was accepted`).toBe(true);
    }
    expect(readFileSync(stateFile, 'utf8')).toBe(before);
  });
});

/**
 * The wire contract when the store is already damaged: every tool answers
 * with the fault named, and NOTHING is written — a map file nobody could
 * parse must not be replaced by whatever the caller happened to send.
 */
describe('a corrupted state file', () => {
  const BROKEN = '{"version":1,"layers":[},';

  it('refuses every mutation and leaves the file byte-for-byte intact', async () => {
    mkdirSync(join(dir, '.mellos'), { recursive: true });
    writeFileSync(stateFile, BROKEN, 'utf8');

    const calls: Array<[string, Record<string, unknown>]> = [
      ['mmap_declare', { nodes: [{ id: 'core', label: 'Core', layer: 'base' }] }],
      ['mmap_update', { updates: [{ id: 'core', status: 'done', evidence: 'spec green' }] }],
      ['mmap_remove', { nodes: ['core'] }],
    ];
    for (const [tool, args] of calls) {
      const answer = await callText(tool, args);
      expect(answer.isError, `${tool} did not report the damaged file`).toBe(true);
      expect(answer.text).toContain('not valid JSON');
      expect(answer.text).toContain(stateFile);
      expect(readFileSync(stateFile, 'utf8'), `${tool} rewrote the damaged file`).toBe(BROKEN);
    }

    // reading is refused the same way, and still says which file
    const view = await callText('mmap_view', {});
    expect(view.isError).toBe(true);
    expect(view.text).toContain('not valid JSON');

    // a page BESIDE the damaged default page is unaffected: pages isolate
    const paged = await callText('mmap_declare', {
      page: 'alpha',
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
    });
    expect(paged.isError).toBe(false);
    expect(readFileSync(stateFile, 'utf8')).toBe(BROKEN);
  });

  it('refuses a file whose shape the parser will not coerce, naming the key', async () => {
    mkdirSync(join(dir, '.mellos'), { recursive: true });
    // The shape mistake leniency would turn into data loss: read as "no
    // nodes", the next save would write that erasure over the file.
    writeFileSync(stateFile, '{"version":1,"layers":[],"nodes":{},"edges":[]}', 'utf8');
    const declared = await callText('mmap_declare', { layers: [{ id: 'base', name: 'Base', rank: 0 }] });
    expect(declared.isError).toBe(true);
    expect(declared.text).toContain('"nodes"');
  });
});

describe('refusals that protect the structure, over the wire', () => {
  const TWO_BANDS = {
    layers: [
      { id: 'base', name: 'Base', rank: 0 },
      { id: 'top', name: 'Top', rank: 1 },
    ],
    nodes: [
      { id: 'core', label: 'Core', layer: 'base' },
      { id: 'shell', label: 'Shell', layer: 'top' },
    ],
    edges: [{ from: 'shell', to: 'core' }],
  };

  it('refuses to remove a band that still holds a node, and says what holds it', async () => {
    await callText('mmap_declare', TWO_BANDS);
    const before = readFileSync(stateFile, 'utf8');
    const refused = await callText('mmap_remove', { layers: ['base'] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('still holds node "core"');
    expect(readFileSync(stateFile, 'utf8')).toBe(before);

    // emptied first, the same removal lands
    expect((await callText('mmap_remove', { nodes: ['core', 'shell'] })).isError).toBe(false);
    expect((await callText('mmap_remove', { layers: ['base'] })).isError).toBe(false);
  });

  it('refuses to remove a band that still holds a group', async () => {
    await callText('mmap_declare', {
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      groups: [{ id: 'g', label: 'Group', layer: 'base' }],
    });
    const refused = await callText('mmap_remove', { layers: ['base'] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('still holds group "g"');
  });

  it('refuses a move that would leave an edge pointing sideways or up (I4)', async () => {
    await callText('mmap_declare', TWO_BANDS);
    const before = readFileSync(stateFile, 'utf8');

    // shell uses core; moving shell down onto core's band makes the edge
    // same-band, which is the same fault as pointing upward
    const sideways = await callText('mmap_update', { updates: [{ id: 'shell', layer: 'base' }] });
    expect(sideways.isError).toBe(true);
    expect(sideways.text).toContain('not strictly downward');
    expect(readFileSync(stateFile, 'utf8')).toBe(before);

    // and the other direction: moving the used node above its user
    const upward = await callText('mmap_update', { updates: [{ id: 'core', layer: 'top' }] });
    expect(upward.isError).toBe(true);
    expect(upward.text).toContain('not strictly downward');
    expect(readFileSync(stateFile, 'utf8')).toBe(before);
  });
});

describe('mmap_view along the zoom ladder', () => {
  const MAP = {
    title: 'Ladder',
    layers: [
      { id: 'base', name: 'Base', rank: 0 },
      { id: 'top', name: 'Top', rank: 1 },
    ],
    groups: [{ id: 'foundation', label: 'Foundation', layer: 'base' }],
    nodes: [
      { id: 'core', label: 'Core', layer: 'base', group: 'foundation', status: 'done', evidence: 'spec: 12 passed' },
      { id: 'edge-case', label: 'Edge Case', layer: 'base', group: 'foundation' },
      { id: 'shell', label: 'Shell', layer: 'top', detail: 'Outer boundary.' },
    ],
    edges: [{ from: 'shell', to: 'core' }],
  };

  it('renders every rung, and each one shows what that rung promises', async () => {
    await callText('mmap_declare', MAP);

    // -4: the far view AGGREGATES into groups, so the group's name is what
    // survives and a member's is not.
    const overview = await callText('mmap_view', { zoom: -4 });
    expect(overview.isError).toBe(false);
    expect(overview.text).toContain('Foundation');

    // 1 and 2 unfold the box contents; +2 is the reading card, so a note that
    // fits at +1 must still be there at +2.
    for (const zoom of [1, 2]) {
      const detail = await callText('mmap_view', { zoom });
      expect(detail.isError, `zoom ${zoom} failed`).toBe(false);
      expect(detail.text, `zoom ${zoom} dropped the evidence`).toContain('spec: 12 passed');
      expect(detail.text, `zoom ${zoom} dropped the design note`).toContain('Outer boundary.');
    }

    // the standard rung shows neither — that is what unfolding means
    const standard = await callText('mmap_view', { zoom: 0 });
    expect(standard.text).not.toContain('spec: 12 passed');

    // every rung carries the page-set line
    for (const zoom of [-4, -3, -2, -1, 0, 1, 2]) {
      const view = await callText('mmap_view', { zoom });
      expect(view.text, `zoom ${zoom} lost the pages line`).toContain('pages: (default) — this view: (default)');
    }
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

describe('mapping policy setup — chosen once, per user, over the wire', () => {
  const DECLARE = {
    layers: [{ id: 'base', name: 'Base', rank: 0 }],
    nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
  };
  const projectConfigFile = (): string => join(dir, '.mellos', 'config.json');
  const readConfig = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

  it('saves to the USER scope by default — the question is asked once ever, not once per project', async () => {
    const set = await callText('mmap_setup', { policy: 'complex' });
    expect(set.isError).toBe(false);
    expect(set.text).toContain('(user scope)');
    expect(set.text).toContain('EVERY project');
    expect(set.text).toContain('scope: "project"'); // and how to override it here
    expect(readConfig(userConfigFile)).toEqual({ version: 1, policy: 'complex' });
    expect(existsSync(projectConfigFile())).toBe(false); // the project was not touched
  });

  it('saves to the PROJECT scope only when asked to', async () => {
    const set = await callText('mmap_setup', { policy: 'always', scope: 'project' });
    expect(set.text).toContain('(project scope)');
    expect(set.text).toContain('THIS project only');
    expect(readConfig(projectConfigFile())).toEqual({ version: 1, policy: 'always' });
    expect(existsSync(userConfigFile)).toBe(false);
  });

  it('reads both scopes and names which one governs', async () => {
    const unset = await callText('mmap_setup', {});
    expect(unset.isError).toBe(false);
    expect(unset.text).toContain('user: not set; project: not set');
    expect(unset.text).toContain('Ask the user');

    await callText('mmap_setup', { policy: 'always' });
    expect((await callText('mmap_setup', {})).text).toBe(
      'mapping policy — user: always; project: not set. In effect: always (user scope) — ' +
        'map every structured task — workflows, designs, architecture, technical dependencies',
    );

    await callText('mmap_setup', { policy: 'on-request', scope: 'project' });
    const both = await callText('mmap_setup', {});
    expect(both.text).toContain('user: always; project: on-request');
    expect(both.text).toContain('In effect: on-request (project scope)');
  });

  it('the nudge fires while NEITHER scope has a policy, and never again after the user chose', async () => {
    const first = await callText('mmap_declare', DECLARE);
    expect(first.isError).toBe(false);
    expect(first.text).toContain('no mapping policy has been chosen yet');
    for (const option of ['always', 'complex', 'on-request']) expect(first.text).toContain(option);
    expect(first.text).toContain('asked once ever');

    await callText('mmap_setup', { policy: 'complex' }); // user scope, this project untouched
    const second = await callText('mmap_declare', { nodes: [{ id: 'more', label: 'More', layer: 'base' }] });
    expect(second.isError).toBe(false);
    expect(second.text).not.toContain('note:');
  });

  it('a PROJECT policy alone also silences the nudge', async () => {
    await callText('mmap_setup', { policy: 'complex', scope: 'project' });
    const declared = await callText('mmap_declare', DECLARE);
    expect(declared.text).not.toContain('note:');
  });

  it('rejects a policy, or a scope, outside the enum at the schema boundary', async () => {
    expect((await callText('mmap_setup', { policy: 'sometimes' })).isError).toBe(true);
    expect((await callText('mmap_setup', { policy: 'always', scope: 'machine' })).isError).toBe(true);
  });

  it('a broken config file is surfaced on declare and on read, never treated as unset', async () => {
    await callText('mmap_declare', DECLARE); // creates .mellos/
    writeFileSync(projectConfigFile(), 'not json');

    const read = await callText('mmap_setup', {});
    expect(read.isError).toBe(true);
    expect(read.text).toContain('not valid JSON');

    const declared = await callText('mmap_declare', { nodes: [{ id: 'more', label: 'More', layer: 'base' }] });
    expect(declared.isError).toBe(false); // the ledger still works —
    expect(declared.text).toContain('note:'); // — but the breakage is named
    expect(declared.text).toContain('not valid JSON');
  });
});

describe('the pane line — whether anybody is SEEING what the call did', () => {
  /** Publish a report exactly as a running pane would. */
  const paneShowing = (pid: number, page: string | undefined, follow = true): void => {
    const published = publishViewer(stateFile, pid, { page: page as PageId | undefined, follow });
    if (!published.ok) throw new Error('the spec could not publish a viewer report');
  };

  const declareSomething = (page?: string) =>
    callText('mmap_declare', {
      ...(page === undefined ? {} : { page }),
      layers: [{ id: 'base', name: 'Base', rank: 0 }],
      nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
    });

  it('with no pane running, a write says so and names the way to fix it', async () => {
    const declared = await declareSomething('effort');
    expect(declared.isError).toBe(false);
    expect(declared.text).toContain('pane: CLOSED');
    expect(declared.text).toContain('mmap_open');
    expect(declared.text).toContain('"effort"');
  });

  it('a pane on the same page reports that the user is seeing it', async () => {
    paneShowing(4242, 'effort');
    const declared = await declareSomething('effort');
    expect(declared.text).toContain('pane: open on this page');
  });

  it('a pane elsewhere with auto-follow on is on its way here', async () => {
    paneShowing(4242, 'other', true);
    const declared = await declareSomething('effort');
    expect(declared.text).toContain('auto-follow on');
    expect(declared.text).toContain('other');
  });

  it('a pane the user pinned elsewhere means the change is NOT on their screen', async () => {
    paneShowing(4242, 'other', false);
    const declared = await declareSomething('effort');
    expect(declared.text).toContain('auto-follow OFF');
    expect(declared.text).toContain('NOT on their screen');
  });

  it('the default page is named, not printed as an empty slug', async () => {
    paneShowing(4242, undefined, false);
    const declared = await declareSomething('effort');
    expect(declared.text).toContain('(default)');
  });

  it('a stale report is no pane at all', async () => {
    paneShowing(4242, 'effort');
    // age the report past the staleness window without waiting for it
    const file = viewerFilePath(stateFile, 4242);
    const old = new Date(Date.now() - VIEWER_STALE_MS - 1000);
    utimesSync(file, old, old);
    const declared = await declareSomething('effort');
    expect(declared.text).toContain('pane: CLOSED');
  });

  it('mmap_update and mmap_view carry the same line', async () => {
    await declareSomething('effort');
    paneShowing(4242, 'effort');
    const updated = await callText('mmap_update', { page: 'effort', updates: [{ id: 'core', status: 'in-progress' }] });
    expect(updated.text).toContain('pane: open on this page');
    const viewed = await callText('mmap_view', { page: 'effort' });
    expect(viewed.text).toContain('pane: open on this page');
  });

  it('a REFUSED call carries no pane line — the news is the refusal', async () => {
    const refused = await callText('mmap_update', { page: 'effort', updates: [{ id: 'nobody', status: 'done' }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain('pane:');
  });
});

describe('mmap_open — the assistant putting the map on screen', () => {
  it('the launcher is found next to the server, in scripts/', () => {
    // both shapes this module runs in sit one directory below the plugin root
    const root = resolve('/plugin');
    expect(launcherPath(pathToFileURL(join(root, 'dist', 'server.mjs')).href)).toBe(
      join(root, 'scripts', 'open-pane.mjs'),
    );
    expect(projectDirOf(join('/work', 'proj', '.mellos', 'map.json'))).toBe(join('/work', 'proj'));
  });

  it('the command line carries the project, the page and nothing it was not asked for', () => {
    expect(launcherArgs('/proj', 'effort', false)).toEqual(['/proj', '--page', 'effort']);
    expect(launcherArgs('/proj', undefined, false)).toEqual(['/proj']);
    expect(launcherArgs('/proj', 'effort', true)).toEqual(['/proj', '--page', 'effort', '--window']);
  });

  it('a launcher that failed is reported as a failure, with what it said', () => {
    const said = openOutcome({ ok: false, output: 'open-pane.mjs is Windows Terminal-only' }, [], 'effort');
    expect(said).toContain('could not open the pane');
    expect(said).toContain('Windows Terminal-only');
  });

  it('a pane that reported the requested page is the success case', () => {
    const viewers = [{ pid: 1, page: 'effort' as PageId, follow: true, ageMs: 10 }];
    expect(openOutcome({ ok: true, output: 'MMAP_PANE mode=split' }, viewers, 'effort')).toContain('open and showing');
  });

  it('a pane that came up elsewhere is not reported as showing the page', () => {
    const viewers = [{ pid: 1, page: 'other' as PageId, follow: false, ageMs: 10 }];
    const said = openOutcome({ ok: true, output: 'MMAP_PANE already-open' }, viewers, 'effort');
    expect(said).toContain('but it reports');
    expect(said).toContain('other');
  });

  // The whole point of the viewers channel: "the command exited 0" is not the
  // same claim as "the user can see the map", and only the second one matters.
  it('a launcher that succeeded with no pane reporting in says exactly that', () => {
    const said = openOutcome({ ok: true, output: 'MMAP_PANE mode=window' }, [], 'effort');
    expect(said).toContain('no pane has reported in');
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
