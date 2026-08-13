/**
 * Layer 0 — pure operations on a MellosMap.
 *
 * Every operation follows validate -> prepare -> commit: all refusals happen
 * before any new value is built, and the commit expression can no longer
 * fail. Inputs are never mutated; the result always carries a fresh map.
 *
 * These functions enforce the structural invariants I1-I9 documented in
 * types.ts and nothing else. In particular there are no workflow rules here:
 * any status may be set at any time, in any order. Discipline lives with the
 * caller; this layer only keeps the map structurally true.
 */

import {
  type GroupId,
  type LaneId,
  type LayerId,
  type MapError,
  type MapGroup,
  type MapKind,
  type MapLane,
  type MapLayer,
  type MapNode,
  type MellosMap,
  type NodeId,
  type NodeKind,
  type NodeStatus,
  type Result,
  type SubmapRef,
  type WorkSpan,
  err,
  ok,
} from './types.js';

function findLayer(map: MellosMap, id: LayerId): MapLayer | undefined {
  return map.layers.find((l) => l.id === id);
}

function findNode(map: MellosMap, id: NodeId): MapNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

function findGroup(map: MellosMap, id: GroupId): MapGroup | undefined {
  return map.groups.find((g) => g.id === id);
}

/** Validate that `node` may join `group` (I7): the group exists on the node's own band. */
function checkMembership(map: MellosMap, node: NodeId, nodeLayer: LayerId, group: GroupId): MapError | undefined {
  const g = findGroup(map, group);
  if (!g) return { kind: 'unknown-group', id: group };
  if (g.layer !== nodeLayer)
    return { kind: 'group-layer-mismatch', node, nodeLayer, group, groupLayer: g.layer };
  return undefined;
}

function hasEdge(map: MellosMap, from: NodeId, to: NodeId): boolean {
  return map.edges.some((e) => e.from === from && e.to === to);
}

/** Set or replace the map title. */
export function setTitle(map: MellosMap, title: string): MellosMap {
  return { ...map, title };
}

/** Set or replace the map kind (presentation intent — never structural). */
export function setKind(map: MellosMap, kind: MapKind): MellosMap {
  return { ...map, kind };
}

function findLane(map: MellosMap, id: LaneId): MapLane | undefined {
  return map.lanes.find((l) => l.id === id);
}

export interface DeclareLaneInput {
  readonly id: LaneId;
  readonly label: string;
}

/** Add a new lane (I8). Declaration order is left-to-right render order. */
export function declareLane(map: MellosMap, input: DeclareLaneInput): Result<MellosMap, MapError> {
  if (findLane(map, input.id)) return err({ kind: 'duplicate-lane', id: input.id });
  return ok({ ...map, lanes: [...map.lanes, { id: input.id, label: input.label }] });
}

/**
 * Remove a lane.
 * Postcondition: former members stay on the map, merely off-lane — removing
 * a column label never destroys work records (same contract as removeGroup).
 */
export function removeLane(map: MellosMap, id: LaneId): Result<MellosMap, MapError> {
  if (!findLane(map, id)) return err({ kind: 'unknown-lane', id });
  return ok({
    ...map,
    lanes: map.lanes.filter((l) => l.id !== id),
    nodes: map.nodes.map((n) => {
      if (n.lane !== id) return n;
      const { lane: _dropped, ...rest } = n;
      return rest;
    }),
  });
}

export interface DeclareLayerInput {
  readonly id: LayerId;
  readonly name: string;
  readonly rank: number;
}

/** Add a new band. Refuses duplicate ids and duplicate ranks (I1). */
export function declareLayer(map: MellosMap, input: DeclareLayerInput): Result<MellosMap, MapError> {
  if (findLayer(map, input.id)) return err({ kind: 'duplicate-layer', id: input.id });
  const rankHolder = map.layers.find((l) => l.rank === input.rank);
  if (rankHolder) return err({ kind: 'duplicate-rank', rank: input.rank, existing: rankHolder.id });

  return ok({ ...map, layers: [...map.layers, { id: input.id, name: input.name, rank: input.rank }] });
}

export interface DeclareGroupInput {
  readonly id: GroupId;
  readonly label: string;
  readonly layer: LayerId;
}

