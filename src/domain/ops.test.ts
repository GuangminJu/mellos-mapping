/**
 * Spec for the Layer 0 domain model.
 *
 * These tests document the structural invariants I1-I5 (see types.ts) and the
 * "ledger, not judge" principle: the map refuses structural corruption and
 * records everything else without opinion.
 */

import { describe, expect, it } from 'vitest';

import {
  declareGroup,
  declareLane,
  declareLayer,
  declareNode,
  groupStatus,
  linkNodes,
  mapStatus,
  removeEdge,
  removeGroup,
  removeLane,
  removeLayer,
  removeNode,
  setKind,
  setTitle,
  IDLE_CAP_MS,
  effortOf,
  elapsedOf,
  isStalled,
  spanTotal,
  updateNode,
} from './ops.js';
import {
  EMPTY_MAP,
  type GroupId,
  type LaneId,
  type LayerId,
  type MapNode,
  type MellosMap,
  type NodeId,
  type WorkSpan,
  type NodeKind,
  type Result,
  type SubmapRef,
  makeGroupId,
  makeLaneId,
  makeLayerId,
  makeMapKind,
  makeNodeId,
  makeNodeKind,
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
const gid = (raw: string): GroupId => must(makeGroupId(raw));
const laid = (raw: string): LaneId => must(makeLaneId(raw));
const nkind = (raw: string): NodeKind => must(makeNodeKind(raw));

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

  it('records design notes at declaration and via update', () => {
    let map = must(
      declareNode(threeBands(), { id: nid('a'), label: 'A', layer: lid('primitives'), detail: '职责：装下一切。' }),
    );
    expect(map.nodes[0]?.detail).toBe('职责：装下一切。');
    map = must(updateNode(map, { id: nid('a'), detail: '改主意了。' }));
    expect(map.nodes[0]).toMatchObject({ detail: '改主意了。', label: 'A' });
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

describe('groups — band-local labeled clusters (I6, I7)', () => {
  function grouped(): MellosMap {
    let map = threeBands();
    map = must(declareGroup(map, { id: gid('foundation'), label: '地基子系统', layer: lid('primitives') }));
    map = must(
      declareNode(map, { id: nid('a'), label: 'A', layer: lid('primitives'), status: 'done', group: gid('foundation') }),
    );
    map = must(
      declareNode(map, { id: nid('b'), label: 'B', layer: lid('primitives'), status: 'planned', group: gid('foundation') }),
    );
    map = must(declareNode(map, { id: nid('c'), label: 'C', layer: lid('contracts') }));
    return map;
  }

  it('declares groups on existing bands and refuses duplicates', () => {
    const map = grouped();
    expect(map.groups).toEqual([{ id: 'foundation', label: '地基子系统', layer: 'primitives' }]);
    expect(mustFail(declareGroup(map, { id: gid('foundation'), label: 'again', layer: lid('contracts') })).kind).toBe(
      'duplicate-group',
    );
    expect(mustFail(declareGroup(map, { id: gid('x'), label: 'X', layer: lid('nowhere') })).kind).toBe('unknown-layer');
  });

  it('refuses membership across bands — a group is band-local cohesion', () => {
    const e = mustFail(
      declareNode(grouped(), { id: nid('x'), label: 'X', layer: lid('contracts'), group: gid('foundation') }),
    );
    expect(e).toMatchObject({ kind: 'group-layer-mismatch', nodeLayer: 'contracts', groupLayer: 'primitives' });
    const viaUpdate = mustFail(updateNode(grouped(), { id: nid('c'), group: gid('foundation') }));
    expect(viaUpdate.kind).toBe('group-layer-mismatch');
  });

  it('joins and leaves a group via update (null leaves)', () => {
    let map = must(updateNode(grouped(), { id: nid('b'), group: null }));
    expect(map.nodes.find((n) => n.id === 'b')?.group).toBeUndefined();
    map = must(updateNode(map, { id: nid('b'), group: gid('foundation') }));
    expect(map.nodes.find((n) => n.id === 'b')?.group).toBe('foundation');
  });

  it('derives group status from members and never stores it', () => {
    let map = grouped();
    expect(groupStatus(map, gid('foundation'))).toBe('planned'); // done + planned
    map = must(updateNode(map, { id: nid('b'), status: 'in-progress' }));
    expect(groupStatus(map, gid('foundation'))).toBe('in-progress');
    map = must(updateNode(map, { id: nid('b'), status: 'done' }));
    expect(groupStatus(map, gid('foundation'))).toBe('done');
    map = must(updateNode(map, { id: nid('a'), status: 'regressed' }));
    expect(groupStatus(map, gid('foundation'))).toBe('regressed');
    expect('status' in map.groups[0]!).toBe(false); // derived, never stored
  });

  it('removing a group merely ungroups its members', () => {
    const after = must(removeGroup(grouped(), gid('foundation')));
    expect(after.groups).toEqual([]);
    expect(after.nodes.map((n) => n.group)).toEqual([undefined, undefined, undefined]);
    expect(after.nodes).toHaveLength(3);
  });

  it('derives the whole map status with the same rules (for page tabs)', () => {
    expect(mapStatus(threeBands())).toBe('planned'); // no nodes
    let map = grouped(); // done + planned + planned
    expect(mapStatus(map)).toBe('planned');
    map = must(updateNode(map, { id: nid('c'), status: 'in-progress' }));
    expect(mapStatus(map)).toBe('in-progress');
  });

  it('a band holding a group cannot be removed', () => {
    let map = threeBands();
    map = must(declareGroup(map, { id: gid('g'), label: 'G', layer: lid('orchestration') }));
    expect(mustFail(removeLayer(map, lid('orchestration'))).kind).toBe('layer-holds-group');
    expect(must(removeGroup(map, gid('g'))).groups).toEqual([]);
  });
});

describe('map kind — presentation intent, never structure', () => {
  it('accepts only the closed vocabulary', () => {
    expect(must(makeMapKind('sequence'))).toBe('sequence');
    expect(mustFail(makeMapKind('state-machine')).kind).toBe('invalid-map-kind');
  });

  it('setKind returns a copy with the kind; structure is untouched', () => {
    const map = setKind(threeBands(), must(makeMapKind('architecture')));
    expect(map.kind).toBe('architecture');
    expect(map.layers).toHaveLength(3);
  });
});

describe('lanes — cross-band columns (I8, I9)', () => {
  function laned(): MellosMap {
    let map = threeBands();
    map = must(declareLane(map, { id: laid('client'), label: '客户端' }));
    map = must(declareLane(map, { id: laid('server'), label: '服务端' }));
    map = must(declareNode(map, { id: nid('req'), label: '发请求', layer: lid('primitives'), lane: laid('client') }));
    return map;
  }

  it('lane ids are unique (I8); declaration order is preserved', () => {
    const map = laned();
    expect(mustFail(declareLane(map, { id: laid('client'), label: '重复' })).kind).toBe('duplicate-lane');
    expect(map.lanes.map((l) => l.id)).toEqual(['client', 'server']);
  });

  it("a node's lane must exist (I9), at declare and at update", () => {
    const map = laned();
    expect(
      mustFail(declareNode(map, { id: nid('x'), label: 'X', layer: lid('contracts'), lane: laid('ghost') })).kind,
    ).toBe('unknown-lane');
    expect(mustFail(updateNode(map, { id: nid('req'), lane: laid('ghost') })).kind).toBe('unknown-lane');
  });

  it('lane membership moves with update; null leaves the lane', () => {
    let map = laned();
    map = must(updateNode(map, { id: nid('req'), lane: laid('server') }));
    expect(map.nodes[0]!.lane).toBe('server');
    map = must(updateNode(map, { id: nid('req'), lane: null }));
    expect(map.nodes[0]!.lane).toBeUndefined();
  });

  it('removing a lane merely un-lanes its members (work records survive)', () => {
    const map = must(removeLane(laned(), laid('client')));
    expect(map.lanes.map((l) => l.id)).toEqual(['server']);
    expect(map.nodes[0]!.lane).toBeUndefined();
    expect(map.nodes[0]!.label).toBe('发请求');
    expect(mustFail(removeLane(map, laid('client'))).kind).toBe('unknown-lane');
  });
});

describe('node kind and edge label — annotation, not structure', () => {
  it('a node carries an open-vocabulary kind; null clears it', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('sel'), label: '选根', layer: lid('contracts'), kind: nkind('selector') }));
    expect(map.nodes[0]!.kind).toBe('selector');
    map = must(updateNode(map, { id: nid('sel'), kind: null }));
    expect(map.nodes[0]!.kind).toBeUndefined();
  });

  it('a node may link a child map page; the reference needs no page to exist yet', () => {
    let map = threeBands();
    map = must(
      declareNode(map, { id: nid('store'), label: '存储', layer: lid('primitives'), submap: 'store-internals' as SubmapRef }),
    );
    expect(map.nodes[0]!.submap).toBe('store-internals');
    map = must(updateNode(map, { id: nid('store'), submap: null }));
    expect(map.nodes[0]!.submap).toBeUndefined();
  });

  it('an edge may carry a label saying what flows along it', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('low'), label: 'L', layer: lid('primitives') }));
    map = must(declareNode(map, { id: nid('high'), label: 'H', layer: lid('contracts') }));
    map = must(linkNodes(map, nid('high'), nid('low'), '登录请求'));
    expect(map.edges[0]).toEqual({ from: 'high', to: 'low', label: '登录请求' });
    // unlabeled edges stay bare — no label key at all
    map = must(declareNode(map, { id: nid('top'), label: 'T', layer: lid('orchestration') }));
    map = must(linkNodes(map, nid('top'), nid('low')));
    expect('label' in map.edges[1]!).toBe(false);
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

