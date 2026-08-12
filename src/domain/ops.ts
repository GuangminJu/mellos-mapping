/**
 * Layer 0 — pure operations on a MellosMap.
 *
 * Every operation follows validate -> prepare -> commit: all refusals happen
 * before any new value is built, and the commit expression can no longer
 * fail. Inputs are never mutated; the result always carries a fresh map.
 *
 * These functions enforce the structural invariants I1-I5 documented in
 * types.ts and nothing else. In particular there are no workflow rules here:
 * any status may be set at any time, in any order. Discipline lives with the
 * caller; this layer only keeps the map structurally true.
 */

import {
  type LayerId,
  type MapError,
  type MapLayer,
  type MapNode,
  type MellosMap,
  type NodeId,
  type NodeStatus,
  type Result,
  err,
  ok,
} from './types.js';

function findLayer(map: MellosMap, id: LayerId): MapLayer | undefined {
  return map.layers.find((l) => l.id === id);
}

function findNode(map: MellosMap, id: NodeId): MapNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

function hasEdge(map: MellosMap, from: NodeId, to: NodeId): boolean {
  return map.edges.some((e) => e.from === from && e.to === to);
}

/** Set or replace the map title. */
export function setTitle(map: MellosMap, title: string): MellosMap {
  return { ...map, title };
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

export interface DeclareNodeInput {
  readonly id: NodeId;
  readonly label: string;
  readonly layer: LayerId;
  readonly status?: NodeStatus;
  readonly detail?: string;
}

/** Add a new node to an existing band (I2, I3). Status defaults to 'planned' — a ghost on the map. */
export function declareNode(map: MellosMap, input: DeclareNodeInput): Result<MellosMap, MapError> {
  if (findNode(map, input.id)) return err({ kind: 'duplicate-node', id: input.id });
  if (!findLayer(map, input.layer)) return err({ kind: 'unknown-layer', id: input.layer });

  const node: MapNode = {
    id: input.id,
    label: input.label,
    layer: input.layer,
    status: input.status ?? 'planned',
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
  return ok({ ...map, nodes: [...map.nodes, node] });
}

/**
 * Add the dependency edge `from USES to`. Refuses self-edges, duplicates and
 * any edge that does not point strictly downward (I4).
 */
export function linkNodes(map: MellosMap, from: NodeId, to: NodeId): Result<MellosMap, MapError> {
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

  return ok({ ...map, edges: [...map.edges, { from, to }] });
}

export interface UpdateNodeInput {
  readonly id: NodeId;
  readonly status?: NodeStatus;
  readonly label?: string;
  readonly evidence?: string;
  readonly detail?: string;
}

/**
 * Update a node's status, label, evidence and/or design detail. Absent
 * fields are left untouched. No transition rules: the ledger records
 * whatever the caller reports, whenever they report it.
 */
export function updateNode(map: MellosMap, input: UpdateNodeInput): Result<MellosMap, MapError> {
  const node = findNode(map, input.id);
  if (!node) return err({ kind: 'unknown-node', id: input.id });

  const updated: MapNode = {
    ...node,
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

/** Remove a band. Only empty bands may go — a node must never be left without a layer (I2). */
export function removeLayer(map: MellosMap, id: LayerId): Result<MellosMap, MapError> {
  if (!findLayer(map, id)) return err({ kind: 'unknown-layer', id });
  const occupant = map.nodes.find((n) => n.layer === id);
  if (occupant) return err({ kind: 'layer-not-empty', id, occupant: occupant.id });
  return ok({ ...map, layers: map.layers.filter((l) => l.id !== id) });
}
