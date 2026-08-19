/**
 * Spec for Layer 1 — persistence promises P1 (loaded data satisfies Layer 0
 * invariants) and P2 (writes are atomic; round-trips are lossless).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareGroup, declareLane, declareLayer, declareNode, linkNodes, setKind, setTitle, updateNode } from '../domain/ops.js';
import {
  EMPTY_MAP,
  type GroupId,
  type LaneId,
  type LayerId,
  type MellosMap,
  type NodeId,
  type NodeKind,
  type Rank,
  type Result,
  type SubmapRef,
} from '../domain/types.js';
import {
  STATE_FILE_RELATIVE_PATH,
  configFilePath,
  describeMappingPolicy,
  describeStoreError,
  focusFilePath,
  listPageFiles,
  loadMapFile,
  loadMappingPolicy,
  makeMappingPolicy,
  makePageId,
  migrateLegacyStore,
  pageFilePath,
  pageIdOfFile,
  parseMap,
  saveMapFile,
  saveMappingPolicy,
  serializeMap,
  takeFocusRequest,
} from './store.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

function mustFail<T, E>(r: Result<T, E>): E {
  if (r.ok) throw new Error('expected an error, but the operation succeeded');
  return r.error;
}

/** Ids in specs are known-good literals; brands are asserted, not re-validated. */
const lid = (raw: string): LayerId => raw as LayerId;
const nid = (raw: string): NodeId => raw as NodeId;
/** Ranks in specs are known-good literals; the brand is asserted, not re-validated. */
const rnk = (n: number): Rank => n as Rank;
const gid = (raw: string): GroupId => raw as GroupId;
const laid = (raw: string): LaneId => raw as LaneId;

/** Every .json in a page directory, or nothing when the directory is absent. */
function pageDirFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((e) => e.endsWith('.json'))
    .map((e) => join(dir, e));
}

function sampleMap(): MellosMap {
  let map = setTitle(EMPTY_MAP, '梅勒斯地图');
  map = must(declareLayer(map, { id: lid('primitives'), name: '原语层', rank: rnk(0) }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: rnk(1) }));
  map = must(declareGroup(map, { id: gid('base'), label: '地基', layer: lid('primitives') }));
  map = must(
    declareNode(map, {
      id: nid('result'),
      label: 'Result<T>',
      layer: lid('primitives'),
      status: 'done',
      detail: '期望中的失败是值，不是异常。',
      group: gid('base'),
    }),
  );
  map = must(updateNode(map, { id: nid('result'), evidence: 'vitest: 23 passed' }));
  map = must(declareNode(map, { id: nid('store'), label: 'MapStore', layer: lid('contracts'), status: 'in-progress' }));
  map = must(linkNodes(map, nid('store'), nid('result')));
  return map;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-mapping-spec-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('round-trip (P1 + P2)', () => {
  it('save then load reproduces the map exactly', () => {
    const path = join(dir, '.mellos', 'map.json');
    saveMapFile(path, sampleMap());
    expect(must(loadMapFile(path))).toEqual(sampleMap());
  });

  it('creates the parent directory and leaves no temp file behind', () => {
    const path = join(dir, '.mellos', 'map.json');
    saveMapFile(path, sampleMap());
    expect(readdirSync(join(dir, '.mellos'))).toEqual(['map.json']);
  });

  it('serializes deterministically', () => {
    expect(serializeMap(sampleMap())).toBe(serializeMap(sampleMap()));
  });
});