describe('work spans and elapsed time', () => {
  const T = 1_700_000_000_000;
  const s = (from: number, to?: number): WorkSpan => (to === undefined ? { from } : { from, to });
  const findNode = (map: MellosMap, id: string): MapNode | undefined => map.nodes.find((n) => (n.id as string) === id);

  it('measures a union, so overlapping stretches are counted once', () => {
    expect(spanTotal([], T)).toBe(0);
    expect(spanTotal([s(0, 10)], T)).toBe(10);
    // disjoint: both count
    expect(spanTotal([s(0, 10), s(20, 30)], T)).toBe(20);
    // overlapping: the shared middle is counted once, not twice
    expect(spanTotal([s(0, 10), s(5, 15)], T)).toBe(15);
    // fully nested: the inner stretch adds nothing
    expect(spanTotal([s(0, 100), s(10, 20)], T)).toBe(100);
    // touching end to end merges seamlessly
    expect(spanTotal([s(0, 10), s(10, 20)], T)).toBe(20);
  });

  it('is order-independent and survives a clock that ran backwards', () => {
    expect(spanTotal([s(20, 30), s(0, 10), s(5, 25)], T)).toBe(30);
    // to before from would be a negative stretch; it clamps to zero instead of refusing
    expect(spanTotal([s(50, 40)], T)).toBe(0);
  });

  it('runs an open stretch up to now', () => {
    expect(spanTotal([s(T - 5_000)], T)).toBe(5_000);
    expect(spanTotal([s(T - 5_000), s(T - 3_000)], T)).toBe(5_000); // two open stretches still overlap
  });

  it('caps an open stretch at the idle limit, but never a closed one', () => {
    const night = 14 * 3_600_000;
    // abandoned spinner: bills the cap, not the night
    expect(spanTotal([s(T - night)], T)).toBe(IDLE_CAP_MS);
    // a genuinely long stretch that was closed has two real stamps — untouched
    expect(spanTotal([s(T - night, T)], T)).toBe(night);
    // the cap is a parameter, so a caller with different tolerance can say so
    expect(spanTotal([s(T - night)], T, 60_000)).toBe(60_000);
  });

  it('reports when a total has become a floor rather than a measurement', () => {
    const node = (spans: WorkSpan[]): MapNode => ({ id: nid('n'), label: 'N', layer: lid('base'), status: 'in-progress', spans });
    expect(isStalled([node([s(T - IDLE_CAP_MS - 1)])], T)).toBe(true);
    expect(isStalled([node([s(T - 1_000)])], T)).toBe(false); // open but young
    expect(isStalled([node([s(T - 10 * 3_600_000, T)])], T)).toBe(false); // long but closed
    expect(isStalled([node([])], T)).toBe(false);
  });

  it('opens a span on entering in-progress and closes it on leaving', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('core'), label: '核心', layer: lid('primitives') }));
    expect(findNode(map, 'core')?.spans).toBeUndefined();

    map = must(updateNode(map, { id: nid('core'), status: 'in-progress', at: T }));
    expect(findNode(map, 'core')?.spans).toEqual([{ from: T }]);

    // a second in-progress report keeps the one open stretch
    map = must(updateNode(map, { id: nid('core'), status: 'in-progress', at: T + 1_000 }));
    expect(findNode(map, 'core')?.spans).toEqual([{ from: T }]);

    map = must(updateNode(map, { id: nid('core'), status: 'done', at: T + 60_000 }));
    expect(findNode(map, 'core')?.spans).toEqual([{ from: T, to: T + 60_000 }]);
    expect(elapsedOf([findNode(map, 'core')!], T + 999_999)).toBe(60_000);
  });

  it('gives rework its own stretch instead of overwriting the first', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('core'), label: '核心', layer: lid('primitives') }));
    map = must(updateNode(map, { id: nid('core'), status: 'in-progress', at: T }));
    map = must(updateNode(map, { id: nid('core'), status: 'done', at: T + 10_000 }));
    map = must(updateNode(map, { id: nid('core'), status: 'regressed', at: T + 20_000 }));
    map = must(updateNode(map, { id: nid('core'), status: 'in-progress', at: T + 30_000 }));
    map = must(updateNode(map, { id: nid('core'), status: 'done', at: T + 45_000 }));
    expect(findNode(map, 'core')?.spans).toEqual([
      { from: T, to: T + 10_000 },
      { from: T + 30_000, to: T + 45_000 },
    ]);
    expect(elapsedOf([findNode(map, 'core')!], T)).toBe(25_000); // 10s + 15s, the idle gap excluded
  });

  it('records nothing without a stamp, so relabels and store replays stay inert', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('core'), label: '核心', layer: lid('primitives') }));
    map = must(updateNode(map, { id: nid('core'), status: 'in-progress' }));
    expect(findNode(map, 'core')?.spans).toBeUndefined();
    map = must(updateNode(map, { id: nid('core'), status: 'in-progress', at: T }));
    map = must(updateNode(map, { id: nid('core'), label: '核心模块' }));
    expect(findNode(map, 'core')?.spans).toEqual([{ from: T }]); // a relabel never closes a stretch
  });

  it('separates calendar time from effort, and their ratio is the parallelism', () => {
    let map = threeBands();
    map = must(declareNode(map, { id: nid('a'), label: 'A', layer: lid('primitives') }));
    map = must(declareNode(map, { id: nid('b'), label: 'B', layer: lid('primitives') }));
    // both worked on over the very same minute
    for (const id of ['a', 'b']) {
      map = must(updateNode(map, { id: nid(id), status: 'in-progress', at: T }));
      map = must(updateNode(map, { id: nid(id), status: 'done', at: T + 60_000 }));
    }
    expect(elapsedOf(map.nodes, T)).toBe(60_000); // one minute of calendar
    expect(effortOf(map.nodes, T)).toBe(120_000); // two minutes of attention
  });
});
