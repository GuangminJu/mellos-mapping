/**
 * Layer 2 — translating raw tool inputs into domain operation sequences.
 *
 * Each apply* function is a TRANSACTION over a pure value: it folds the
 * requested items through the Layer 0 operations and either returns the
 * fully-updated map or the first refusal (with item context) and NO partial
 * change — the caller only persists on success, so the state file never
 * holds a half-applied batch.
 *
 * Kept free of MCP/SDK types so the whole tool surface is testable as plain
 * functions; server.ts is only wiring.
 */

import {
  declareGroup,
  declareLane,
  declareLayer,
  declareNode,
  linkNodes,
  moveNode,
  removeEdge,
  removeGroup,
  removeLane,
  removeLayer,
  removeNode,
  setKind,
  setTitle,
  updateGroup,
  updateLane,
  updateLayer,
  updateNode,
} from '../domain/ops.js';
import {
  type GroupId,
  type LaneId,
  type MellosMap,
  type NodeKind,
  type NodeStatus,
  type Rank,
  type Result,
  type SubmapRef,
  describeMapError,
  err,
  makeGroupId,
  makeLaneId,
  makeLayerId,
  makeMapKind,
  makeNodeId,
  makeNodeKind,
  makeNodeStatus,
  makeRank,
  makeSubmapRef,
  ok,
} from '../domain/types.js';

/**
 * A node may not dive into the page it lives on. Pages are the one structure
 * outside Layer 0 (the domain has no notion of a page at all), so the rule
 * lands here, on the batch's own `page` field: a submap is a CHILD map, and
 * a page that is its own child is a loop with no bottom — the page-level
 * form of the self-edge linkNodes already refuses.
 */
function refuseSelfDive(where: string, submap: string, page: string | undefined): string | undefined {
  return submap === page
    ? `${where}: a node cannot dive into its own page ("${submap}"); a submap links a CHILD page`
    : undefined;
}

// The `| undefined` on every optional field keeps these assignable from
// zod-inferred tool inputs under exactOptionalPropertyTypes.
export interface DeclareInput {
  /** The page this batch targets (undefined = the default page); see refuseSelfDive. */
  readonly page?: string | undefined;
  /** Text sets the title; null removes it (the map keeps everything else). */
  readonly title?: string | null | undefined;
  /** Diagram kind (dev | architecture | dataflow | behavior-tree | sequence). */
  readonly kind?: string | undefined;
  readonly layers?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly rank: number }> | undefined;
  readonly lanes?: ReadonlyArray<{ readonly id: string; readonly label: string }> | undefined;
  readonly groups?:
    | ReadonlyArray<{ readonly id: string; readonly label: string; readonly layer: string }>
    | undefined;
  readonly nodes?:
    | ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly layer: string;
        readonly status?: string | undefined;
        readonly evidence?: string | undefined;
        readonly detail?: string | undefined;
        readonly group?: string | undefined;
        readonly kind?: string | undefined;
        readonly lane?: string | undefined;
        readonly submap?: string | undefined;
      }>
    | undefined;
  readonly edges?:
    | ReadonlyArray<{ readonly from: string; readonly to: string; readonly label?: string | undefined }>
    | undefined;
}

/**
 * One revision batch. Every list is optional and the batch must carry at
 * least one item: a revision that revises nothing is a caller mistake worth
 * naming, not a silent no-op that reports "map now: ..." as if something
 * had happened.
 */
export interface UpdateInput {
  /** The page this batch targets (undefined = the default page); see refuseSelfDive. */
  readonly page?: string | undefined;
  readonly updates?:
    | ReadonlyArray<{
        readonly id: string;
        readonly status?: string | undefined;
        readonly label?: string | undefined;
        /** Text replaces the evidence; null clears it. */
        readonly evidence?: string | null | undefined;
        /** Text replaces the design notes; null clears them. */
        readonly detail?: string | null | undefined;
        /** A layer id moves the node to that band — applied BEFORE this item's other fields. */
        readonly layer?: string | undefined;
        /** A group id joins that group; null leaves the current one. */
        readonly group?: string | null | undefined;
        /** A kind slug sets the node kind; null clears it. */
        readonly kind?: string | null | undefined;
        /** A lane id joins that lane; null leaves the current one. */
        readonly lane?: string | null | undefined;
        /** A page slug links a child map; null unlinks it. */
        readonly submap?: string | null | undefined;
      }>
    | undefined;
  /** Bands to rename and/or re-rank; an item must carry a name, a rank, or both. */
  readonly layers?:
    | ReadonlyArray<{
        readonly id: string;
        readonly name?: string | undefined;
        readonly rank?: number | undefined;
      }>
    | undefined;
  readonly groups?: ReadonlyArray<{ readonly id: string; readonly label: string }> | undefined;
  readonly lanes?: ReadonlyArray<{ readonly id: string; readonly label: string }> | undefined;
}