describe('boundary validation (P1)', () => {
  it('reports a missing file as not-found, not as an exception', () => {
    expect(mustFail(loadMapFile(join(dir, 'absent.json'))).kind).toBe('not-found');
  });

  it('reports malformed JSON', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ "version": 1, ', 'utf8');
    expect(mustFail(loadMapFile(path)).kind).toBe('malformed-json');
  });

  it('rejects an unknown version', () => {
    const e = mustFail(parseMap({ version: 99, layers: [], nodes: [], edges: [] }, 'x'));
    expect(e.kind).toBe('bad-shape');
  });

  it('rejects a hand-edited upward edge — corruption cannot enter the process', () => {
    const raw = JSON.parse(serializeMap(sampleMap())) as { edges: unknown[] };
    raw.edges = [{ from: 'result', to: 'store' }];
    const e = mustFail(parseMap(raw, 'x'));
    expect(e).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'edge-not-downward' } });
  });

  it('rejects a hand-edited cross-band group membership', () => {
    const raw = JSON.parse(serializeMap(sampleMap())) as { nodes: Array<{ group?: string }> };
    raw.nodes[1]!.group = 'base'; // store lives on contracts, base groups primitives
    const e = mustFail(parseMap(raw, 'x'));
    expect(e).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'group-layer-mismatch' } });
  });

  it('omits the groups/lanes/kind keys entirely when unused (stable old files)', () => {
    let map = setTitle(EMPTY_MAP, 't');
    map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: rnk(0) }));
    const text = serializeMap(map);
    expect(text).not.toContain('"groups"');
    expect(text).not.toContain('"lanes"');
    expect(text).not.toContain('"kind"');
    expect(must(parseMap(JSON.parse(text), 'x'))).toEqual(map);
  });

  it('round-trips kind, lanes, node kind/lane and edge labels', () => {
    let map = setKind(setTitle(EMPTY_MAP, '登录时序'), 'sequence');
    map = must(declareLayer(map, { id: lid('t0'), name: '第1步', rank: rnk(0) }));
    map = must(declareLayer(map, { id: lid('t1'), name: '第2步', rank: rnk(1) }));
    map = must(declareLane(map, { id: laid('client'), label: '客户端' }));
    map = must(declareLane(map, { id: laid('server'), label: '服务端' }));
    map = must(
      declareNode(map, {
        id: nid('req'),
        label: '发起登录',
        layer: lid('t0'),
        lane: laid('client'),
        kind: 'action' as NodeKind,
        submap: 'login-details' as SubmapRef,
      }),
    );
    map = must(declareNode(map, { id: nid('verify'), label: '校验凭证', layer: lid('t1'), lane: laid('server') }));
    map = must(linkNodes(map, nid('verify'), nid('req'), '用户名+口令'));
    expect(must(parseMap(JSON.parse(serializeMap(map)), 'x'))).toEqual(map);
  });

  it('rejects a hand-edited unknown map kind and a node on a missing lane', () => {
    expect(
      mustFail(parseMap({ version: 1, kind: 'state-machine', layers: [], nodes: [], edges: [] }, 'x')),
    ).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'invalid-map-kind' } });
    expect(
      mustFail(
        parseMap(
          {
            version: 1,
            layers: [{ id: 'base', name: 'B', rank: 0 }],
            nodes: [{ id: 'n', label: 'N', layer: 'base', status: 'planned', lane: 'ghost' }],
            edges: [],
          },
          'x',
        ),
      ),
    ).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'unknown-lane' } });
  });

  it('rejects a node pointing at a missing layer', () => {
    const e = mustFail(
      parseMap(
        {
          version: 1,
          layers: [],
          nodes: [{ id: 'orphan', label: 'Orphan', layer: 'nowhere', status: 'planned' }],
          edges: [],
        },
        'x',
      ),
    );
    expect(e).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'unknown-layer' } });
  });

  it('rejects an invalid status in the file', () => {
    const e = mustFail(
      parseMap(
        {
          version: 1,
          layers: [{ id: 'base', name: 'Base', rank: 0 }],
          nodes: [{ id: 'n', label: 'N', layer: 'base', status: 'doing' }],
          edges: [],
        },
        'x',
      ),
    );
    expect(e).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'invalid-status' } });
  });

  it('refuses a hand-edited file whose group id also names a node, naming the id', () => {
    const e = mustFail(
      parseMap(
        {
          version: 1,
          layers: [{ id: 'base', name: 'B', rank: 0 }],
          groups: [{ id: 'core', label: '核心', layer: 'base' }],
          nodes: [{ id: 'core', label: 'Core', layer: 'base', status: 'planned' }],
          edges: [],
        },
        'x',
      ),
    );
    expect(e).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'id-collision', id: 'core' } });
    expect(describeStoreError(e)).toContain('"core"');
  });

  it('refuses exactly the ranks the domain refuses — one rank rule, not two', () => {
    for (const rank of [1.5, -1, 100, Number.NaN]) {
      expect(
        mustFail(parseMap({ version: 1, layers: [{ id: 'base', name: 'B', rank }], nodes: [], edges: [] }, 'x')),
      ).toMatchObject({ kind: 'invariant-violation', violation: { kind: 'invalid-rank' } });
    }
  });

  it('accepts a file with unknown extra fields (forward compatibility)', () => {
    const raw = { ...(JSON.parse(serializeMap(sampleMap())) as object), futureField: true };
    expect(parseMap(raw, 'x').ok).toBe(true);
  });

  it('refuses a truncated file instead of reading it as an empty map', () => {
    // The lenient read was the dangerous one: an empty interpretation is
    // what the NEXT save writes back, so a file that lost its "nodes" key
    // would lose its nodes for real.
    const e = mustFail(parseMap({ version: 1 }, 'x'));
    expect(e).toMatchObject({ kind: 'bad-shape' });
    expect(describeStoreError(e)).toContain('"layers" is missing, expected an array');
  });

  it('refuses a list field that is not a list, naming the key', () => {
    for (const [key, value] of [
      ['nodes', { a: 1 }],
      ['edges', 'none'],
      ['groups', { g: 1 }],
      ['lanes', 3],
    ] as const) {
      const raw: Record<string, unknown> = { version: 1, layers: [], nodes: [], edges: [] };
      raw[key] = value;
      const e = mustFail(parseMap(raw, 'x'));
      expect(describeStoreError(e)).toContain(`"${key}" is`);
      expect(describeStoreError(e)).toContain('expected an array');
    }
  });

  it('refuses a non-string where a string belongs, naming the field', () => {
    const withNode = (patch: Record<string, unknown>): unknown => ({
      version: 1,
      layers: [{ id: 'base', name: 'B', rank: 0 }],
      nodes: [{ id: 'n', label: 'N', layer: 'base', status: 'planned', ...patch }],
      edges: [],
    });
    // ids were coerced with String() and optional text was dropped when it
    // was not a string; both silently rewrote the file's meaning
    expect(describeStoreError(mustFail(parseMap(withNode({ id: 42 }), 'x')))).toContain('nodes[0].id is a number');
    expect(describeStoreError(mustFail(parseMap(withNode({ label: 7 }), 'x')))).toContain('nodes[0].label is a number');
    expect(describeStoreError(mustFail(parseMap(withNode({ detail: 7 }), 'x')))).toContain('nodes[0].detail is a number');
    expect(describeStoreError(mustFail(parseMap(withNode({ evidence: true }), 'x')))).toContain(
      'nodes[0].evidence is a boolean',
    );
    expect(describeStoreError(mustFail(parseMap(withNode({ status: null }), 'x')))).toContain('nodes[0].status is null');
    expect(
      describeStoreError(
        mustFail(parseMap({ version: 1, layers: [{ id: 'base', name: 9, rank: 0 }], nodes: [], edges: [] }, 'x')),
      ),
    ).toContain('layers[0].name is a number');
    expect(
      describeStoreError(mustFail(parseMap({ version: 1, title: 3, layers: [], nodes: [], edges: [] }, 'x'))),
    ).toContain('map.title is a number');
  });

  it('reads a file a Windows editor saved with a BOM', () => {
    const path = join(dir, 'bom.json');
    writeFileSync(path, '﻿' + serializeMap(sampleMap()), 'utf8');
    expect(must(loadMapFile(path))).toEqual(sampleMap());

    const defaultFile = join(dir, STATE_FILE_RELATIVE_PATH);
    mkdirSync(dirname(defaultFile), { recursive: true });
    writeFileSync(configFilePath(defaultFile), '﻿{"version":1,"policy":"always"}', 'utf8');
    expect(must(loadMappingPolicy(defaultFile))).toBe('always');
  });

  it("parses this repository's own map pages — the format's living fixture", () => {
    const root = resolve(import.meta.dirname, '..', '..');
    const candidates = [
      join(root, STATE_FILE_RELATIVE_PATH),
      join(root, '.claude', 'mellos-mapping.json'),
      ...pageDirFiles(join(root, '.mellos', 'pages')),
      ...pageDirFiles(join(root, '.claude', 'mellos-mapping.pages')),
    ].filter((p) => existsSync(p));
    // A checkout without a store (a published tarball) has nothing to prove.
    for (const file of candidates) {
      const loaded = loadMapFile(file);
      if (!loaded.ok) throw new Error(`${file}: ${describeStoreError(loaded.error)}`);
    }
  });
});

