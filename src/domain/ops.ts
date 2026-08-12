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
}

/**
 * Update a node's status, label, evidence, design detail, group membership,
 * kind and/or lane. Absent fields are left untouched. No transition rules:
 * the ledger records whatever the caller reports, whenever they report it.
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

  const { group: currentGroup, kind: currentKind, lane: currentLane, submap: currentSubmap, ...bare } = node;
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
