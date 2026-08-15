/**
 * Layer 1a — the state-file FORMAT of a MellosMap, pure of any I/O.
 *
 * This module owns the on-disk vocabulary (version, page-id grammar) and the
 * two format promises every consumer relies on:
 *
 *   P1. Whatever parseMap accepts satisfies the structural invariants of
 *       Layer 0. Parsing is done by REPLAYING the raw data through the domain
 *       operations, so a hand-edited or corrupted file can never smuggle an
 *       invariant violation into the process (validate at the boundary,
 *       trust internal code afterwards).
 *   F1. serializeMap is the inverse of parseMap for valid maps.
 *
 * No node:* imports — this module must load in a browser as-is. Filesystem
 * concerns (atomic writes, page file listing, focus requests) live in
 * ./store.ts, the Node-side half.
 */

import { declareGroup, declareLane, declareLayer, declareNode, linkNodes, setKind, setTitle, updateNode } from '../domain/ops.js';
import {
  EMPTY_MAP,
  ID_RULE,
  ID_RULE_TEXT,
  type InvalidId,
  type MapError,
  type MellosMap,
  type Result,
  describeMapError,
  err,
  makeGroupId,
  makeLaneId,
  makeLayerId,
  makeMapKind,
  makeNodeId,
  makeNodeKind,
  makeNodeStatus,
  makeSubmapRef,
  ok,
} from '../domain/types.js';

/** On-disk format version. Bump only with a documented migration. */
export const STATE_FILE_VERSION = 1;

export type PageId = string & { readonly __brand: 'PageId' };

export function makePageId(raw: string): Result<PageId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as PageId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export type StoreError =
  | { readonly kind: 'not-found'; readonly path: string }
  | { readonly kind: 'malformed-json'; readonly path: string; readonly detail: string }
  | { readonly kind: 'bad-shape'; readonly path: string; readonly detail: string }
  | { readonly kind: 'invariant-violation'; readonly path: string; readonly violation: MapError };

