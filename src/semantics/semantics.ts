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
import type { DepEdge, MapGroup, MapNode, MellosMap, NodeId, NodeStatus } from '../domain/types.js';

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

// ---------------------------------------------------------------------------
// focus semantics — what a detail panel says about a node or group
// ---------------------------------------------------------------------------

/** One neighbour across a dependency edge, with what flows along it. */
export interface NeighborRef {
  readonly id: string;
  readonly label: string;
  readonly status: NodeStatus;
  readonly edgeLabel?: string;
}

/** Everything a detail panel derives for a focused NODE. */
export interface NodeFocus {
  readonly kind: 'node';
  readonly node: MapNode;
  readonly layerName: string;
  readonly laneLabel?: string;
  /** Lower neighbours this node stands on (on sequence pages: the earlier events). */
  readonly uses: readonly NeighborRef[];
  /** Upper neighbours standing on this node (on sequence pages: the later events). */
  readonly usedBy: readonly NeighborRef[];
}

/** Everything a detail panel derives for a focused GROUP (the far zoom's boxes). */
export interface GroupFocus {
  readonly kind: 'group';
  readonly group: MapGroup;
  readonly status: NodeStatus;
  readonly layerName: string;
  readonly members: readonly MapNode[];
  /** Outside-the-group lower neighbours, each shown as its own group when it has one. */
  readonly uses: readonly NeighborRef[];
  /** Outside-the-group upper neighbours, each shown as its own group when it has one. */
  readonly usedBy: readonly NeighborRef[];
}

/**
 * Derive what a detail panel says about one focused id — a node, or a group
 * when the far zoom's aggregated boxes are what the pointer is over. Pure
 * data: every renderer picks its own glyphs, colors, and words (a sequence
 * page reads uses/usedBy as after/before; that is the caller's vocabulary).
 * @param map - the map the focus lives in.
 * @param focusId - node or group id.
 * @returns the focus view, or undefined when the id names neither.
 */
export function focusInfo(map: MellosMap, focusId: string): NodeFocus | GroupFocus | undefined {
  const layerNameOf = (layerId: string): string =>
    map.layers.find((l) => (l.id as string) === layerId)?.name ?? layerId;

  const group = map.groups.find((g) => (g.id as string) === focusId);
  if (group) {
    const members = map.nodes.filter((n) => n.group === group.id);
    const memberIds = new Set(members.map((n) => n.id as string));
    // A neighbour is shown as its own group when it has one, else as itself.
    const rep = (id: string): NeighborRef => {
      const n = map.nodes.find((x) => (x.id as string) === id)!;
      const owner = n.group !== undefined ? map.groups.find((g) => g.id === n.group) : undefined;
      return owner !== undefined
        ? { id: owner.id as string, label: owner.label, status: groupStatus(map, owner.id) }
        : { id: n.id as string, label: n.label, status: n.status };
    };
    const dedupe = (refs: NeighborRef[]): NeighborRef[] => {
      const seen = new Set<string>();
      const out: NeighborRef[] = [];
      for (const r of refs) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      return out;
    };
    return {
      kind: 'group',
      group,
      status: groupStatus(map, group.id),
      layerName: layerNameOf(group.layer as string),
      members,
      uses: dedupe(
        map.edges
          .filter((e) => memberIds.has(e.from as string) && !memberIds.has(e.to as string))
          .map((e) => rep(e.to as string)),
      ),
      usedBy: dedupe(
        map.edges
          .filter((e) => memberIds.has(e.to as string) && !memberIds.has(e.from as string))
          .map((e) => rep(e.from as string)),
      ),
    };
  }

  const node = map.nodes.find((n) => (n.id as string) === focusId);
  if (!node) return undefined;
  const ref = (id: string, edgeLabel: string | undefined): NeighborRef => {
    const n = map.nodes.find((x) => (x.id as string) === id);
    return {
      id,
      label: n?.label ?? id,
      status: n?.status ?? 'planned',
      ...(edgeLabel !== undefined ? { edgeLabel } : {}),
    };
  };
  const laneLabel = node.lane !== undefined ? map.lanes.find((l) => l.id === node.lane)?.label : undefined;
  return {
    kind: 'node',
    node,
    layerName: layerNameOf(node.layer as string),
    ...(laneLabel !== undefined ? { laneLabel } : {}),
    uses: map.edges.filter((e) => e.from === node.id).map((e) => ref(e.to as string, e.label)),
    usedBy: map.edges.filter((e) => e.to === node.id).map((e) => ref(e.from as string, e.label)),
  };
}

// ---------------------------------------------------------------------------
// page-set semantics — which pages are siblings, and where a dive came from
// ---------------------------------------------------------------------------

/**
 * Page slugs some node of any map dives into. A page referenced as a submap
 * is interior detail — it is reached by diving through its linking node,
 * never by sitting beside its parent as a sibling tab.
 * @param maps - every known page's map (undefined entries are skipped).
 * @returns the referenced submap slugs.
 */
export function submapRefs(maps: Iterable<MellosMap | undefined>): Set<string> {
  const refs = new Set<string>();
  for (const m of maps) {
    for (const n of m?.nodes ?? []) if (n.submap !== undefined) refs.add(n.submap as string);
  }
  return refs;
}

/**
 * Where a sub-map page was dived into from: the entry whose map links the
 * page, plus the linking node's label. Derived by scan, so a breadcrumb
 * survives any client restart with an empty dive stack.
 * @param entries - known pages as (key, map) pairs; keys are caller-owned.
 * @param pageId - the sub-map page's slug.
 * @returns the linking entry's key and node label, or undefined for a top-level page.
 */
export function diveParent<K>(
  entries: Iterable<readonly [K, MellosMap | undefined]>,
  pageId: string,
): { parent: K; label: string } | undefined {
  for (const [key, m] of entries) {
    const node = m?.nodes.find((n) => (n.submap as string | undefined) === pageId);
    if (node !== undefined) return { parent: key, label: node.label };
  }
  return undefined;
}

/**
 * The page a client shows when nobody asked for one: the most recently
 * WRITTEN page — the ledger last touched is almost always the effort under
 * way. Keys without a readable timestamp lose; an empty set answers the
 * first key (caller-ordered: default page first, then slug order).
 * @param keys - candidate page keys in the caller's fallback order.
 * @param mtimeOf - last-written timestamp of a key, undefined when unknown.
 * @returns the winning key, or undefined for an empty candidate set.
 */
export function mostRecentKey<K>(keys: readonly K[], mtimeOf: (key: K) => number | undefined): K | undefined {
  let best: K | undefined;
  let bestMtime = -Infinity;
  for (const key of keys) {
    const mtime = mtimeOf(key);
    if (mtime !== undefined && mtime > bestMtime) {
      best = key;
      bestMtime = mtime;
    }
  }
  return best ?? keys[0];
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
