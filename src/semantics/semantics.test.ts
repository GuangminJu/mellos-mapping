/**
 * Spec for Layer 1c — the view semantics every medium must agree on.
 *
 * The terminal pane, a browser panel and a future editor view all derive
 * their picture from these functions, so what is pinned here is MEANING, not
 * geometry: what a zoom step is, what the far view aggregates a map into,
 * what a detail panel knows about a focused box, which pages are siblings
 * and which are interior, and which glyph a status wears everywhere.
 *
 * Maps are written as plain values (the layer is pure), with the domain's
 * brands cast on at construction — the same shortcut ops.test.ts takes.
 */

import { describe, expect, it } from 'vitest';

import type {
  DepEdge,
  GroupId,
  LaneId,
  LayerId,
  MapGroup,
  MapLane,
  MapLayer,
  MapNode,
  MellosMap,
  NodeId,
  Rank,
  SubmapRef,
} from '../domain/types.js';
import {
  NODE_KIND_GLYPHS,
  SPINNER_FRAMES,
  STATUS_GLYPHS,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  aggregateMap,
  clampZoom,
  diveParent,
  flipForSequence,
  focusInfo,
  interiorPages,
  isNeutralKind,
  kindGlyph,
  mostRecentKey,
  spinnerGlyph,
  statusGlyph,
  submapRefs,
  zoomLabel,
  zoomMode,
} from './semantics.js';

const layer = (id: string, name: string, rank: number): MapLayer => ({
  id: id as LayerId,
  name,
  rank: rank as Rank,
});
const group = (id: string, label: string, inLayer: string): MapGroup => ({
  id: id as GroupId,
  label,
  layer: inLayer as LayerId,
});
const lane = (id: string, label: string): MapLane => ({ id: id as LaneId, label });
const node = (id: string, label: string, inLayer: string, extra: Partial<MapNode> = {}): MapNode => ({
  id: id as NodeId,
  label,
  layer: inLayer as LayerId,
  status: 'planned',
  ...extra,
});
const edge = (from: string, to: string, label?: string): DepEdge => ({
  from: from as NodeId,
  to: to as NodeId,
  ...(label !== undefined ? { label } : {}),
});
const mapOf = (parts: Partial<MellosMap>): MellosMap => ({
  layers: [],
  groups: [],
  lanes: [],
  nodes: [],
  edges: [],
  ...parts,
});

describe('the zoom ladder', () => {
  it('clamps to the ends of the ladder and rounds to a step', () => {
    expect(clampZoom(-99)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(1.6)).toBe(2);
    expect(clampZoom(0.4)).toBe(0);
    expect(clampZoom(-1.4)).toBe(-1);
  });

  it('switches mode only at the ends: everything between is boxes', () => {
    expect(zoomMode(2)).toBe('detail');
    expect(zoomMode(1)).toBe('detail');
    for (const z of [0, -1, -2, -3] as const) expect(zoomMode(z)).toBe('boxes');
    expect(zoomMode(-4)).toBe('overview');
  });

  it('labels the scaling steps with a percentage and the ends with their mode', () => {
    expect([2, 1, 0, -1, -2, -3, -4].map((z) => zoomLabel(z as -4 | -3 | -2 | -1 | 0 | 1 | 2))).toEqual([
      'detail+',
      'detail',
      '100%',
      '85%',
      '70%',
      '55%',
      'overview',
    ]);
  });
});

describe('kind semantics', () => {
  it('treats an absent kind and dev as the progress ledger, every other kind as documentation', () => {
    expect(isNeutralKind(mapOf({}))).toBe(false);
    expect(isNeutralKind(mapOf({ kind: 'dev' }))).toBe(false);
    for (const kind of ['architecture', 'dataflow', 'behavior-tree', 'sequence'] as const) {
      expect(isNeutralKind(mapOf({ kind }))).toBe(true);
    }
  });
});

