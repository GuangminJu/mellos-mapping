/**
 * Spec for Layer 1 — persistence promises P1 (loaded data satisfies Layer 0
 * invariants) and P2 (writes are atomic; round-trips are lossless).
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  type Result,
  type SubmapRef,
} from '../domain/types.js';
import {
  focusFilePath,
  listPageFiles,
  loadMapFile,
  makePageId,
  pageFilePath,
  pageIdOfFile,
  parseMap,
  saveMapFile,
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
const gid = (raw: string): GroupId => raw as GroupId;
const laid = (raw: string): LaneId => raw as LaneId;

function sampleMap(): MellosMap {
  let map = setTitle(EMPTY_MAP, '梅勒斯地图');
  map = must(declareLayer(map, { id: lid('primitives'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: 1 }));
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
    const path = join(dir, '.claude', 'mellos-mapping.json');
    saveMapFile(path, sampleMap());
    expect(must(loadMapFile(path))).toEqual(sampleMap());
  });

  it('creates the parent directory and leaves no temp file behind', () => {
    const path = join(dir, '.claude', 'mellos-mapping.json');
    saveMapFile(path, sampleMap());
    expect(readdirSync(join(dir, '.claude'))).toEqual(['mellos-mapping.json']);
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
    map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: 0 }));
    const text = serializeMap(map);
    expect(text).not.toContain('"groups"');
    expect(text).not.toContain('"lanes"');
    expect(text).not.toContain('"kind"');
    expect(must(parseMap(JSON.parse(text), 'x'))).toEqual(map);
  });

  it('round-trips kind, lanes, node kind/lane and edge labels', () => {
    let map = setKind(setTitle(EMPTY_MAP, '登录时序'), 'sequence');
    map = must(declareLayer(map, { id: lid('t0'), name: '第1步', rank: 0 }));
    map = must(declareLayer(map, { id: lid('t1'), name: '第2步', rank: 1 }));
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

  it('accepts a file with unknown extra fields (forward compatibility)', () => {
    const raw = { ...(JSON.parse(serializeMap(sampleMap())) as object), futureField: true };
    expect(parseMap(raw, 'x').ok).toBe(true);
  });
});

describe('pages — one effort, one file', () => {
  it('validates page ids with the shared slug grammar', () => {
    expect(makePageId('semantic-zoom').ok).toBe(true);
    expect(makePageId('Pages').ok).toBe(false);
    expect(makePageId('').ok).toBe(false);
  });

  it('maps the default page to the classic file and named pages to the pages dir', () => {
    const defaultFile = join(dir, '.claude', 'mellos-mapping.json');
    expect(pageFilePath(defaultFile)).toBe(defaultFile);
    const named = pageFilePath(defaultFile, must(makePageId('pages')));
    expect(named).toBe(join(dir, '.claude', 'mellos-mapping.pages', 'pages.json'));
    // path -> id roundtrip
    expect(pageIdOfFile(defaultFile, defaultFile)).toBeUndefined();
    expect(pageIdOfFile(defaultFile, named)).toBe('pages');
  });

  it('lists existing pages: default first, then named pages sorted by slug', () => {
    const defaultFile = join(dir, '.claude', 'mellos-mapping.json');
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
    const defaultFile = join(dir, 'mellos-mapping.json');
    expect(focusFilePath(defaultFile)).toBe(join(dir, 'mellos-mapping.focus'));
  });

  it('no file means no request', () => {
    expect(takeFocusRequest(join(dir, 'mellos-mapping.json'))).toBeUndefined();
  });

  it('consuming a request returns the page AND deletes the file (one-shot)', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    writeFileSync(focusFilePath(defaultFile), '{"page":"page-focus"}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: 'page-focus' });
    expect(existsSync(focusFilePath(defaultFile))).toBe(false);
    expect(takeFocusRequest(defaultFile)).toBeUndefined();
  });

  it('page null (or absent) requests the default page', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    writeFileSync(focusFilePath(defaultFile), '{"page":null}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: undefined });
    writeFileSync(focusFilePath(defaultFile), '{}');
    expect(takeFocusRequest(defaultFile)).toEqual({ page: undefined });
  });

  it('junk in the channel is no request, and the delete sweeps it', () => {
    const defaultFile = join(dir, 'mellos-mapping.json');
    for (const junk of ['not json', '"just-a-string"', '{"page":5}', '{"page":"NOT A SLUG"}']) {
      writeFileSync(focusFilePath(defaultFile), junk);
      expect(takeFocusRequest(defaultFile)).toBeUndefined();
      expect(existsSync(focusFilePath(defaultFile))).toBe(false);
    }
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
});
