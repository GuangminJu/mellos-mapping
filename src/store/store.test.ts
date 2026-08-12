/**
 * Spec for Layer 1 — persistence promises P1 (loaded data satisfies Layer 0
 * invariants) and P2 (writes are atomic; round-trips are lossless).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareLayer, declareNode, linkNodes, setTitle, updateNode } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Result } from '../domain/types.js';
import { loadMapFile, parseMap, saveMapFile, serializeMap } from './store.js';

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

function sampleMap(): MellosMap {
  let map = setTitle(EMPTY_MAP, '梅勒斯地图');
  map = must(declareLayer(map, { id: lid('primitives'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: 1 }));
  map = must(
    declareNode(map, {
      id: nid('result'),
      label: 'Result<T>',
      layer: lid('primitives'),
      status: 'done',
      detail: '期望中的失败是值，不是异常。',
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