export function describeStoreError(e: StoreError): string {
  switch (e.kind) {
    case 'not-found':
      return `no map file at ${e.path}`;
    case 'malformed-json':
      return `map file ${e.path} is not valid JSON: ${e.detail}`;
    case 'bad-shape':
      return `map file ${e.path} has an unexpected shape: ${e.detail}`;
    case 'invariant-violation':
      return `map file ${e.path} violates a structural invariant: ${describeMapError(e.violation)}`;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Rebuild a MellosMap from untrusted raw data by replaying it through the
 * Layer 0 operations (P1). Field order in the file does not matter; replay
 * order (layers -> lanes -> groups -> nodes -> edges) supplies the required
 * declaration order.
 */
export function parseMap(raw: unknown, path: string): Result<MellosMap, StoreError> {
  if (!isRecord(raw)) return err({ kind: 'bad-shape', path, detail: 'root is not an object' });
  if (raw['version'] !== STATE_FILE_VERSION) {
    return err({ kind: 'bad-shape', path, detail: `version is ${String(raw['version'])}, expected ${STATE_FILE_VERSION}` });
  }

  let map = EMPTY_MAP;
  const title = optionalString(raw['title']);
  if (title !== undefined) map = setTitle(map, title);
  const rawKind = optionalString(raw['kind']);
  if (rawKind !== undefined) {
    const kind = makeMapKind(rawKind);
    if (!kind.ok) return err({ kind: 'invariant-violation', path, violation: kind.error });
    map = setKind(map, kind.value);
  }

  for (const [i, rawLayer] of asArray(raw['layers']).entries()) {
    if (!isRecord(rawLayer)) return err({ kind: 'bad-shape', path, detail: `layers[${i}] is not an object` });
    const id = makeLayerId(String(rawLayer['id'] ?? ''));
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const name = optionalString(rawLayer['name']);
    const rank = rawLayer['rank'];
    if (name === undefined || typeof rank !== 'number' || !Number.isInteger(rank)) {
      return err({ kind: 'bad-shape', path, detail: `layers[${i}] needs a string name and an integer rank` });
    }
    const next = declareLayer(map, { id: id.value, name, rank });
    if (!next.ok) return err({ kind: 'invariant-violation', path, violation: next.error });
    map = next.value;
  }

  for (const [i, rawLane] of asArray(raw['lanes']).entries()) {
    if (!isRecord(rawLane)) return err({ kind: 'bad-shape', path, detail: `lanes[${i}] is not an object` });
    const id = makeLaneId(String(rawLane['id'] ?? ''));
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const label = optionalString(rawLane['label']);
    if (label === undefined) return err({ kind: 'bad-shape', path, detail: `lanes[${i}] needs a string label` });
    const declared = declareLane(map, { id: id.value, label });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;
  }

  for (const [i, rawGroup] of asArray(raw['groups']).entries()) {
    if (!isRecord(rawGroup)) return err({ kind: 'bad-shape', path, detail: `groups[${i}] is not an object` });
    const id = makeGroupId(String(rawGroup['id'] ?? ''));
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const layer = makeLayerId(String(rawGroup['layer'] ?? ''));
    if (!layer.ok) return err({ kind: 'invariant-violation', path, violation: layer.error });
    const label = optionalString(rawGroup['label']);
    if (label === undefined) return err({ kind: 'bad-shape', path, detail: `groups[${i}] needs a string label` });
    const declared = declareGroup(map, { id: id.value, label, layer: layer.value });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;
  }

  for (const [i, rawNode] of asArray(raw['nodes']).entries()) {
    if (!isRecord(rawNode)) return err({ kind: 'bad-shape', path, detail: `nodes[${i}] is not an object` });
    const id = makeNodeId(String(rawNode['id'] ?? ''));
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const layer = makeLayerId(String(rawNode['layer'] ?? ''));
    if (!layer.ok) return err({ kind: 'invariant-violation', path, violation: layer.error });
    const status = makeNodeStatus(String(rawNode['status'] ?? ''));
    if (!status.ok) return err({ kind: 'invariant-violation', path, violation: status.error });
    const label = optionalString(rawNode['label']);
    if (label === undefined) return err({ kind: 'bad-shape', path, detail: `nodes[${i}] needs a string label` });

    const detail = optionalString(rawNode['detail']);
    const rawGroup = optionalString(rawNode['group']);
    let group;
    if (rawGroup !== undefined) {
      const made = makeGroupId(rawGroup);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      group = made.value;
    }
    const rawNodeKind = optionalString(rawNode['kind']);
    let nodeKind;
    if (rawNodeKind !== undefined) {
      const made = makeNodeKind(rawNodeKind);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      nodeKind = made.value;
    }
    const rawLane = optionalString(rawNode['lane']);
    let lane;
    if (rawLane !== undefined) {
      const made = makeLaneId(rawLane);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      lane = made.value;
    }
    const rawSubmap = optionalString(rawNode['submap']);
    let submap;
    if (rawSubmap !== undefined) {
      const made = makeSubmapRef(rawSubmap);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      submap = made.value;
    }
    const declared = declareNode(map, {
      id: id.value,
      label,
      layer: layer.value,
      status: status.value,
      ...(detail !== undefined ? { detail } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(nodeKind !== undefined ? { kind: nodeKind } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(submap !== undefined ? { submap } : {}),
    });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;

    const evidence = optionalString(rawNode['evidence']);
    if (evidence !== undefined) {
      const updated = updateNode(map, { id: id.value, evidence });
      if (!updated.ok) return err({ kind: 'invariant-violation', path, violation: updated.error });
      map = updated.value;
    }
  }

  for (const [i, rawEdge] of asArray(raw['edges']).entries()) {
    if (!isRecord(rawEdge)) return err({ kind: 'bad-shape', path, detail: `edges[${i}] is not an object` });
    const from = makeNodeId(String(rawEdge['from'] ?? ''));
    if (!from.ok) return err({ kind: 'invariant-violation', path, violation: from.error });
    const to = makeNodeId(String(rawEdge['to'] ?? ''));
    if (!to.ok) return err({ kind: 'invariant-violation', path, violation: to.error });
    const linked = linkNodes(map, from.value, to.value, optionalString(rawEdge['label']));
    if (!linked.ok) return err({ kind: 'invariant-violation', path, violation: linked.error });
    map = linked.value;
  }

  return ok(map);
}

/** Serialize a map into the on-disk shape. Inverse of parseMap for valid maps (F1). */
export function serializeMap(map: MellosMap): string {
  const body = {
    version: STATE_FILE_VERSION,
    ...(map.title !== undefined ? { title: map.title } : {}),
    ...(map.kind !== undefined ? { kind: map.kind } : {}),
    layers: map.layers,
    ...(map.lanes.length > 0 ? { lanes: map.lanes } : {}),
    ...(map.groups.length > 0 ? { groups: map.groups } : {}),
    nodes: map.nodes,
    edges: map.edges,
  };
  return JSON.stringify(body, null, 2) + '\n';
}