/** Add a new group to an existing band (I6). */
export function declareGroup(map: MellosMap, input: DeclareGroupInput): Result<MellosMap, MapError> {
  if (findGroup(map, input.id)) return err({ kind: 'duplicate-group', id: input.id });
  if (!findLayer(map, input.layer)) return err({ kind: 'unknown-layer', id: input.layer });
  return ok({ ...map, groups: [...map.groups, { id: input.id, label: input.label, layer: input.layer }] });
}

/** Rename a group. */
export function updateGroup(map: MellosMap, id: GroupId, label: string): Result<MellosMap, MapError> {
  if (!findGroup(map, id)) return err({ kind: 'unknown-group', id });
  return ok({ ...map, groups: map.groups.map((g) => (g.id === id ? { ...g, label } : g)) });
}

/**
 * Remove a group.
 * Postcondition: former members stay on the map, merely ungrouped — removing
 * a cluster label never destroys work records.
 */
export function removeGroup(map: MellosMap, id: GroupId): Result<MellosMap, MapError> {
  if (!findGroup(map, id)) return err({ kind: 'unknown-group', id });
  return ok({
    ...map,
    groups: map.groups.filter((g) => g.id !== id),
    nodes: map.nodes.map((n) => {
      if (n.group !== id) return n;
      const { group: _dropped, ...rest } = n;
      return rest;
    }),
  });
}

/** Aggregate status over a set of nodes: regression trumps, then activity, then completion. */
function aggregateStatus(nodes: readonly MapNode[]): NodeStatus {
  if (nodes.some((n) => n.status === 'regressed')) return 'regressed';
  if (nodes.some((n) => n.status === 'in-progress')) return 'in-progress';
  if (nodes.length > 0 && nodes.every((n) => n.status === 'done')) return 'done';
  return 'planned';
}

/**
 * Derived, never stored: a group's aggregate status. Any regressed member
 * cracks the group; else any spinner spins it; else all-done (non-empty)
 * completes it; anything else is planned.
 */
export function groupStatus(map: MellosMap, id: GroupId): NodeStatus {
  return aggregateStatus(map.nodes.filter((n) => n.group === id));
}

/** Derived, never stored: the whole map's aggregate status (same rules as groupStatus). */
export function mapStatus(map: MellosMap): NodeStatus {
  return aggregateStatus(map.nodes);
}

/**
 * How long a single OPEN span is allowed to accrue. A node left spinning
 * because a session ended would otherwise bill the whole night to the map, and
 * `14h` on the dashboard is worse than useless — it drowns every honest number
 * beside it. Closed spans are never capped: they carry two real stamps.
 *
 * The cap makes a capped total a FLOOR, not a measurement, so every surface
 * that shows one marks it (a trailing `+`). Deliberately crude — better a
 * plainly-labelled lower bound than a precise-looking lie.
 */
export const IDLE_CAP_MS = 30 * 60_000;

/**
 * Measure of the UNION of `spans` — the wall-clock time during which at least
 * one of them was running. Overlap is counted ONCE, which is the whole point:
 * two nodes worked on in parallel cost one stretch of calendar, not two.
 *
 * Open spans run up to `now` (this layer has no clock, so the caller supplies
 * it) or `idleCap` past their start, whichever comes first. A total function:
 * any order, any overlap, any nesting, and a `to` that precedes its `from` (a
 * clock that went backwards) all yield a non-negative answer, never a refusal.
 */
export function spanTotal(spans: readonly WorkSpan[], now: number, idleCap: number = IDLE_CAP_MS): number {
  const closed = spans
    .map((s) => ({
      from: s.from,
      to: Math.max(s.from, s.to ?? Math.min(now, s.from + idleCap)),
    }))
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let covered = -Infinity; // right edge of everything merged so far
  for (const s of closed) {
    const start = Math.max(s.from, covered);
    if (s.to > start) total += s.to - start;
    covered = Math.max(covered, s.to);
  }
  return total;
}

/**
 * Derived, never stored: calendar time a set of nodes has cost. Parallel work
 * collapses, so this is what a stopwatch on the wall would have read.
 * One node, a group's members, a band, the whole map — same call.
 */
export function elapsedOf(nodes: readonly MapNode[], now: number, idleCap: number = IDLE_CAP_MS): number {
  return spanTotal(
    nodes.flatMap((n) => n.spans ?? []),
    now,
    idleCap,
  );
}

/**
 * Whether any of these nodes is still spinning past the idle cap — i.e. the
 * duration beside it stopped being a measurement and became a lower bound.
 * Surfaces use this to append `+`; nothing about the stored data changes.
 */
