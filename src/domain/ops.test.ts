/**
 * Spec for the Layer 0 domain model.
 *
 * These tests document the structural invariants I1-I5 (see types.ts) and the
 * "ledger, not judge" principle: the map refuses structural corruption and
 * records everything else without opinion.
 */

import { describe, expect, it } from 'vitest';

import {
  declareLayer,
  declareNode,
  linkNodes,
  removeEdge,
  removeLayer,
  removeNode,
  setTitle,
  updateNode,
} from './ops.js';
import {
  EMPTY_MAP,
  type LayerId,
  type MellosMap,
  type NodeId,
  type Result,
  makeLayerId,
  makeNodeId,
  makeNodeStatus,
} from './types.js';

/** Test helper: unwrap a Result that the spec expects to succeed. */
function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Test helper: unwrap the error of a Result that the spec expects to fail. */
function mustFail<T, E>(r: Result<T, E>): E {
  if (r.ok) throw new Error('expected an error, but the operation succeeded');
  return r.error;
}

const lid = (raw: string): LayerId => must(makeLayerId(raw));
const nid = (raw: string): NodeId => must(makeNodeId(raw));

/** A three-band map: primitives(0) < contracts(1) < orchestration(2). */
function threeBands(): MellosMap {
  let map = must(declareLayer(EMPTY_MAP, { id: lid('primitives'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: 1 }));
  map = must(declareLayer(map, { id: lid('orchestration'), name: '编排层', rank: 2 }));
  return map;
}

describe('ids and status vocabulary (I5)', () => {
  it('accepts kebab-case slugs and rejects anything else', () => {
    expect(makeNodeId('score-value').ok).toBe(true);
    expect(makeNodeId('a').ok).toBe(true);
    expect(makeNodeId('9lives').ok).toBe(true);
    expect(makeNodeId('').ok).toBe(false);
    expect(makeNodeId('Uppercase').ok).toBe(false);
    expect(makeNodeId('has space').ok).toBe(false);
    expect(makeNodeId('-leading-dash').ok).toBe(false);
    expect(makeNodeId('汉字').ok).toBe(false);
  });

  it('accepts exactly the four statuses', () => {
    for (const s of ['planned', 'in-progress', 'done', 'regressed']) {
      expect(makeNodeStatus(s).ok).toBe(true);
    }
    expect(mustFail(makeNodeStatus('doing')).kind).toBe('invalid-status');
  });
});

describe('layers (I1)', () => {
  it('declares bands with unique ids and unique ranks', () => {
    const map = threeBands();
    expect(map.layers.map((l) => l.rank)).toEqual([0, 1, 2]);
  });

  it('rejects a duplicate layer id', () => {
    const e = mustFail(declareLayer(threeBands(), { id: lid('contracts'), name: 'again', rank: 9 }));
    expect(e.kind).toBe('duplicate-layer');
  });

  it('rejects a duplicate rank — bands are totally ordered', () => {
    const e = mustFail(declareLayer(threeBands(), { id: lid('extra'), name: 'extra', rank: 1 }));
    expect(e).toMatchObject({ kind: 'duplicate-rank', rank: 1, existing: 'contracts' });
  });

  it('removes only empty bands', () => {
    const withNode = must(declareNode(threeBands(), { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));
    expect(mustFail(removeLayer(withNode, lid('primitives'))).kind).toBe('layer-not-empty');
    expect(must(removeLayer(withNode, lid('orchestration'))).layers).toHaveLength(2);
  });
});

describe('nodes (I2, I3)', () => {
  it('declares a node as a planned ghost by default', () => {
    const map = must(declareNode(threeBands(), { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));
    expect(map.nodes[0]).toMatchObject({ id: 'result', status: 'planned' });
  });

  it('rejects a node on a band that does not exist', () => {
    const e = mustFail(declareNode(threeBands(), { id: nid('x'), label: 'X', layer: lid('nowhere') }));
    expect(e.kind).toBe('unknown-layer');
  });

  it('rejects a duplicate node id', () => {
    const map = must(declareNode(threeBands(), { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));
    expect(mustFail(declareNode(map, { id: nid('result'), label: 'again', layer: lid('contracts') })).kind).toBe(
      'duplicate-node',
    );
  });
});

describe('edges point strictly downward (I4)', () => {
  function populated(): MellosMap {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));
    map = must(declareNode(map, { id: nid('score-value'), label: 'FScoreValue', layer: lid('primitives') }));
    map = must(declareNode(map, { id: nid('score-agg'), label: 'ScoreAggregator', layer: lid('contracts') }));
    map = must(declareNode(map, { id: nid('runner'), label: 'SimRunner', layer: lid('orchestration') }));
    return map;
  }

  it('accepts a downward edge to the band directly below', () => {
    const map = must(linkNodes(populated(), nid('score-agg'), nid('result')));
    expect(map.edges).toEqual([{ from: 'score-agg', to: 'result' }]);
  });

  it('accepts a downward edge that skips bands', () => {
    expect(linkNodes(populated(), nid('runner'), nid('result')).ok).toBe(true);
  });

  it('rejects an upward edge', () => {
    const e = mustFail(linkNodes(populated(), nid('result'), nid('runner')));
    expect(e).toMatchObject({ kind: 'edge-not-downward', fromRank: 0, toRank: 2 });
  });

  it('rejects a same-band edge — siblings either hide a lower concept or are one node', () => {
    const e = mustFail(linkNodes(populated(), nid('score-agg'), nid('score-agg')));
    expect(e.kind).toBe('self-edge');
    const e2 = mustFail(linkNodes(populated(), nid('result'), nid('score-value')));
    expect(e2).toMatchObject({ kind: 'edge-not-downward', fromRank: 0, toRank: 0 });
  });

  it('rejects duplicates and edges touching unknown nodes', () => {
    const one = must(linkNodes(populated(), nid('score-agg'), nid('result')));
    expect(mustFail(linkNodes(one, nid('score-agg'), nid('result'))).kind).toBe('duplicate-edge');
    expect(mustFail(linkNodes(one, nid('ghost'), nid('result'))).kind).toBe('unknown-node');
    expect(mustFail(linkNodes(one, nid('score-agg'), nid('ghost'))).kind).toBe('unknown-node');
  });

  it('corollary: no cycle can ever be assembled', () => {
    // Every accepted edge strictly decreases rank, so any path strictly
    // descends and can never revisit a node. The spec pins the property
    // with the smallest would-be cycle: a->b then b->a.
    let map = must(linkNodes(populated(), nid('score-agg'), nid('result')));
    expect(linkNodes(map, nid('result'), nid('score-agg')).ok).toBe(false);
  });
});

describe('updates are unpoliced records (ledger, not judge)', () => {
  const base = () =>
    must(declareNode(threeBands(), { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));

  it('sets status with evidence', () => {
    const map = must(updateNode(base(), { id: nid('result'), status: 'done', evidence: 'vitest: 12 passed' }));
    expect(map.nodes[0]).toMatchObject({ status: 'done', evidence: 'vitest: 12 passed' });
  });

  it('allows any transition, including planned -> done and done -> regressed', () => {
    let map = must(updateNode(base(), { id: nid('result'), status: 'done' }));
    map = must(updateNode(map, { id: nid('result'), status: 'regressed', evidence: 'store.test.ts now failing' }));
    expect(map.nodes[0]?.status).toBe('regressed');
  });

  it('leaves absent fields untouched', () => {
    let map = must(updateNode(base(), { id: nid('result'), status: 'in-progress', evidence: 'wip' }));
    map = must(updateNode(map, { id: nid('result'), label: 'Result<T, E>' }));
    expect(map.nodes[0]).toMatchObject({ label: 'Result<T, E>', status: 'in-progress', evidence: 'wip' });
  });

  it('refuses updates to nodes that do not exist', () => {
    expect(mustFail(updateNode(base(), { id: nid('ghost'), status: 'done' })).kind).toBe('unknown-node');
  });
});

describe('removal keeps the map closed (no dangling references)', () => {
  it('removing a node removes every edge touching it', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('result'), label: 'Result<T>', layer: lid('primitives') }));
    map = must(declareNode(map, { id: nid('score-agg'), label: 'ScoreAggregator', layer: lid('contracts') }));
    map = must(declareNode(map, { id: nid('runner'), label: 'SimRunner', layer: lid('orchestration') }));
    map = must(linkNodes(map, nid('score-agg'), nid('result')));
    map = must(linkNodes(map, nid('runner'), nid('result')));
    map = must(linkNodes(map, nid('runner'), nid('score-agg')));

    const after = must(removeNode(map, nid('result')));
    expect(after.nodes.map((n) => n.id)).toEqual(['score-agg', 'runner']);
    expect(after.edges).toEqual([{ from: 'runner', to: 'score-agg' }]);
  });

  it('removes a single edge, refuses unknown edges', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('a'), label: 'A', layer: lid('contracts') }));
    map = must(declareNode(map, { id: nid('b'), label: 'B', layer: lid('primitives') }));
    map = must(linkNodes(map, nid('a'), nid('b')));
    expect(must(removeEdge(map, nid('a'), nid('b'))).edges).toEqual([]);
    expect(mustFail(removeEdge(map, nid('b'), nid('a'))).kind).toBe('unknown-edge');
  });
});

describe('operations are pure', () => {
  it('never mutates the input map', () => {
    const before = threeBands();
    const frozen = JSON.stringify(before);
    void declareLayer(before, { id: lid('extra'), name: 'extra', rank: 3 });
    void declareNode(before, { id: nid('n'), label: 'N', layer: lid('primitives') });
    void setTitle(before, 'renamed');
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('setTitle returns a retitled copy', () => {
    expect(setTitle(EMPTY_MAP, '梅勒斯地图').title).toBe('梅勒斯地图');
  });
});