describe('pages — one effort, one file', () => {
  it('validates page ids with the shared slug grammar', () => {
    expect(makePageId('semantic-zoom').ok).toBe(true);
    expect(makePageId('Pages').ok).toBe(false);
    expect(makePageId('').ok).toBe(false);
  });

  it('maps the default page to the classic file and named pages to the pages dir', () => {
    const defaultFile = join(dir, '.mellos', 'map.json');
    expect(pageFilePath(defaultFile)).toBe(defaultFile);
    const named = pageFilePath(defaultFile, must(makePageId('pages')));
    expect(named).toBe(join(dir, '.mellos', 'pages', 'pages.json'));
    // path -> id roundtrip
    expect(pageIdOfFile(defaultFile, defaultFile)).toBeUndefined();
    expect(pageIdOfFile(defaultFile, named)).toBe('pages');
  });

  it('lists existing pages: default first, then named pages sorted by slug', () => {
    const defaultFile = join(dir, '.mellos', 'map.json');
    expect(listPageFiles(defaultFile)).toEqual([]); // nothing yet
    saveMapFile(pageFilePath(defaultFile, must(makePageId('zeta'))), sampleMap());
    saveMapFile(pageFilePath(defaultFile, must(makePageId('alpha'))), sampleMap());
    expect(listPageFiles(defaultFile).map((p) => pageIdOfFile(defaultFile, p))).toEqual(['alpha', 'zeta']);
    saveMapFile(defaultFile, sampleMap());
    expect(listPageFiles(defaultFile).map((p) => pageIdOfFile(defaultFile, p))).toEqual([undefined, 'alpha', 'zeta']);
    // a page saved through the normal path loads back losslessly
    expect(must(loadMapFile(pageFilePath(defaultFile, must(makePageId('alpha')))))).toEqual(sampleMap());
  });
});