export function isStalled(nodes: readonly MapNode[], now: number, idleCap: number = IDLE_CAP_MS): boolean {
  return nodes.some((n) => (n.spans ?? []).some((s) => s.to === undefined && now - s.from > idleCap));
}

/**
 * Derived, never stored: attention spent — every node's own elapsed, added up.
 * Exceeds elapsedOf by exactly the overlap, so effort / elapsed is the average
 * number of nodes in flight. Report the two together or the pair reads as a
 * bug; alone, either number misleads.
 */
export function effortOf(nodes: readonly MapNode[], now: number, idleCap: number = IDLE_CAP_MS): number {
  return nodes.reduce((sum, n) => sum + elapsedOf([n], now, idleCap), 0);
}

export interface DeclareNodeInput {
  readonly id: NodeId;
  readonly label: string;
  readonly layer: LayerId;
  readonly status?: NodeStatus;
  readonly detail?: string;
  readonly group?: GroupId;
  readonly kind?: NodeKind;
  readonly lane?: LaneId;
  readonly submap?: SubmapRef;
  /** Restored verbatim (the store replays a saved node); no clock is consulted. */
  readonly spans?: readonly WorkSpan[];
}

/**
 * Add a new node to an existing band (I2, I3), optionally joining a same-band
 * group (I7) and/or an existing lane (I9).
 */
export function declareNode(map: MellosMap, input: DeclareNodeInput): Result<MellosMap, MapError> {
  if (findNode(map, input.id)) return err({ kind: 'duplicate-node', id: input.id });
  if (!findLayer(map, input.layer)) return err({ kind: 'unknown-layer', id: input.layer });
  if (input.group !== undefined) {
    const bad = checkMembership(map, input.id, input.layer, input.group);
    if (bad) return err(bad);
  }
  if (input.lane !== undefined && !findLane(map, input.lane)) return err({ kind: 'unknown-lane', id: input.lane });

  const node: MapNode = {
    id: input.id,
    label: input.label,
    layer: input.layer,
    status: input.status ?? 'planned',
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.lane !== undefined ? { lane: input.lane } : {}),
    ...(input.submap !== undefined ? { submap: input.submap } : {}),
    ...(input.spans !== undefined ? { spans: input.spans } : {}),
  };
  return ok({ ...map, nodes: [...map.nodes, node] });
}

/**
 * Add the dependency edge `from USES to`, optionally labeled with what flows
 * along it. Refuses self-edges, duplicates and any edge that does not point
 * strictly downward (I4).
 */
export function linkNodes(map: MellosMap, from: NodeId, to: NodeId, label?: string): Result<MellosMap, MapError> {
  if (from === to) return err({ kind: 'self-edge', id: from });
  const fromNode = findNode(map, from);
  if (!fromNode) return err({ kind: 'unknown-node', id: from });
  const toNode = findNode(map, to);
  if (!toNode) return err({ kind: 'unknown-node', id: to });
  if (hasEdge(map, from, to)) return err({ kind: 'duplicate-edge', from, to });

  // Layers are guaranteed to exist for stored nodes (I2), so the lookups cannot miss.
  const fromRank = findLayer(map, fromNode.layer)!.rank;
  const toRank = findLayer(map, toNode.layer)!.rank;
  if (fromRank <= toRank) return err({ kind: 'edge-not-downward', from, fromRank, to, toRank });

  return ok({ ...map, edges: [...map.edges, { from, to, ...(label !== undefined ? { label } : {}) }] });
}

export interface UpdateNodeInput {
  readonly id: NodeId;
  readonly status?: NodeStatus;
  readonly label?: string;
  readonly evidence?: string;
  readonly detail?: string;
  /** A GroupId joins that group (I7 validated); null leaves the current group. */
  readonly group?: GroupId | null;
  /** A NodeKind sets the presentation kind; null clears it. */
  readonly kind?: NodeKind | null;
  /** A LaneId joins that lane (I9 validated); null leaves the current lane. */
  readonly lane?: LaneId | null;
  /** A SubmapRef links a child map page; null unlinks it. */
  readonly submap?: SubmapRef | null;
  /**
   * Wall-clock stamp (epoch ms) for this status change, supplied by the
   * boundary — this layer owns no clock. Omit it and no timing is recorded,
   * which is exactly what a pure relabel or a store replay wants.
   */
  readonly at?: number;
}

