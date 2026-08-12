/**
 * Layer 1 — persistence for a MellosMap.
 *
 * The state file IS the event bus of the whole plugin: the MCP server writes
 * it, the terminal watcher polls it. This layer owns exactly two promises:
 *
 *   P1. Whatever is loaded satisfies the structural invariants of Layer 0.
 *       Parsing is done by REPLAYING the raw data through the domain
 *       operations, so a hand-edited or corrupted file can never smuggle an
 *       invariant violation into the process (validate at the boundary,
 *       trust internal code afterwards).
 *   P2. Writes are atomic: a reader polling the file either sees the previous
 *       complete map or the new complete map, never a torn write. Achieved by
 *       writing a sibling temp file and renaming it over the target.
 *
 * Expected failures (missing file, malformed JSON, invariant violations) are
 * Result values. Only truly unexpected I/O faults (permissions, disk) are
 * allowed to propagate as exceptions.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { declareGroup, declareLayer, declareNode, linkNodes, setTitle, updateNode } from '../domain/ops.js';
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
  makeLayerId,
  makeNodeId,
  makeNodeStatus,
  ok,
} from '../domain/types.js';

/** On-disk format version. Bump only with a documented migration. */
export const STATE_FILE_VERSION = 1;

/** Project-relative location of the DEFAULT page's state file. */
export const STATE_FILE_RELATIVE_PATH = join('.claude', 'mellos-mapping.json');

// ---------------------------------------------------------------------------
// pages — a project may keep several maps side by side (one effort = one page)
// ---------------------------------------------------------------------------
//
// The default page IS the classic mellos-mapping.json, so existing maps stay
// where they are. Named pages live in a sibling directory, one file each:
// file-per-page keeps concurrent sessions isolated — two writers on two pages
// can never clobber each other, because every save renames a whole file.

/** Directory (next to the default file) holding the named pages. */
export const PAGES_DIR_NAME = 'mellos-mapping.pages';

export type PageId = string & { readonly __brand: 'PageId' };

export function makePageId(raw: string): Result<PageId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as PageId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

/** Where a page's map file lives, given the default page's file path. */
export function pageFilePath(defaultFile: string, page?: PageId): string {
  return page === undefined ? defaultFile : join(dirname(defaultFile), PAGES_DIR_NAME, `${page}.json`);
}

/** The page id a file path denotes; undefined = the default page. */
export function pageIdOfFile(defaultFile: string, path: string): PageId | undefined {
  if (path === defaultFile) return undefined;
  const name = basename(path);
  return name.endsWith('.json') ? (name.slice(0, -'.json'.length) as PageId) : (name as PageId);
}

/** Existing page files: the default page first (when present), then named pages sorted by slug. */
export function listPageFiles(defaultFile: string): string[] {
  const out: string[] = [];
  if (existsSync(defaultFile)) out.push(defaultFile);
  let entries: string[] = [];
  try {
    entries = readdirSync(join(dirname(defaultFile), PAGES_DIR_NAME));
  } catch {
    // no pages directory — a single-page project, the common case
  }
  for (const e of entries.sort()) {
    if (e.endsWith('.json')) out.push(join(dirname(defaultFile), PAGES_DIR_NAME, e));
  }
  return out;
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
 * order (layers -> groups -> nodes -> edges) supplies the required
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
    const declared = declareNode(map, {
      id: id.value,
      label,
      layer: layer.value,
      status: status.value,
      ...(detail !== undefined ? { detail } : {}),
      ...(group !== undefined ? { group } : {}),
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
    const linked = linkNodes(map, from.value, to.value);
    if (!linked.ok) return err({ kind: 'invariant-violation', path, violation: linked.error });
    map = linked.value;
  }

  return ok(map);
}

/** Serialize a map into the on-disk shape. Inverse of parseMap for valid maps. */
export function serializeMap(map: MellosMap): string {
  const body = {
    version: STATE_FILE_VERSION,
    ...(map.title !== undefined ? { title: map.title } : {}),
    layers: map.layers,
    ...(map.groups.length > 0 ? { groups: map.groups } : {}),
    nodes: map.nodes,
    edges: map.edges,
  };
  return JSON.stringify(body, null, 2) + '\n';
}

/** Load and validate the map file at `path`. */
export function loadMapFile(path: string): Result<MellosMap, StoreError> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return err({ kind: 'not-found', path });
    throw e; // unexpected I/O fault: fail fast, nothing meaningful to recover here
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Expected at this boundary: hand-edited files, or a reader racing a
    // non-atomic writer from a foreign tool.
    return err({ kind: 'malformed-json', path, detail: (e as Error).message });
  }

  return parseMap(raw, path);
}

/**
 * Write the map to `path` atomically (P2): serialize to `<path>.tmp` in the
 * same directory, then rename over the target. Creates the parent directory
 * if missing.
 */
export function saveMapFile(path: string, map: MellosMap): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, serializeMap(map), 'utf8');
  renameSync(tmp, path);
}