describe('focus requests — one-shot "show this page" channel', () => {
  it('the focus file sits beside the default file', () => {
    const defaultFile = join(dir, 'map.json');
    expect(focusFilePath(defaultFile)).toBe(join(dir, 'focus'));
  });

  it('no file means no request', () => {
    expect(takeFocusRequest(join(dir, 'map.json'))).toBeUndefined();
  });

  it('consuming a request returns the page AND deletes the file (one-shot)', () => {
    const defaultFile = join(dir, 'map.json');
    writeFileSync(focusFilePath(defaultFile), '{"page":"page-focus"}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: 'page-focus' });
    expect(existsSync(focusFilePath(defaultFile))).toBe(false);
    expect(takeFocusRequest(defaultFile)).toBeUndefined();
  });

  it('page null (or absent) requests the default page', () => {
    const defaultFile = join(dir, 'map.json');
    writeFileSync(focusFilePath(defaultFile), '{"page":null}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: undefined });
    writeFileSync(focusFilePath(defaultFile), '{}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: undefined });
  });

  it('junk in the channel is no request, and the delete sweeps it', () => {
    const defaultFile = join(dir, 'map.json');
    for (const junk of ['not json', '"just-a-string"', '{"page":5}', '{"page":"NOT A SLUG"}']) {
      writeFileSync(focusFilePath(defaultFile), junk);
      expect(takeFocusRequest(defaultFile)).toBeUndefined();
      expect(existsSync(focusFilePath(defaultFile))).toBe(false);
    }
  });
});

describe('mapping policy — project setup choice', () => {
  it('the config file sits beside the default file', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    expect(configFilePath(defaultFile)).toBe(join(dir, 'config.json'));
  });

  it('validates the policy value at the boundary', () => {
    for (const p of ['always', 'complex', 'on-request']) expect(makeMappingPolicy(p)).toEqual({ ok: true, value: p });
    const bad = makeMappingPolicy('sometimes');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toEqual({ kind: 'invalid-policy', raw: 'sometimes', allowed: ['always', 'complex', 'on-request'] });
  });

  it('save then load round-trips, atomically and with no temp file behind', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    saveMappingPolicy(defaultFile, 'on-request');
    expect(loadMappingPolicy(defaultFile)).toEqual({ ok: true, value: 'on-request' });
    expect(readdirSync(dir)).toEqual(['config.json']);
    saveMappingPolicy(defaultFile, 'always'); // a re-run of setup overwrites
    expect(loadMappingPolicy(defaultFile)).toEqual({ ok: true, value: 'always' });
  });

  it('an unconfigured project is ok(undefined), never an error', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    expect(loadMappingPolicy(defaultFile)).toEqual({ ok: true, value: undefined }); // no file
    writeFileSync(configFilePath(defaultFile), '{"version":1}\n');
    expect(loadMappingPolicy(defaultFile)).toEqual({ ok: true, value: undefined }); // no key
  });

  it('a config file that exists but is broken is an error, never silently ignored', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    const cases: Array<[string, string]> = [
      ['not json', 'malformed-json'],
      ['{"version":99,"policy":"always"}', 'bad-shape'],
      ['{"version":1,"policy":"sometimes"}', 'bad-shape'],
      ['{"version":1,"policy":5}', 'bad-shape'],
    ];
    for (const [content, kind] of cases) {
      writeFileSync(configFilePath(defaultFile), content);
      const loaded = loadMappingPolicy(defaultFile);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.kind).toBe(kind);
    }
  });

  it('every policy has a one-line meaning for the surfaces to repeat', () => {
    expect(describeMappingPolicy('always')).toContain('every structured task');
    expect(describeMappingPolicy('complex')).toContain('medium or complex');
    expect(describeMappingPolicy('on-request')).toContain('explicitly asks');
  });
});

