/**
 * Layer 0 — pure operations on a MellosMap.
 *
 * Every operation follows validate -> prepare -> commit: all refusals happen
 * before any new value is built, and the commit expression can no longer
 * fail. Inputs are never mutated; the result always carries a fresh map.
 *
 * These functions enforce the structural invariants I1-I10 documented in
 * types.ts and nothing else. In particular there are no workflow rules here:
 * any status may be set at any time, in any order. Discipline lives with the
 * caller; this layer only keeps the map structurally true.
 *
 * Every declared thing can also be REVISED, because a ghost design is a
 * hypothesis and revising it is honest work: a node moves band (moveNode), a
 * band is renamed or re-ordered (updateLayer), a group or lane is relabeled
 * (updateGroup, updateLane), and every optional field a node carries can be
 * cleared as explicitly as it was set (null, never an empty string).
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
  type Rank,
  type Result,
  type SubmapRef,
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

/**
 * Validate that a new id does not already name the OTHER kind of box (I10).
 * Ids are compared as raw slugs on purpose: the shared namespace is exactly
 * what the brands cannot express, which is why this check exists.
 */
function checkIdSpace(map: MellosMap, id: NodeId | GroupId, declaring: 'node' | 'group'): MapError | undefined {
  const taken =
    declaring === 'node'
      ? map.groups.some((g) => (g.id as string) === (id as string))
      : map.nodes.some((n) => (n.id as string) === (id as string));
  return taken ? { kind: 'id-collision', id, taken: declaring === 'node' ? 'group' : 'node' } : undefined;
}

/**
 * Set, replace or clear the map title.
 * @param title - the new title; null (or an explicit undefined) removes the
 *   field entirely, so a cleared title serializes as an absent key rather
 *   than as an empty string nobody can tell from a real one.
 */
export function setTitle(map: MellosMap, title: string | null | undefined): MellosMap {
  if (title === null || title === undefined) {
    const { title: _dropped, ...rest } = map;
    return rest;
  }
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

/** Relabel a lane. The column keeps its id, its order and its members. */
export function updateLane(map: MellosMap, id: LaneId, label: string): Result<MellosMap, MapError> {
  if (!findLane(map, id)) return err({ kind: 'unknown-lane', id });
  return ok({ ...map, lanes: map.lanes.map((l) => (l.id === id ? { ...l, label } : l)) });
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
  readonly rank: Rank;
}

/** Add a new band. Refuses duplicate ids and duplicate ranks (I1). */
export function declareLayer(map: MellosMap, input: DeclareLayerInput): Result<MellosMap, MapError> {
  if (findLayer(map, input.id)) return err({ kind: 'duplicate-layer', id: input.id });
  const rankHolder = map.layers.find((l) => l.rank === input.rank);
  if (rankHolder) return err({ kind: 'duplicate-rank', rank: input.rank, existing: rankHolder.id });

  return ok({ ...map, layers: [...map.layers, { id: input.id, name: input.name, rank: input.rank }] });
}

export interface UpdateLayerInput {
  readonly name?: string;
  readonly rank?: Rank;
}

/**
 * Rename a band and/or move it in the vertical order. Absent fields are left
 * untouched; the band keeps its id and its occupants either way.
 *
 * A rank change is the one revision that can invalidate the whole graph, so
 * it is validated against the map as a whole before anything changes:
 *   - the new rank is free (I1) — bands stay totally ordered;
 *   - EVERY edge, not only the ones touching this band, still points
 *     strictly downward under the new order (I4). Re-ranking a band moves
 *     all of its nodes at once, so an edge two bands away can be the one
 *     that breaks; the refusal names it.
 * @returns the reordered map, or the first refusal.
 */
export function updateLayer(map: MellosMap, id: LayerId, input: UpdateLayerInput): Result<MellosMap, MapError> {
  const layer = findLayer(map, id);
  if (!layer) return err({ kind: 'unknown-layer', id });
  if (input.rank !== undefined && input.rank !== layer.rank) {
    const rankHolder = map.layers.find((l) => l.rank === input.rank && l.id !== id);
    if (rankHolder) return err({ kind: 'duplicate-rank', rank: input.rank, existing: rankHolder.id });
    // Layers are guaranteed to exist for stored nodes (I2), so no lookup misses.
    const rankAfter = (nodeId: NodeId): Rank => {
      const nodeLayer = findNode(map, nodeId)!.layer;
      return nodeLayer === id ? input.rank! : findLayer(map, nodeLayer)!.rank;
    };
    for (const e of map.edges) {
      const fromRank = rankAfter(e.from);
      const toRank = rankAfter(e.to);
      if (fromRank <= toRank) return err({ kind: 'edge-not-downward', from: e.from, fromRank, to: e.to, toRank });
    }
  }

  const updated: MapLayer = {
    ...layer,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.rank !== undefined ? { rank: input.rank } : {}),
  };
  return ok({ ...map, layers: map.layers.map((l) => (l.id === id ? updated : l)) });
}

export interface DeclareGroupInput {
  readonly id: GroupId;
  readonly label: string;
  readonly layer: LayerId;
}