describe('aggregateMap — the far view', () => {
  /**
   * base holds group `core` (two nodes) and a loner; top holds group `shell`.
   * Every wire that could collapse is present: group -> group, group -> loner,
   * a duplicate of the first, and one wire inside a group.
   */
  function grouped(): MellosMap {
    return mapOf({
      title: 'demo',
      layers: [layer('base', 'Base', 0), layer('top', 'Top', 1)],
      groups: [group('core', '内核', 'base'), group('shell', '外壳', 'top')],
      nodes: [
        node('a', 'A', 'base', { group: 'core' as GroupId, status: 'done' }),
        node('b', 'B', 'base', { group: 'core' as GroupId }),
        node('loner', 'Loner', 'base'),
        node('s1', 'S1', 'top', { group: 'shell' as GroupId }),
        node('s2', 'S2', 'top', { group: 'shell' as GroupId }),
      ],
      edges: [edge('s1', 'a'), edge('s2', 'b'), edge('s1', 'loner'), edge('b', 'a')],
    });
  }

  it('returns undefined for a map without groups — there is nothing to aggregate', () => {
    expect(aggregateMap(mapOf({ nodes: [node('a', 'A', 'base')] }))).toBeUndefined();
  });

  it('turns each group into one box carrying done/total, and leaves loners as themselves', () => {
    const far = aggregateMap(grouped())!;
    expect(far.nodes.find((n) => (n.id as string) === 'core')?.label).toBe('内核 1/2');
    expect(far.nodes.find((n) => (n.id as string) === 'shell')?.label).toBe('外壳 0/2');
    expect(far.nodes.find((n) => (n.id as string) === 'loner')?.label).toBe('Loner');
    expect(far.groups).toEqual([]); // the groups BECAME the nodes
    expect(far.title).toBe('demo');
  });

  it('never counts progress on a documentation diagram', () => {
    const far = aggregateMap({ ...grouped(), kind: 'architecture' })!;
    expect(far.nodes.find((n) => (n.id as string) === 'core')?.label).toBe('内核');
  });

  it('derives each box status from its members: regression trumps activity trumps completion', () => {
    const status = (members: readonly MapNode[]): string =>
      aggregateMap(
        mapOf({
          layers: [layer('base', 'Base', 0)],
          groups: [group('g', 'G', 'base')],
          nodes: members,
        }),
      )!.nodes[0]!.status;
    const member = (id: string, s: MapNode['status']): MapNode =>
      node(id, id, 'base', { group: 'g' as GroupId, status: s });

    expect(status([member('x', 'done'), member('y', 'regressed')])).toBe('regressed');
    expect(status([member('x', 'done'), member('y', 'in-progress')])).toBe('in-progress');
    expect(status([member('x', 'done'), member('y', 'done')])).toBe('done');
    expect(status([member('x', 'done'), member('y', 'planned')])).toBe('planned');
    expect(status([])).toBe('planned'); // an empty group is not a finished one
  });

  it('collapses edges onto representatives, dedupes them, and drops the wiring inside a box', () => {
    const far = aggregateMap(grouped())!;
    const wires = far.edges.map((e) => `${e.from as string}->${e.to as string}`);
    expect(wires).toEqual(['shell->core', 'shell->loner']); // s1->a and s2->b are one wire; b->a is gone
  });

  it('keeps ids unique, because nodes and groups share one namespace (I10)', () => {
    const far = aggregateMap(grouped())!;
    const ids = far.nodes.map((n) => n.id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('focusInfo — what a detail panel knows', () => {
  function map(): MellosMap {
    return mapOf({
      layers: [layer('base', 'Base', 0), layer('top', 'Top', 1)],
      groups: [group('core', '内核', 'base')],
      lanes: [lane('client', '客户端')],
      nodes: [
        node('a', 'A', 'base', { group: 'core' as GroupId, status: 'done' }),
        node('b', 'B', 'base', { group: 'core' as GroupId }),
        node('helper', 'Helper', 'base'),
        node('top1', 'Top one', 'top', { lane: 'client' as LaneId }),
        node('top2', 'Top two', 'top'),
      ],
      edges: [edge('top1', 'a', 'reads'), edge('top1', 'helper'), edge('top2', 'a'), edge('a', 'helper', 'calls')],
    });
  }

  it('answers undefined for an id that names nothing', () => {
    expect(focusInfo(map(), 'nobody')).toBeUndefined();
  });

  it('reports a node with its band, its lane and both directions of every edge it touches', () => {
    const focus = focusInfo(map(), 'top1');
    expect(focus?.kind).toBe('node');
    if (focus?.kind !== 'node') throw new Error('expected a node focus');
    expect(focus.layerName).toBe('Top');
    expect(focus.laneLabel).toBe('客户端');
    expect(focus.uses).toEqual([
      { id: 'a', label: 'A', status: 'done', edgeLabel: 'reads' },
      { id: 'helper', label: 'Helper', status: 'planned' },
    ]);
    expect(focus.usedBy).toEqual([]);
  });

  it('reads the other direction too, and leaves the edge label off when there is none', () => {
    const focus = focusInfo(map(), 'helper');
    if (focus?.kind !== 'node') throw new Error('expected a node focus');
    expect(focus.uses).toEqual([]);
    expect(focus.usedBy).toEqual([
      { id: 'top1', label: 'Top one', status: 'planned' },
      { id: 'a', label: 'A', status: 'done', edgeLabel: 'calls' },
    ]);
    expect(focus.node.lane).toBeUndefined();
  });

  it('reports a group with its members, its derived status and its OUTSIDE neighbours only', () => {
    const focus = focusInfo(map(), 'core');
    expect(focus?.kind).toBe('group');
    if (focus?.kind !== 'group') throw new Error('expected a group focus');
    expect(focus.layerName).toBe('Base');
    expect(focus.status).toBe('planned'); // one done, one planned
    expect(focus.members.map((n) => n.id as string)).toEqual(['a', 'b']);
    expect(focus.uses).toEqual([{ id: 'helper', label: 'Helper', status: 'planned' }]);
    // top1 and top2 both reach into the group: one neighbour, not two
    expect(focus.usedBy.map((r) => r.id)).toEqual(['top1', 'top2']);
  });

  it('shows a neighbour as its own group when it has one', () => {
    const withTwoGroups = mapOf({
      layers: [layer('base', 'Base', 0), layer('top', 'Top', 1)],
      groups: [group('core', '内核', 'base'), group('shell', '外壳', 'top')],
      nodes: [
        node('a', 'A', 'base', { group: 'core' as GroupId }),
        node('s1', 'S1', 'top', { group: 'shell' as GroupId }),
        node('s2', 'S2', 'top', { group: 'shell' as GroupId, status: 'regressed' }),
      ],
      edges: [edge('s1', 'a'), edge('s2', 'a')],
    });
    const focus = focusInfo(withTwoGroups, 'core');
    if (focus?.kind !== 'group') throw new Error('expected a group focus');
    // two member-to-member wires, one neighbour box, and its status is derived
    expect(focus.usedBy).toEqual([{ id: 'shell', label: '外壳', status: 'regressed' }]);
  });
});

describe('page-set semantics', () => {
  /** A page whose nodes dive into `targets`. */
  const diving = (...targets: string[]): MellosMap =>
    mapOf({
      layers: [layer('base', 'Base', 0)],
      nodes: targets.map((t, i) => node(`n${i}`, `To ${t}`, 'base', { submap: t as SubmapRef })),
    });

  it('submapRefs collects the raw fact: every slug some node dives into', () => {
    expect(submapRefs([diving('child'), undefined, diving('child', 'other')])).toEqual(new Set(['child', 'other']));
    expect(submapRefs([])).toEqual(new Set());
  });

  it('hides a page that a sibling dives into', () => {
    const interior = interiorPages([
      [undefined, diving('child')],
      ['child', diving()],
      ['sibling', diving()],
    ]);
    expect(interior).toEqual(new Set(['child']));
  });

  it('never hides a page from itself — a self-dive is a loop, not a parent link', () => {
    // The regression: `alpha` linking `alpha` used to delete alpha's own tab.
    expect(interiorPages([['alpha', diving('alpha')]])).toEqual(new Set());
  });

  it('keeps every page of a link cycle visible — a cycle has no outside', () => {
    expect(
      interiorPages([
        ['alpha', diving('beta')],
        ['beta', diving('alpha')],
      ]),
    ).toEqual(new Set());
    expect(
      interiorPages([
        ['alpha', diving('beta')],
        ['beta', diving('gamma')],
        ['gamma', diving('alpha')],
      ]),
    ).toEqual(new Set());
  });

  it('still hides a cycle member that something outside the cycle dives into', () => {
    const interior = interiorPages([
      [undefined, diving('alpha')],
      ['alpha', diving('beta')],
      ['beta', diving('alpha')],
    ]);
    expect(interior.has('alpha')).toBe(true);
    expect(interior.has('beta')).toBe(false); // reachable only from alpha, which alpha reaches back
  });

  it('ignores pages with no map, and tolerates a link to a page that does not exist yet', () => {
    expect(interiorPages([['alpha', undefined]])).toEqual(new Set());
    expect(interiorPages([['alpha', diving('unwritten')]])).toEqual(new Set(['unwritten']));
  });

  it('diveParent names the entry that links a page, and the node that links it', () => {
    const entries = [
      ['parent.json', diving('child')],
      ['child.json', diving()],
    ] as const;
    expect(diveParent(entries, 'child')).toEqual({ parent: 'parent.json', label: 'To child' });
    expect(diveParent(entries, 'parent')).toBeUndefined();
    expect(diveParent([], 'child')).toBeUndefined();
  });
});

describe('mostRecentKey — the page a client opens when nobody asked', () => {
  it('answers the most recently written key', () => {
    const at: Record<string, number> = { a: 10, b: 30, c: 20 };
    expect(mostRecentKey(['a', 'b', 'c'], (k) => at[k])).toBe('b');
  });

  it('breaks a tie for the FIRST key, which is the caller-ordered fallback', () => {
    expect(mostRecentKey(['a', 'b'], () => 7)).toBe('a');
  });

  it('lets keys with no readable timestamp lose, and falls back to the first when none has one', () => {
    const at: Record<string, number | undefined> = { a: undefined, b: 5 };
    expect(mostRecentKey(['a', 'b'], (k) => at[k])).toBe('b');
    expect(mostRecentKey(['a', 'b'], () => undefined)).toBe('a');
  });

  it('answers undefined for an empty candidate set', () => {
    expect(mostRecentKey([], () => 1)).toBeUndefined();
  });
});

describe('flipForSequence — time drawn downward', () => {
  const sequence = mapOf({
    kind: 'sequence',
    layers: [layer('t0', 'Step 1', 0), layer('t1', 'Step 2', 1)],
    nodes: [node('call', 'Call', 't0'), node('reply', 'Reply', 't1')],
    edges: [edge('reply', 'call', 'result')],
  });

  it('mirrors the ranks and reverses the wires, so unchanged top-down machinery draws time downward', () => {
    const flipped = flipForSequence(sequence);
    // rank 0 mirrors to -0, which orders exactly like 0 — the mirrored rank
    // is an ORDER for a renderer, never a value anyone stores
    expect(flipped.layers.map((l, i) => l.rank === -sequence.layers[i]!.rank)).toEqual([true, true]);
    expect(flipped.layers[1]!.rank).toBe(-1);
    expect(flipped.edges).toEqual([{ from: 'call', to: 'reply', label: 'result' }]);
    expect(flipped.nodes).toEqual(sequence.nodes); // nodes keep their bands
  });

  it('leaves every other kind exactly as it is — the same value, not a copy', () => {
    const dev = mapOf({ layers: sequence.layers, nodes: sequence.nodes, edges: sequence.edges });
    expect(flipForSequence(dev)).toBe(dev);
    const architecture: MellosMap = { ...dev, kind: 'architecture' };
    expect(flipForSequence(architecture)).toBe(architecture);
  });
});

describe('the shared glyph vocabulary', () => {
  it('gives every status one unicode and one ascii glyph', () => {
    expect(Object.keys(STATUS_GLYPHS).sort()).toEqual(['done', 'in-progress', 'planned', 'regressed']);
    expect(statusGlyph('done', true)).toBe('■');
    expect(statusGlyph('done', false)).toBe('#');
    for (const [uni, ascii] of Object.values(STATUS_GLYPHS)) {
      expect([...uni]).toHaveLength(1);
      expect([...ascii]).toHaveLength(1);
    }
  });

  it('wraps the spinner over any frame number, negatives included, so no caller normalizes a clock', () => {
    const frames = SPINNER_FRAMES.unicode;
    expect(spinnerGlyph(0, true)).toBe(frames[0]);
    expect(spinnerGlyph(frames.length, true)).toBe(frames[0]);
    expect(spinnerGlyph(-1, true)).toBe(frames[frames.length - 1]);
    expect(spinnerGlyph(1, false)).toBe(SPINNER_FRAMES.ascii[1]);
  });

  it('answers a glyph for a known node kind and undefined for the open vocabulary', () => {
    expect(kindGlyph('db', true)).toBe(NODE_KIND_GLYPHS['db']![0]);
    expect(kindGlyph('db', false)).toBe(NODE_KIND_GLYPHS['db']![1]);
    expect(kindGlyph('whatever-the-model-invented', true)).toBeUndefined();
  });
});