/**
 * Span bookkeeping for one status change. Entering `in-progress` opens a
 * stretch unless one is already open; leaving it closes the open one. Both are
 * no-ops without a stamp, and a close never yields a backwards stretch.
 *
 * Note what is NOT here: no rejection of odd sequences. Two `in-progress`
 * reports in a row keep the one stretch; a `done` with nothing open changes
 * nothing. The ledger records, it does not police.
 */
function stampSpans(
  node: MapNode,
  status: NodeStatus | undefined,
  at: number | undefined,
): readonly WorkSpan[] | undefined {
  if (status === undefined || at === undefined) return node.spans;
  const spans = node.spans ?? [];
  const open = spans.findIndex((s) => s.to === undefined);
  if (status === 'in-progress') return open >= 0 ? node.spans : [...spans, { from: at }];
  if (open < 0) return node.spans;
  return spans.map((s, i) => (i === open ? { from: s.from, to: Math.max(s.from, at) } : s));
}

/**
 * Update a node's status, label, evidence, design detail, group membership,
 * kind and/or lane. Absent fields are left untouched. No transition rules:
 * the ledger records whatever the caller reports, whenever they report it.
 * When `at` is supplied, a status change also opens or closes a work span.
 */
export function updateNode(map: MellosMap, input: UpdateNodeInput): Result<MellosMap, MapError> {
  const node = findNode(map, input.id);
  if (!node) return err({ kind: 'unknown-node', id: input.id });
  if (input.group !== undefined && input.group !== null) {
    const bad = checkMembership(map, node.id, node.layer, input.group);
    if (bad) return err(bad);
  }
  if (input.lane !== undefined && input.lane !== null && !findLane(map, input.lane)) {
    return err({ kind: 'unknown-lane', id: input.lane });
  }

  const { group: currentGroup, kind: currentKind, lane: currentLane, submap: currentSubmap, spans: _spans, ...bare } = node;
  const nextSpans = stampSpans(node, input.status, input.at);
  const nextGroup = input.group === undefined ? currentGroup : input.group === null ? undefined : input.group;
  const nextKind = input.kind === undefined ? currentKind : input.kind === null ? undefined : input.kind;
  const nextLane = input.lane === undefined ? currentLane : input.lane === null ? undefined : input.lane;
  const nextSubmap = input.submap === undefined ? currentSubmap : input.submap === null ? undefined : input.submap;
  const updated: MapNode = {
    ...bare,
    ...(nextGroup !== undefined ? { group: nextGroup } : {}),
    ...(nextKind !== undefined ? { kind: nextKind } : {}),
    ...(nextLane !== undefined ? { lane: nextLane } : {}),
    ...(nextSubmap !== undefined ? { submap: nextSubmap } : {}),
    ...(nextSpans !== undefined ? { spans: nextSpans } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
  return ok({ ...map, nodes: map.nodes.map((n) => (n.id === input.id ? updated : n)) });
}

/**
 * Remove a node.
 * Postcondition (explicit part of this contract): every edge touching the
 * node is removed with it — a map never holds edges to missing nodes.
 */
export function removeNode(map: MellosMap, id: NodeId): Result<MellosMap, MapError> {
  if (!findNode(map, id)) return err({ kind: 'unknown-node', id });

  return ok({
    ...map,
    nodes: map.nodes.filter((n) => n.id !== id),
    edges: map.edges.filter((e) => e.from !== id && e.to !== id),
  });
}

/** Remove one dependency edge. */
export function removeEdge(map: MellosMap, from: NodeId, to: NodeId): Result<MellosMap, MapError> {
  if (!hasEdge(map, from, to)) return err({ kind: 'unknown-edge', from, to });
  return ok({ ...map, edges: map.edges.filter((e) => !(e.from === from && e.to === to)) });
}

/** Remove a band. Only empty bands may go — neither a node (I2) nor a group (I6) may be orphaned. */
export function removeLayer(map: MellosMap, id: LayerId): Result<MellosMap, MapError> {
  if (!findLayer(map, id)) return err({ kind: 'unknown-layer', id });
  const occupant = map.nodes.find((n) => n.layer === id);
  if (occupant) return err({ kind: 'layer-not-empty', id, occupant: occupant.id });
  const groupOccupant = map.groups.find((g) => g.layer === id);
  if (groupOccupant) return err({ kind: 'layer-holds-group', id, occupant: groupOccupant.id });
  return ok({ ...map, layers: map.layers.filter((l) => l.id !== id) });
}