/** Add a new group to an existing band (I6), under an id no node holds (I10). */
export function declareGroup(map: MellosMap, input: DeclareGroupInput): Result<MellosMap, MapError> {
  if (findGroup(map, input.id)) return err({ kind: 'duplicate-group', id: input.id });
  const collision = checkIdSpace(map, input.id, 'group');
  if (collision) return err(collision);
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

export interface DeclareNodeInput {
  readonly id: NodeId;
  readonly label: string;
  readonly layer: LayerId;
  readonly status?: NodeStatus;
  /**
   * Verification evidence, for a node declared straight into `done` — work
   * already finished when the map is drawn is as entitled to its proof as
   * work finished under the map's eyes.
   */
  readonly evidence?: string;
  readonly detail?: string;
  readonly group?: GroupId;
  readonly kind?: NodeKind;
  readonly lane?: LaneId;
  readonly submap?: SubmapRef;
}

/**
 * Add a new node to an existing band (I2, I3) under an id no group holds
 * (I10), optionally joining a same-band group (I7) and/or an existing lane
 * (I9).
 */
export function declareNode(map: MellosMap, input: DeclareNodeInput): Result<MellosMap, MapError> {
  if (findNode(map, input.id)) return err({ kind: 'duplicate-node', id: input.id });
  const collision = checkIdSpace(map, input.id, 'node');
  if (collision) return err(collision);
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
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.lane !== undefined ? { lane: input.lane } : {}),
    ...(input.submap !== undefined ? { submap: input.submap } : {}),
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
  /** Text replaces the evidence; null clears it (a node demoted back to a plan). */
  readonly evidence?: string | null;
  /** Text replaces the design notes; null clears them. */
  readonly detail?: string | null;
  /** A GroupId joins that group (I7 validated); null leaves the current group. */
  readonly group?: GroupId | null;
  /** A NodeKind sets the presentation kind; null clears it. */
  readonly kind?: NodeKind | null;
  /** A LaneId joins that lane (I9 validated); null leaves the current lane. */
  readonly lane?: LaneId | null;
  /** A SubmapRef links a child map page; null unlinks it. */
  readonly submap?: SubmapRef | null;
}

/**
 * Resolve one optional-and-clearable field: absent input keeps the stored
 * value, null erases it, anything else replaces it.
 */
function resolveOptional<T>(input: T | null | undefined, current: T | undefined): T | undefined {
  return input === undefined ? current : input === null ? undefined : input;
}

/**
 * Update a node's status, label, evidence, design detail, group membership,
 * kind, lane and/or submap link. Absent fields are left untouched, null
 * clears the field. No transition rules: the ledger records whatever the
 * caller reports, whenever they report it.
 * Postcondition: the node keeps its band — moving between bands is moveNode,
 * which is the operation that re-checks I4.
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

  const {
    group: currentGroup,
    kind: currentKind,
    lane: currentLane,
    submap: currentSubmap,
    evidence: currentEvidence,
    detail: currentDetail,
    ...bare
  } = node;
  const nextGroup = resolveOptional(input.group, currentGroup);
  const nextKind = resolveOptional(input.kind, currentKind);
  const nextLane = resolveOptional(input.lane, currentLane);
  const nextSubmap = resolveOptional(input.submap, currentSubmap);
  const nextEvidence = resolveOptional(input.evidence, currentEvidence);
  const nextDetail = resolveOptional(input.detail, currentDetail);
  const updated: MapNode = {
    ...bare,
    ...(nextEvidence !== undefined ? { evidence: nextEvidence } : {}),
    ...(nextDetail !== undefined ? { detail: nextDetail } : {}),
    ...(nextGroup !== undefined ? { group: nextGroup } : {}),
    ...(nextKind !== undefined ? { kind: nextKind } : {}),
    ...(nextLane !== undefined ? { lane: nextLane } : {}),
    ...(nextSubmap !== undefined ? { submap: nextSubmap } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
  return ok({ ...map, nodes: map.nodes.map((n) => (n.id === input.id ? updated : n)) });
}

/**
 * Move a node to another band — the revision every ghost design eventually
 * needs, and the only way to empty a band without deleting work.
 *
 * Validated before anything changes:
 *   - the target band exists (I2);
 *   - every edge touching the node still points strictly downward from its
 *     NEW rank (I4) — a move that would flatten or invert a dependency is
 *     refused, naming the edge that blocks it;
 *   - group membership (I7) still holds. A grouped node may only move to its
 *     group's band; the move never silently ungroups it, because dropping a
 *     subsystem membership is a decision the caller must make out loud with
 *     updateNode({ group: null }).
 * @returns the map with the node rebanded, or the first refusal.
 */
export function moveNode(map: MellosMap, id: NodeId, layer: LayerId): Result<MellosMap, MapError> {
  const node = findNode(map, id);
  if (!node) return err({ kind: 'unknown-node', id });
  const target = findLayer(map, layer);
  if (!target) return err({ kind: 'unknown-layer', id: layer });
  if (node.group !== undefined) {
    const bad = checkMembership(map, id, layer, node.group);
    if (bad) return err(bad);
  }
  // Layers are guaranteed to exist for stored nodes (I2), so no lookup misses.
  const rankAfter = (nodeId: NodeId): Rank =>
    nodeId === id ? target.rank : findLayer(map, findNode(map, nodeId)!.layer)!.rank;
  for (const e of map.edges) {
    if (e.from !== id && e.to !== id) continue;
    const fromRank = rankAfter(e.from);
    const toRank = rankAfter(e.to);
    if (fromRank <= toRank) return err({ kind: 'edge-not-downward', from: e.from, fromRank, to: e.to, toRank });
  }

  return ok({ ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, layer } : n)) });
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
