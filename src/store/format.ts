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
 *       The shape is read STRICTLY: a wrong type is refused, never coerced
 *       and never quietly dropped. The reason is that the store round-trips —
 *       a lenient read of `{"nodes": {...}}` as "no nodes" would be written
 *       back by the next save, so leniency here does not tolerate a damaged
 *       file, it destroys one.
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
  makeRank,
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
  | { readonly kind: 'invariant-violation'; readonly path: string; readonly violation: MapError }
  /** A write that did not land. The file still holds its previous content. */
  | { readonly kind: 'save-failed'; readonly path: string; readonly detail: string };

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
    case 'save-failed':
      return `could not write ${e.path}: ${e.detail}`;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** How a refused value is named in a bad-shape detail. */
function describeValue(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

function badShape(path: string, where: string, expected: string, got: unknown): Result<never, StoreError> {
  return err({ kind: 'bad-shape', path, detail: `${where} is ${describeValue(got)}, expected ${expected}` });
}

/**
 * A list field of the file.
 * @param presence - 'optional' lets the KEY be absent (an unused feature
 *   writes no key at all); a present non-array is refused either way.
 *
 * Coercing a non-array to an empty list is the one shape mistake this
 * boundary must never make: `{"nodes": {...}}` would parse as a map with no
 * nodes, and the next save would write that empty interpretation over the
 * file — the boundary erasing the data it exists to protect.
 */
function arrayField(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  presence: 'required' | 'optional',
): Result<readonly unknown[], StoreError> {
  const v = raw[key];
  if (Array.isArray(v)) return ok(v);
  if (v === undefined && presence === 'optional') return ok([]);
  return badShape(path, `"${key}"`, 'an array', v);
}

/** A field that must be a string. Numbers and booleans are refused, never coerced. */
function requiredString(
  rec: Record<string, unknown>,
  key: string,
  where: string,
  path: string,
): Result<string, StoreError> {
  const v = rec[key];
  return typeof v === 'string' ? ok(v) : badShape(path, `${where}.${key}`, 'a string', v);
}

/** A field that may be absent, but must be a string when present — never dropped for being the wrong type. */
function optionalString(
  rec: Record<string, unknown>,
  key: string,
  where: string,
  path: string,
): Result<string | undefined, StoreError> {
  const v = rec[key];
  if (v === undefined) return ok(undefined);
  return typeof v === 'string' ? ok(v) : badShape(path, `${where}.${key}`, 'a string', v);
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

  const layers = arrayField(raw, 'layers', path, 'required');
  if (!layers.ok) return layers;
  const nodes = arrayField(raw, 'nodes', path, 'required');
  if (!nodes.ok) return nodes;
  const edges = arrayField(raw, 'edges', path, 'required');
  if (!edges.ok) return edges;
  const lanes = arrayField(raw, 'lanes', path, 'optional');
  if (!lanes.ok) return lanes;
  const groups = arrayField(raw, 'groups', path, 'optional');
  if (!groups.ok) return groups;

  let map = EMPTY_MAP;
  const title = optionalString(raw, 'title', 'map', path);
  if (!title.ok) return title;
  if (title.value !== undefined) map = setTitle(map, title.value);
  const rawKind = optionalString(raw, 'kind', 'map', path);
  if (!rawKind.ok) return rawKind;
  if (rawKind.value !== undefined) {
    const kind = makeMapKind(rawKind.value);
    if (!kind.ok) return err({ kind: 'invariant-violation', path, violation: kind.error });
    map = setKind(map, kind.value);
  }

  for (const [i, rawLayer] of layers.value.entries()) {
    const where = `layers[${i}]`;
    if (!isRecord(rawLayer)) return badShape(path, where, 'an object', rawLayer);
    const rawId = requiredString(rawLayer, 'id', where, path);
    if (!rawId.ok) return rawId;
    const id = makeLayerId(rawId.value);
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const name = requiredString(rawLayer, 'name', where, path);
    if (!name.ok) return name;
    const rawRank = rawLayer['rank'];
    if (typeof rawRank !== 'number') return badShape(path, `${where}.rank`, 'a number', rawRank);
    // The RANGE and integrality of a rank are the domain's rule (makeRank),
    // never restated here: a file the format accepted but the domain refuses
    // is exactly the drift this boundary exists to prevent.
    const rank = makeRank(rawRank);
    if (!rank.ok) return err({ kind: 'invariant-violation', path, violation: rank.error });
    const next = declareLayer(map, { id: id.value, name: name.value, rank: rank.value });
    if (!next.ok) return err({ kind: 'invariant-violation', path, violation: next.error });
    map = next.value;
  }

  for (const [i, rawLane] of lanes.value.entries()) {
    const where = `lanes[${i}]`;
    if (!isRecord(rawLane)) return badShape(path, where, 'an object', rawLane);
    const rawId = requiredString(rawLane, 'id', where, path);
    if (!rawId.ok) return rawId;
    const id = makeLaneId(rawId.value);
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const label = requiredString(rawLane, 'label', where, path);
    if (!label.ok) return label;
    const declared = declareLane(map, { id: id.value, label: label.value });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;
  }

  for (const [i, rawGroup] of groups.value.entries()) {
    const where = `groups[${i}]`;
    if (!isRecord(rawGroup)) return badShape(path, where, 'an object', rawGroup);
    const rawId = requiredString(rawGroup, 'id', where, path);
    if (!rawId.ok) return rawId;
    const id = makeGroupId(rawId.value);
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const rawLayer = requiredString(rawGroup, 'layer', where, path);
    if (!rawLayer.ok) return rawLayer;
    const layer = makeLayerId(rawLayer.value);
    if (!layer.ok) return err({ kind: 'invariant-violation', path, violation: layer.error });
    const label = requiredString(rawGroup, 'label', where, path);
    if (!label.ok) return label;
    const declared = declareGroup(map, { id: id.value, label: label.value, layer: layer.value });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;
  }

  for (const [i, rawNode] of nodes.value.entries()) {
    const where = `nodes[${i}]`;
    if (!isRecord(rawNode)) return badShape(path, where, 'an object', rawNode);
    const rawId = requiredString(rawNode, 'id', where, path);
    if (!rawId.ok) return rawId;
    const id = makeNodeId(rawId.value);
    if (!id.ok) return err({ kind: 'invariant-violation', path, violation: id.error });
    const rawLayer = requiredString(rawNode, 'layer', where, path);
    if (!rawLayer.ok) return rawLayer;
    const layer = makeLayerId(rawLayer.value);
    if (!layer.ok) return err({ kind: 'invariant-violation', path, violation: layer.error });
    const rawStatus = requiredString(rawNode, 'status', where, path);
    if (!rawStatus.ok) return rawStatus;
    const status = makeNodeStatus(rawStatus.value);
    if (!status.ok) return err({ kind: 'invariant-violation', path, violation: status.error });
    const label = requiredString(rawNode, 'label', where, path);
    if (!label.ok) return label;

    const detail = optionalString(rawNode, 'detail', where, path);
    if (!detail.ok) return detail;
    const rawGroup = optionalString(rawNode, 'group', where, path);
    if (!rawGroup.ok) return rawGroup;
    let group;
    if (rawGroup.value !== undefined) {
      const made = makeGroupId(rawGroup.value);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      group = made.value;
    }
    const rawNodeKind = optionalString(rawNode, 'kind', where, path);
    if (!rawNodeKind.ok) return rawNodeKind;
    let nodeKind;
    if (rawNodeKind.value !== undefined) {
      const made = makeNodeKind(rawNodeKind.value);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      nodeKind = made.value;
    }
    const rawLane = optionalString(rawNode, 'lane', where, path);
    if (!rawLane.ok) return rawLane;
    let lane;
    if (rawLane.value !== undefined) {
      const made = makeLaneId(rawLane.value);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      lane = made.value;
    }
    const rawSubmap = optionalString(rawNode, 'submap', where, path);
    if (!rawSubmap.ok) return rawSubmap;
    let submap;
    if (rawSubmap.value !== undefined) {
      const made = makeSubmapRef(rawSubmap.value);
      if (!made.ok) return err({ kind: 'invariant-violation', path, violation: made.error });
      submap = made.value;
    }
    const declared = declareNode(map, {
      id: id.value,
      label: label.value,
      layer: layer.value,
      status: status.value,
      ...(detail.value !== undefined ? { detail: detail.value } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(nodeKind !== undefined ? { kind: nodeKind } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(submap !== undefined ? { submap } : {}),
    });
    if (!declared.ok) return err({ kind: 'invariant-violation', path, violation: declared.error });
    map = declared.value;

    const evidence = optionalString(rawNode, 'evidence', where, path);
    if (!evidence.ok) return evidence;
    if (evidence.value !== undefined) {
      const updated = updateNode(map, { id: id.value, evidence: evidence.value });
      if (!updated.ok) return err({ kind: 'invariant-violation', path, violation: updated.error });
      map = updated.value;
    }
  }

  for (const [i, rawEdge] of edges.value.entries()) {
    const where = `edges[${i}]`;
    if (!isRecord(rawEdge)) return badShape(path, where, 'an object', rawEdge);
    const rawFrom = requiredString(rawEdge, 'from', where, path);
    if (!rawFrom.ok) return rawFrom;
    const from = makeNodeId(rawFrom.value);
    if (!from.ok) return err({ kind: 'invariant-violation', path, violation: from.error });
    const rawTo = requiredString(rawEdge, 'to', where, path);
    if (!rawTo.ok) return rawTo;
    const to = makeNodeId(rawTo.value);
    if (!to.ok) return err({ kind: 'invariant-violation', path, violation: to.error });
    const label = optionalString(rawEdge, 'label', where, path);
    if (!label.ok) return label;
    const linked = linkNodes(map, from.value, to.value, label.value);
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