describe('atomicity (P2)', () => {
  it('a reader mid-overwrite sees the old complete map (rename replaces in one step)', () => {
    const path = join(dir, 'map.json');
    saveMapFile(path, sampleMap());
    const before = readFileSync(path, 'utf8');
    // The observable contract on one machine: after save the content is the
    // new serialization in full; the temp file never lingers.
    const next = setTitle(sampleMap(), 'v2');
    saveMapFile(path, next);
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(serializeMap(next));
    expect(after).not.toBe(before);
    expect(readdirSync(dir)).toEqual(['map.json']);
  });

  it('reports a write that cannot land as a Result, never as an exception', () => {
    // A file where the store expects a directory: the tool must answer
    // "save failed, retry", not throw an errno out of the MCP call.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory', 'utf8');
    const e = mustFail(saveMapFile(join(blocker, 'map.json'), sampleMap()));
    expect(e.kind).toBe('save-failed');
    expect(describeStoreError(e)).toContain('blocker');
    expect(readFileSync(blocker, 'utf8')).toBe('not a directory');
  });
});

describe('legacy store migration (.claude -> .mellos)', () => {
  it('moves a legacy store once, pages included', () => {
    const legacyDefault = join(dir, '.claude', 'mellos-mapping.json');
    saveMapFile(legacyDefault, sampleMap());
    saveMapFile(join(dir, '.claude', 'mellos-mapping.pages', 'side.json'), sampleMap());
    const defaultFile = join(dir, STATE_FILE_RELATIVE_PATH);
    expect(migrateLegacyStore(defaultFile)).toBe(true);
    expect(must(loadMapFile(defaultFile))).toEqual(sampleMap());
    expect(listPageFiles(defaultFile).map((p) => pageIdOfFile(defaultFile, p))).toEqual([undefined, 'side']);
    expect(existsSync(legacyDefault)).toBe(false);
    // Second call is a no-op: the move happens exactly once.
    expect(migrateLegacyStore(defaultFile)).toBe(false);
  });

  it('never merges into a project whose new store already holds anything', () => {
    const defaultFile = join(dir, STATE_FILE_RELATIVE_PATH);
    saveMapFile(defaultFile, sampleMap());
    const legacyDefault = join(dir, '.claude', 'mellos-mapping.json');
    saveMapFile(legacyDefault, sampleMap());
    expect(migrateLegacyStore(defaultFile)).toBe(false);
    expect(existsSync(legacyDefault)).toBe(true);
  });

  it('a project with no store anywhere is a no-op', () => {
    expect(migrateLegacyStore(join(dir, STATE_FILE_RELATIVE_PATH))).toBe(false);
  });
});
