/**
 * Layer 1c — medium-neutral VIEW SEMANTICS of a MellosMap.
 *
 * Every renderer (the terminal pane, a web panel, a future editor view) must
 * agree on what a zoom step MEANS, when a map aggregates into its groups,
 * how sequence time is oriented, and which map kinds render neutrally.
 * Those rules live here, pure of any medium: no cells, no glyphs, no DOM,
 * no I/O. Geometry — how a mode maps onto character cells or pixels — stays
 * private to each renderer.
 */

import { groupStatus } from '../domain/ops.js';
import type { DepEdge, MapNode, MellosMap, NodeId } from '../domain/types.js';

// ---------------------------------------------------------------------------
// zoom ladder
// ---------------------------------------------------------------------------

/** One wheel tick on the zoom ladder. */
export type ZoomStep = -4 | -3 | -2 | -1 | 0 | 1 | 2;

export const ZOOM_MIN: ZoomStep = -4;
export const ZOOM_MAX: ZoomStep = 2;
export const ZOOM_DEFAULT: ZoomStep = 0;

export function clampZoom(n: number): ZoomStep {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n))) as ZoomStep;
}

/**
 * What a zoom step MEANS, before any renderer decides what it looks like:
 * scaling only compresses, the ends of the ladder switch mode. 'detail'
 * unfolds evidence and design notes; 'overview' switches to the aggregated
 * far view (groups become the nodes — see aggregateMap); 'boxes' is every
 * step in between, where boxes stay boxes and only whitespace and label
 * budgets change.
 */
export function zoomMode(zoom: ZoomStep): 'detail' | 'boxes' | 'overview' {
  if (zoom >= 1) return 'detail';
  if (zoom <= -4) return 'overview';
  return 'boxes';
}

/** What a footer shows: a percentage while scaling, a mode name at the ends. */
export function zoomLabel(zoom: ZoomStep): string {
  switch (zoom) {
    case 2:
      return 'detail+';
    case 1:
      return 'detail';
    case 0:
      return '100%';
    case -1:
      return '85%';
    case -2:
      return '70%';
    case -3:
      return '55%';
    case -4:
      return 'overview';
  }
}

// ---------------------------------------------------------------------------
// kind semantics
// ---------------------------------------------------------------------------

/** Documentation kinds render neutrally: no status skins, no progress counts. */
export function isNeutralKind(map: MellosMap): boolean {
  return map.kind !== undefined && map.kind !== 'dev';
}

// ---------------------------------------------------------------------------
// derived views (never persisted)
// ---------------------------------------------------------------------------

/**
 * The derived coarse picture the far zoom renders when the map declares
 * groups: each group becomes ONE labeled node (status derived from members,
 * label carrying done/total), ungrouped nodes stay themselves, and edges
 * collapse onto representatives (intra-group wiring disappears into the
 * box). Derived for rendering only — never persisted. A map without groups
 * returns undefined and falls back to whatever anonymous overview the
 * renderer draws.
 */
export function aggregateMap(map: MellosMap): MellosMap | undefined {
  if (map.groups.length === 0) return undefined;
  // Group ids join the node-id slug space inside this derived value; the
  // brands only guard PERSISTED maps, and this one never leaves rendering.
  const representative = new Map<string, string>();
  for (const n of map.nodes) representative.set(n.id as string, (n.group ?? n.id) as string);

  const nodes: MapNode[] = map.groups.map((g) => {
    const members = map.nodes.filter((n) => n.group === g.id);
    const done = members.filter((n) => n.status === 'done').length;
    return {
      id: g.id as unknown as NodeId,
      // neutral kinds document structure, not progress — no member counts
      label: isNeutralKind(map) ? g.label : `${g.label} ${done}/${members.length}`,
      layer: g.layer,
      status: groupStatus(map, g.id),
    };
  });
  for (const n of map.nodes) if (n.group === undefined) nodes.push(n);

  const seen = new Set<string>();
  const edges: DepEdge[] = [];
  for (const e of map.edges) {
    const from = representative.get(e.from as string)!;
    const to = representative.get(e.to as string)!;
    if (from === to || seen.has(`${from}->${to}`)) continue;
    seen.add(`${from}->${to}`);
    edges.push({ from: from as NodeId, to: to as NodeId });
  }
  return {
    ...(map.title !== undefined ? { title: map.title } : {}),
    ...(map.kind !== undefined ? { kind: map.kind } : {}),
    layers: map.layers,
    groups: [],
    lanes: map.lanes,
    nodes,
    edges,
  };
}

/**
 * Sequence pages read like the classic diagram: time flows DOWNWARD, the
 * earliest step right under the participant headers. The stored map keeps
 * rank 0 = earliest with edges pointing later -> earlier ("later stands on
 * earlier"); this derived value inverts the ranks and reverses the edges so
 * unchanged top-down machinery draws top-down time — each wire now runs
 * from the sender's moment down into the receiver's. Derived for rendering
 * only, never persisted (same contract as aggregateMap).
 */
export function flipForSequence(map: MellosMap): MellosMap {
  if (map.kind !== 'sequence') return map;
  return {
    ...map,
    layers: map.layers.map((l) => ({ ...l, rank: -l.rank })),
    edges: map.edges.map((e) => ({ from: e.to, to: e.from, ...(e.label !== undefined ? { label: e.label } : {}) })),
  };
}