export interface RemoveInput {
  readonly nodes?: ReadonlyArray<string> | undefined;
  readonly edges?: ReadonlyArray<{ readonly from: string; readonly to: string }> | undefined;
  readonly groups?: ReadonlyArray<string> | undefined;
  readonly lanes?: ReadonlyArray<string> | undefined;
  readonly layers?: ReadonlyArray<string> | undefined;
}

/** Grow the map: title, kind, bands, lanes, groups, nodes, edges — in that order. */
export function applyDeclare(map: MellosMap, input: DeclareInput): Result<MellosMap, string> {
  let next = input.title !== undefined ? setTitle(map, input.title) : map;
  if (input.kind !== undefined) {
    const kind = makeMapKind(input.kind);
    if (!kind.ok) return err(`kind: ${describeMapError(kind.error)}`);
    next = setKind(next, kind.value);
  }

  for (const [i, l] of (input.layers ?? []).entries()) {
    const id = makeLayerId(l.id);
    if (!id.ok) return err(`layers[${i}]: ${describeMapError(id.error)}`);
    const rank = makeRank(l.rank);
    if (!rank.ok) return err(`layers[${i}]: ${describeMapError(rank.error)}`);
    const declared = declareLayer(next, { id: id.value, name: l.name, rank: rank.value });
    if (!declared.ok) return err(`layers[${i}]: ${describeMapError(declared.error)}`);
    next = declared.value;
  }

  for (const [i, l] of (input.lanes ?? []).entries()) {
    const id = makeLaneId(l.id);
    if (!id.ok) return err(`lanes[${i}]: ${describeMapError(id.error)}`);
    const declared = declareLane(next, { id: id.value, label: l.label });
    if (!declared.ok) return err(`lanes[${i}]: ${describeMapError(declared.error)}`);
    next = declared.value;
  }

  for (const [i, g] of (input.groups ?? []).entries()) {
    const id = makeGroupId(g.id);
    if (!id.ok) return err(`groups[${i}]: ${describeMapError(id.error)}`);
    const layer = makeLayerId(g.layer);
    if (!layer.ok) return err(`groups[${i}]: ${describeMapError(layer.error)}`);
    const declared = declareGroup(next, { id: id.value, label: g.label, layer: layer.value });
    if (!declared.ok) return err(`groups[${i}]: ${describeMapError(declared.error)}`);
    next = declared.value;
  }

  for (const [i, n] of (input.nodes ?? []).entries()) {
    const id = makeNodeId(n.id);
    if (!id.ok) return err(`nodes[${i}]: ${describeMapError(id.error)}`);
    const layer = makeLayerId(n.layer);
    if (!layer.ok) return err(`nodes[${i}]: ${describeMapError(layer.error)}`);
    let status: NodeStatus | undefined;
    if (n.status !== undefined) {
      const parsed = makeNodeStatus(n.status);
      if (!parsed.ok) return err(`nodes[${i}]: ${describeMapError(parsed.error)}`);
      status = parsed.value;
    }
    let group: GroupId | undefined;
    if (n.group !== undefined) {
      const parsed = makeGroupId(n.group);
      if (!parsed.ok) return err(`nodes[${i}]: ${describeMapError(parsed.error)}`);
      group = parsed.value;
    }
    let kind: NodeKind | undefined;
    if (n.kind !== undefined) {
      const parsed = makeNodeKind(n.kind);
      if (!parsed.ok) return err(`nodes[${i}]: ${describeMapError(parsed.error)}`);
      kind = parsed.value;
    }
    let lane: LaneId | undefined;
    if (n.lane !== undefined) {
      const parsed = makeLaneId(n.lane);
      if (!parsed.ok) return err(`nodes[${i}]: ${describeMapError(parsed.error)}`);
      lane = parsed.value;
    }
    let submap: SubmapRef | undefined;
    if (n.submap !== undefined) {
      const parsed = makeSubmapRef(n.submap);
      if (!parsed.ok) return err(`nodes[${i}]: ${describeMapError(parsed.error)}`);
      const selfDive = refuseSelfDive(`nodes[${i}]`, n.submap, input.page);
      if (selfDive !== undefined) return err(selfDive);
      submap = parsed.value;
    }
    const declared = declareNode(next, {
      id: id.value,
      label: n.label,
      layer: layer.value,
      ...(status !== undefined ? { status } : {}),
      ...(n.evidence !== undefined ? { evidence: n.evidence } : {}),
      ...(n.detail !== undefined ? { detail: n.detail } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(submap !== undefined ? { submap } : {}),
    });
    if (!declared.ok) return err(`nodes[${i}]: ${describeMapError(declared.error)}`);
    next = declared.value;
  }

  for (const [i, e] of (input.edges ?? []).entries()) {
    const from = makeNodeId(e.from);
    if (!from.ok) return err(`edges[${i}]: ${describeMapError(from.error)}`);
    const to = makeNodeId(e.to);
    if (!to.ok) return err(`edges[${i}]: ${describeMapError(to.error)}`);
    const linked = linkNodes(next, from.value, to.value, e.label);
    if (!linked.ok) return err(`edges[${i}]: ${describeMapError(linked.error)}`);
    next = linked.value;
  }

  return ok(next);
}

/**
 * Revise an existing map: rename and re-rank bands, relabel groups and
 * lanes, then record progress on nodes — status, label, evidence, design
 * notes, band, group, kind, lane and submap.
 *
 * Order is part of the contract, because a batch may depend on it:
 *   1. layers, 2. groups, 3. lanes, 4. node updates — structure settles
 *      before the nodes that live in it are touched, so a node can move into
 *      a band the same batch just re-ranked;
 *   - within ONE node update, `layer` moves the node BEFORE its other fields
 *     apply, so "move to band B and join group G on B" is one item. The
 *     reverse trip (leave a group, then move off its band) is two items in
 *     the same batch — moveNode never silently ungroups, so the caller says
 *     it out loud.
 * @returns the fully revised map, or the first refusal with its item index.
 */
export function applyUpdate(map: MellosMap, input: UpdateInput): Result<MellosMap, string> {
  let next = map;
  const items =
    (input.updates?.length ?? 0) + (input.layers?.length ?? 0) + (input.groups?.length ?? 0) + (input.lanes?.length ?? 0);
  if (items === 0) return err('nothing to revise: pass updates, layers, groups or lanes');

  for (const [i, l] of (input.layers ?? []).entries()) {
    const id = makeLayerId(l.id);
    if (!id.ok) return err(`layers[${i}]: ${describeMapError(id.error)}`);
    if (l.name === undefined && l.rank === undefined) {
      return err(`layers[${i}]: nothing to change; give a name, a rank, or both`);
    }
    let rank: Rank | undefined;
    if (l.rank !== undefined) {
      const parsed = makeRank(l.rank);
      if (!parsed.ok) return err(`layers[${i}]: ${describeMapError(parsed.error)}`);
      rank = parsed.value;
    }
    const updated = updateLayer(next, id.value, {
      ...(l.name !== undefined ? { name: l.name } : {}),
      ...(rank !== undefined ? { rank } : {}),
    });
    if (!updated.ok) return err(`layers[${i}]: ${describeMapError(updated.error)}`);
    next = updated.value;
  }

  for (const [i, g] of (input.groups ?? []).entries()) {
    const id = makeGroupId(g.id);
    if (!id.ok) return err(`groups[${i}]: ${describeMapError(id.error)}`);
    const updated = updateGroup(next, id.value, g.label);
    if (!updated.ok) return err(`groups[${i}]: ${describeMapError(updated.error)}`);
    next = updated.value;
  }

  for (const [i, l] of (input.lanes ?? []).entries()) {
    const id = makeLaneId(l.id);
    if (!id.ok) return err(`lanes[${i}]: ${describeMapError(id.error)}`);
    const updated = updateLane(next, id.value, l.label);
    if (!updated.ok) return err(`lanes[${i}]: ${describeMapError(updated.error)}`);
    next = updated.value;
  }

  for (const [i, u] of (input.updates ?? []).entries()) {
    const id = makeNodeId(u.id);
    if (!id.ok) return err(`updates[${i}]: ${describeMapError(id.error)}`);
    if (u.layer !== undefined) {
      const layer = makeLayerId(u.layer);
      if (!layer.ok) return err(`updates[${i}]: ${describeMapError(layer.error)}`);
      const moved = moveNode(next, id.value, layer.value);
      if (!moved.ok) return err(`updates[${i}]: ${describeMapError(moved.error)}`);
      next = moved.value;
    }
    let status: NodeStatus | undefined;
    if (u.status !== undefined) {
      const parsed = makeNodeStatus(u.status);
      if (!parsed.ok) return err(`updates[${i}]: ${describeMapError(parsed.error)}`);
      status = parsed.value;
    }
    let group: GroupId | null | undefined;
    if (u.group === null) group = null;
    else if (u.group !== undefined) {
      const parsed = makeGroupId(u.group);
      if (!parsed.ok) return err(`updates[${i}]: ${describeMapError(parsed.error)}`);
      group = parsed.value;
    }
    let kind: NodeKind | null | undefined;
    if (u.kind === null) kind = null;
    else if (u.kind !== undefined) {
      const parsed = makeNodeKind(u.kind);
      if (!parsed.ok) return err(`updates[${i}]: ${describeMapError(parsed.error)}`);
      kind = parsed.value;
    }
    let lane: LaneId | null | undefined;
    if (u.lane === null) lane = null;
    else if (u.lane !== undefined) {
      const parsed = makeLaneId(u.lane);
      if (!parsed.ok) return err(`updates[${i}]: ${describeMapError(parsed.error)}`);
      lane = parsed.value;
    }
    let submap: SubmapRef | null | undefined;
    if (u.submap === null) submap = null;
    else if (u.submap !== undefined) {
      const parsed = makeSubmapRef(u.submap);
      if (!parsed.ok) return err(`updates[${i}]: ${describeMapError(parsed.error)}`);
      const selfDive = refuseSelfDive(`updates[${i}]`, u.submap, input.page);
      if (selfDive !== undefined) return err(selfDive);
      submap = parsed.value;
    }
    const updated = updateNode(next, {
      id: id.value,
      ...(status !== undefined ? { status } : {}),
      ...(u.label !== undefined ? { label: u.label } : {}),
      ...(u.evidence !== undefined ? { evidence: u.evidence } : {}),
      ...(u.detail !== undefined ? { detail: u.detail } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(submap !== undefined ? { submap } : {}),
    });
    if (!updated.ok) return err(`updates[${i}]: ${describeMapError(updated.error)}`);
    next = updated.value;
  }
  return ok(next);
}

/** Revise the map: drop edges, nodes, groups, lanes, then (empty) bands — in that order. */
export function applyRemove(map: MellosMap, input: RemoveInput): Result<MellosMap, string> {
  let next = map;

  for (const [i, e] of (input.edges ?? []).entries()) {
    const from = makeNodeId(e.from);
    if (!from.ok) return err(`edges[${i}]: ${describeMapError(from.error)}`);
    const to = makeNodeId(e.to);
    if (!to.ok) return err(`edges[${i}]: ${describeMapError(to.error)}`);
    const removed = removeEdge(next, from.value, to.value);
    if (!removed.ok) return err(`edges[${i}]: ${describeMapError(removed.error)}`);
    next = removed.value;
  }

  for (const [i, rawId] of (input.nodes ?? []).entries()) {
    const id = makeNodeId(rawId);
    if (!id.ok) return err(`nodes[${i}]: ${describeMapError(id.error)}`);
    const removed = removeNode(next, id.value);
    if (!removed.ok) return err(`nodes[${i}]: ${describeMapError(removed.error)}`);
    next = removed.value;
  }

  for (const [i, rawId] of (input.groups ?? []).entries()) {
    const id = makeGroupId(rawId);
    if (!id.ok) return err(`groups[${i}]: ${describeMapError(id.error)}`);
    const removed = removeGroup(next, id.value);
    if (!removed.ok) return err(`groups[${i}]: ${describeMapError(removed.error)}`);
    next = removed.value;
  }

  for (const [i, rawId] of (input.lanes ?? []).entries()) {
    const id = makeLaneId(rawId);
    if (!id.ok) return err(`lanes[${i}]: ${describeMapError(id.error)}`);
    const removed = removeLane(next, id.value);
    if (!removed.ok) return err(`lanes[${i}]: ${describeMapError(removed.error)}`);
    next = removed.value;
  }

  for (const [i, rawId] of (input.layers ?? []).entries()) {
    const id = makeLayerId(rawId);
    if (!id.ok) return err(`layers[${i}]: ${describeMapError(id.error)}`);
    const removed = removeLayer(next, id.value);
    if (!removed.ok) return err(`layers[${i}]: ${describeMapError(removed.error)}`);
    next = removed.value;
  }

  return ok(next);
}

/** One line of feedback after a successful mutation. */
export function summarize(map: MellosMap): string {
  const byStatus = { planned: 0, 'in-progress': 0, done: 0, regressed: 0 };
  for (const n of map.nodes) byStatus[n.status]++;
  const statusPart = (Object.entries(byStatus) as Array<[NodeStatus, number]>)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  return (
    `map now: ${map.layers.length} layer(s), ${map.nodes.length} node(s)` +
    (statusPart ? ` [${statusPart}]` : '') +
    (map.groups.length > 0 ? `, ${map.groups.length} group(s)` : '') +
    (map.lanes.length > 0 ? `, ${map.lanes.length} lane(s)` : '') +
    `, ${map.edges.length} edge(s)` +
    (map.kind !== undefined && map.kind !== 'dev' ? ` (${map.kind})` : '')
  );
}
