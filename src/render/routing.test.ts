/**
 * Spec for the routing stage.
 *
 * The pictures in render.test.ts show what routing produces; this pins the
 * DECISIONS behind them as values — which edge is straight, which bends,
 * which threads a column between boxes, and how many track rows a band gap
 * therefore needs. They used to be visible only as glyphs.
 */

import { describe, expect, it } from 'vitest';

import { declareLayer, declareNode, linkNodes } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Rank, type Result } from '../domain/types.js';
import { layoutColumns } from './layout.js';
import { routeEdges } from './routing.js';
import { zoomGeometry } from './zoom-geometry.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;
const rnk = (n: number): Rank => n as Rank;

const GEO = zoomGeometry(0);
const route = (map: MellosMap) => routeEdges(map, layoutColumns(map, GEO, true, false));

/** Three bands: two wide siblings on top of one foundation, plus a skip edge. */
function tower(): MellosMap {
  let map = EMPTY_MAP;
  map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: rnk(0) }));
  map = must(declareLayer(map, { id: lid('mid'), name: 'Mid', rank: rnk(1) }));
  map = must(declareLayer(map, { id: lid('top'), name: 'Top', rank: rnk(2) }));
  // wide enough for both siblings above to share a column with it
  map = must(declareNode(map, { id: nid('core'), label: 'CoreFoundationCarryingEverything', layer: lid('base') }));
  map = must(declareNode(map, { id: nid('left'), label: 'LeftService', layer: lid('mid') }));
  map = must(declareNode(map, { id: nid('right'), label: 'RightService', layer: lid('mid') }));
  map = must(declareNode(map, { id: nid('app'), label: 'App', layer: lid('top') }));
  map = must(linkNodes(map, nid('left'), nid('core'))); // overlapping columns: straight
  map = must(linkNodes(map, nid('right'), nid('core'))); // still overlapping: straight
  map = must(linkNodes(map, nid('app'), nid('right'))); // no overlap: dogleg
  map = must(linkNodes(map, nid('app'), nid('core'))); // two bands down: thread
  return map;
}

describe('routing decisions', () => {
  it('prefers a straight drop, bends only when the borders do not overlap', () => {
    const kinds = route(tower()).edges.map((e) => e.kind);
    expect(kinds).toEqual(['straight', 'straight', 'dogleg', 'thread']);
  });

  it('gives every wire in one gap its own column', () => {
    const { edges } = route(tower());
    const verticalsIn = (gap: number): number[] =>
      edges.flatMap((e) => {
        const columns: number[] = [];
        if (e.kind === 'straight') return e.fromBand === gap ? [e.x] : [];
        if (e.fromBand === gap) columns.push(e.exitX);
        if (e.toBand - 1 === gap) columns.push(e.entryX);
        if (e.kind === 'thread' && gap >= e.fromBand && gap <= e.toBand - 1) columns.push(e.descentX);
        return columns;
      });
    for (const gap of [0, 1]) {
      const columns = verticalsIn(gap);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  it('threads a skip edge between the boxes rather than out to the margin', () => {
    const routing = route(tower());
    expect(routing.fallbackCount).toBe(0);
    const thread = routing.edges.find((e) => e.kind === 'thread')!;
    expect(thread.kind === 'thread' && thread.descentX).toBeGreaterThan(0);
  });

  it('asks for one track row per gap when the segments do not overlap', () => {
    const routing = route(tower());
    expect(routing.gapRowCount).toHaveLength(2); // three bands, two gaps
    for (const rows of routing.gapRowCount) expect(rows).toBeGreaterThan(0);
  });

  it('needs no track rows at all when every edge is straight', () => {
    let map = EMPTY_MAP;
    map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: rnk(0) }));
    map = must(declareLayer(map, { id: lid('top'), name: 'Top', rank: rnk(1) }));
    map = must(declareNode(map, { id: nid('core'), label: 'CoreModule', layer: lid('base') }));
    map = must(declareNode(map, { id: nid('shell'), label: 'Shell', layer: lid('top') }));
    map = must(linkNodes(map, nid('shell'), nid('core')));
    expect(route(map).gapRowCount).toEqual([0]);
  });
});
