/**
 * Spec for Layer 2 — tool input application.
 *
 * The load-bearing property is TRANSACTIONALITY: a batch either applies in
 * full or refuses with item context and leaves the map untouched.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_MAP, type MellosMap, type Result } from '../domain/types.js';
import {
  type DeclareInput,
  type UpdateInput,
  applyDeclare as applyDeclareAt,
  applyRemove,
  applyUpdate as applyUpdateAt,
  summarize,
} from './apply.js';

/**
 * Every apply* entry point takes the wall clock as an argument, so these specs
 * pin it. Cases that care about elapsed time call the *At forms directly with
 * their own stamps; everything else runs at T0 and never notices timing exists.
 */
const T0 = 1_700_000_000_000;
const applyDeclare = (map: MellosMap, input: DeclareInput): Result<MellosMap, string> =>
  applyDeclareAt(map, input, T0);
const applyUpdate = (map: MellosMap, input: UpdateInput): Result<MellosMap, string> => applyUpdateAt(map, input, T0);

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

function mustFail<T, E>(r: Result<T, E>): E {
  if (r.ok) throw new Error('expected an error, but the operation succeeded');
  return r.error;
}

function ghostMap(): MellosMap {
  return must(
    applyDeclare(EMPTY_MAP, {
      title: 'demo',
      layers: [
        { id: 'base', name: 'Base', rank: 0 },
        { id: 'top', name: 'Top', rank: 1 },
      ],
      nodes: [
        { id: 'a', label: 'A', layer: 'top' },
        { id: 'b', label: 'B', layer: 'base' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    }),
  );
}

describe('applyDeclare', () => {
  it('builds a whole ghost design in one batch', () => {
    const map = ghostMap();
    expect(map.title).toBe('demo');
    expect(map.layers).toHaveLength(2);
    expect(map.nodes.map((n) => n.status)).toEqual(['planned', 'planned']);
    expect(map.edges).toHaveLength(1);
  });

  it('declares groups before nodes so members can join in the same batch', () => {
    const map = must(
      applyDeclare(EMPTY_MAP, {
        layers: [{ id: 'base', name: 'Base', rank: 0 }],
        groups: [{ id: 'g', label: '地基', layer: 'base' }],
        nodes: [{ id: 'a', label: 'A', layer: 'base', group: 'g' }],
      }),
    );
    expect(map.groups).toEqual([{ id: 'g', label: '地基', layer: 'base' }]);
    expect(map.nodes[0]?.group).toBe('g');
    expect(summarize(map)).toContain('1 group(s)');
  });

  it('group updates join and leave via update (null leaves)', () => {
    let map = must(
      applyDeclare(EMPTY_MAP, {
        layers: [{ id: 'base', name: 'Base', rank: 0 }],
        groups: [{ id: 'g', label: 'G', layer: 'base' }],
        nodes: [{ id: 'a', label: 'A', layer: 'base' }],
      }),
    );
    map = must(applyUpdate(map, { updates: [{ id: 'a', group: 'g' }] }));
    expect(map.nodes[0]?.group).toBe('g');
    map = must(applyUpdate(map, { updates: [{ id: 'a', group: null }] }));
    expect(map.nodes[0]?.group).toBeUndefined();
  });

  it('removes groups before layers so an emptied band can go in one batch', () => {
    const declared = must(
      applyDeclare(EMPTY_MAP, {
        layers: [{ id: 'base', name: 'Base', rank: 0 }],
        groups: [{ id: 'g', label: 'G', layer: 'base' }],
      }),
    );
    const removed = must(applyRemove(declared, { groups: ['g'], layers: ['base'] }));
    expect(removed.groups).toEqual([]);
    expect(removed.layers).toEqual([]);
    expect(mustFail(applyRemove(declared, { layers: ['base'] }))).toContain('still holds group');
  });

  it('is all-or-nothing: a bad edge at the end rejects the entire batch', () => {
    const result = applyDeclare(EMPTY_MAP, {
      layers: [
        { id: 'base', name: 'Base', rank: 0 },
        { id: 'top', name: 'Top', rank: 1 },
      ],
      nodes: [
        { id: 'a', label: 'A', layer: 'top' },
        { id: 'b', label: 'B', layer: 'base' },
      ],
      edges: [{ from: 'b', to: 'a' }], // upward — refused
    });
    expect(mustFail(result)).toContain('edges[0]');
    expect(mustFail(result)).toContain('not strictly downward');
  });

  it('reports the failing item with its index', () => {
    const result = applyDeclare(ghostMap(), {
      nodes: [
        { id: 'c', label: 'C', layer: 'base' },
        { id: 'd', label: 'D', layer: 'nowhere' },
      ],
    });
    expect(mustFail(result)).toContain('nodes[1]');
  });

  it('rejects malformed ids at the boundary', () => {
    expect(mustFail(applyDeclare(EMPTY_MAP, { layers: [{ id: 'Bad Id', name: 'x', rank: 0 }] }))).toContain(
      'invalid id',
    );
  });

  it('grows an existing map without touching what is already there', () => {
    const grown = must(
      applyDeclare(ghostMap(), {
        nodes: [{ id: 'c', label: 'C', layer: 'base', status: 'in-progress' }],
        edges: [{ from: 'a', to: 'c' }],
      }),
    );
    expect(grown.nodes).toHaveLength(3);
    expect(grown.edges).toHaveLength(2);
    expect(grown.title).toBe('demo'); // absent title leaves the old one
  });
});

describe('diagram kinds — one transaction declares a whole documentation diagram', () => {
  it('declares kind, lanes, node kinds/lanes and labeled edges in one batch', () => {
    const map = must(
      applyDeclare(EMPTY_MAP, {
        title: '登录时序',
        kind: 'sequence',
        layers: [
          { id: 't0', name: '第1步', rank: 0 },
          { id: 't1', name: '第2步', rank: 1 },
        ],
        lanes: [
          { id: 'client', label: '客户端' },
          { id: 'server', label: '服务端' },
        ],
        nodes: [
          { id: 'req', label: '发起登录', layer: 't0', lane: 'client', kind: 'action' },
          { id: 'verify', label: '校验凭证', layer: 't1', lane: 'server' },
        ],
        edges: [{ from: 'verify', to: 'req', label: '用户名+口令' }],
      }),
    );
    expect(map.kind).toBe('sequence');
    expect(map.lanes.map((l) => l.id)).toEqual(['client', 'server']);
    expect(map.nodes[0]).toMatchObject({ lane: 'client', kind: 'action' });
    expect(map.edges[0]!.label).toBe('用户名+口令');
  });

  it('refuses an unknown kind with no partial change, and updates can re-lane / clear kind', () => {
    expect(mustFail(applyDeclare(EMPTY_MAP, { kind: 'state-machine' }))).toContain('invalid map kind');

    let map = must(
      applyDeclare(EMPTY_MAP, {
        layers: [{ id: 'base', name: 'B', rank: 0 }],
        lanes: [{ id: 'l1', label: 'L1' }],
        nodes: [{ id: 'n', label: 'N', layer: 'base', lane: 'l1', kind: 'db' }],
      }),
    );
    map = must(applyUpdate(map, { updates: [{ id: 'n', lane: null, kind: null }] }));
    expect(map.nodes[0]!.lane).toBeUndefined();
    expect(map.nodes[0]!.kind).toBeUndefined();
    map = must(applyRemove(map, { lanes: ['l1'] }));
    expect(map.lanes).toEqual([]);
  });

  it('summarize reports lanes and non-dev kinds', () => {
    const map = must(
      applyDeclare(EMPTY_MAP, {
        kind: 'architecture',
        layers: [{ id: 'base', name: 'B', rank: 0 }],
        lanes: [{ id: 'l1', label: 'L1' }],
      }),
    );
    expect(summarize(map)).toBe('map now: 1 layer(s), 0 node(s), 1 lane(s), 0 edge(s) (architecture)');
  });
});

describe('applyUpdate', () => {
  it('records status with evidence across several nodes', () => {
    const updated = must(
      applyUpdate(ghostMap(), {
        updates: [
          { id: 'b', status: 'done', evidence: 'vitest: 9 passed' },
          { id: 'a', status: 'in-progress' },
        ],
      }),
    );
    expect(updated.nodes.find((n) => n.id === 'b')).toMatchObject({ status: 'done', evidence: 'vitest: 9 passed' });
    expect(updated.nodes.find((n) => n.id === 'a')?.status).toBe('in-progress');
  });

  it('is all-or-nothing: one unknown node rejects the batch', () => {
    const result = applyUpdate(ghostMap(), {
      updates: [
        { id: 'b', status: 'done' },
        { id: 'ghost', status: 'done' },
      ],
    });
    expect(mustFail(result)).toContain('updates[1]');
  });
});

describe('applyRemove', () => {
  it('removes edges before nodes before bands, so one batch can clear a corner of the map', () => {
    const cleared = must(
      applyRemove(ghostMap(), {
        edges: [{ from: 'a', to: 'b' }],
        nodes: ['a'],
        layers: ['top'],
      }),
    );
    expect(cleared.layers.map((l) => l.id)).toEqual(['base']);
    expect(cleared.nodes.map((n) => n.id)).toEqual(['b']);
    expect(cleared.edges).toEqual([]);
  });

  it('refuses to remove a band that still holds nodes', () => {
    expect(mustFail(applyRemove(ghostMap(), { layers: ['base'] }))).toContain('still holds node');
  });
});

describe('summarize', () => {
  it('reports counts by status', () => {
    const map = must(applyUpdate(ghostMap(), { updates: [{ id: 'b', status: 'done' }] }));
    expect(summarize(map)).toBe('map now: 2 layer(s), 2 node(s) [1 planned, 1 done], 1 edge(s)');
  });
});
