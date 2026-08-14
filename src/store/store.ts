/**
 * Layer 1b — Node-side persistence for a MellosMap.
 *
 * The state file IS the event bus of the whole plugin: the MCP server writes
 * it, the terminal watcher polls it. The file FORMAT (version, page-id
 * grammar, parse/serialize with boundary validation) lives in ./format.ts,
 * pure of I/O so browsers can consume it; this module owns everything that
 * touches the filesystem, and one promise:
 *
 *   P2. Writes are atomic: a reader polling the file either sees the previous
 *       complete map or the new complete map, never a torn write. Achieved by
 *       writing a sibling temp file and renaming it over the target.
 *
 * Expected failures (missing file, malformed JSON, invariant violations) are
 * Result values. Only truly unexpected I/O faults (permissions, disk) are
 * allowed to propagate as exceptions.
 *
 * Node consumers import everything from here; the format surface is
 * re-exported so persistence has one import site per runtime.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { type MellosMap, type Result, err, ok } from '../domain/types.js';
import { type PageId, type StoreError, makePageId, parseMap, serializeMap } from './format.js';

export {
  STATE_FILE_VERSION,
  type PageId,
  makePageId,
  type StoreError,
  describeStoreError,
  parseMap,
  serializeMap,
} from './format.js';

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

// ---------------------------------------------------------------------------
// focus requests — "show this page" messages from pane openers to the watcher
// ---------------------------------------------------------------------------
//
// State files flow one way, MCP server → watcher; a launcher that wants an
// ALREADY-RUNNING pane to show a particular page has no channel to it. The
// focus file is that channel, one-shot on purpose: the watcher consumes the
// request AND DELETES the file, so a request lives about one poll tick —
// nothing stale survives to misdirect tomorrow's pane, and the project's git
// status barely ever sees the file exist.

/** Sibling of the default file carrying a one-shot "show this page" request. */
export const FOCUS_FILE_NAME = 'mellos-mapping.focus';

export function focusFilePath(defaultFile: string): string {
  return join(dirname(defaultFile), FOCUS_FILE_NAME);
}

/** A consumed focus request: the page to show (undefined = the default page). */
export interface FocusRequest {
  readonly page: PageId | undefined;
}

/**
 * Consume a pending focus request: read it, delete the file, return it.
 * Absent file — the overwhelmingly common case — or junk content means no
 * request; the channel is best-effort and junk is swept by the same delete.
 */
export function takeFocusRequest(defaultFile: string): FocusRequest | undefined {
  const path = focusFilePath(defaultFile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    rmSync(path, { force: true });
  } catch {
    // deletion is a courtesy: re-consuming next tick is harmless because
    // switching to the already-shown page is a no-op
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const page = (parsed as { readonly page?: unknown }).page;
  if (page === undefined || page === null) return { page: undefined };
  if (typeof page !== 'string') return undefined;
  const id = makePageId(page);
  return id.ok ? { page: id.value } : undefined;
}


// ---------------------------------------------------------------------------
// mapping policy — WHEN the assistant should open a map, chosen by the user
// ---------------------------------------------------------------------------
//
// Plugin configuration, not map data: it never enters a MellosMap and the
// ledger never enforces it (the ledger is not a judge). It lives in its own
// sibling file so hand-editing or corrupting it can never touch a map.

/** Sibling of the default file holding the project's plugin configuration. */
export const CONFIG_FILE_NAME = 'mellos-mapping.config.json';

/** On-disk config format version. Bump only with a documented migration. */
export const CONFIG_FILE_VERSION = 1;

export function configFilePath(defaultFile: string): string {
  return join(dirname(defaultFile), CONFIG_FILE_NAME);
}

export const MAPPING_POLICIES = ['always', 'complex', 'on-request'] as const;

/** How eagerly maps are opened; 'complex' is the behavior of an unconfigured project. */
export type MappingPolicy = (typeof MAPPING_POLICIES)[number];

export interface InvalidPolicy {
  readonly kind: 'invalid-policy';
  readonly raw: string;
  readonly allowed: readonly string[];
}

export function makeMappingPolicy(raw: string): Result<MappingPolicy, InvalidPolicy> {
  return (MAPPING_POLICIES as readonly string[]).includes(raw)
    ? ok(raw as MappingPolicy)
    : err({ kind: 'invalid-policy', raw, allowed: MAPPING_POLICIES });
}

/** One line of meaning per policy — the wording every surface repeats. */
export function describeMappingPolicy(policy: MappingPolicy): string {
  switch (policy) {
    case 'always':
      return 'map every structured task — workflows, designs, architecture, technical dependencies';
    case 'complex':
      return 'map only medium or complex tasks — several modules, a new subsystem, roughly an hour or more';
    case 'on-request':
      return 'map only when the user explicitly asks';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The configured policy, or ok(undefined) when the project has never been
 * set up (missing file or missing key — both mean "nobody chose yet").
 * A file that exists but does not parse is an error, never silently ignored.
 */
export function loadMappingPolicy(defaultFile: string): Result<MappingPolicy | undefined, StoreError> {
  const path = configFilePath(defaultFile);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ok(undefined);
    throw e; // unexpected I/O fault: fail fast, nothing meaningful to recover here
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return err({ kind: 'malformed-json', path, detail: (e as Error).message });
  }
  if (!isRecord(raw)) return err({ kind: 'bad-shape', path, detail: 'root is not an object' });
  if (raw['version'] !== CONFIG_FILE_VERSION) {
    return err({ kind: 'bad-shape', path, detail: `version is ${String(raw['version'])}, expected ${CONFIG_FILE_VERSION}` });
  }
  const rawPolicy = raw['policy'];
  if (rawPolicy === undefined) return ok(undefined);
  if (typeof rawPolicy !== 'string') return err({ kind: 'bad-shape', path, detail: 'policy is not a string' });
  const policy = makeMappingPolicy(rawPolicy);
  return policy.ok
    ? ok(policy.value)
    : err({ kind: 'bad-shape', path, detail: `policy is "${rawPolicy}", expected one of: ${MAPPING_POLICIES.join(' | ')}` });
}

/** Persist the policy atomically (P2), same temp-and-rename as the map files. */
export function saveMappingPolicy(defaultFile: string, policy: MappingPolicy): void {
  const path = configFilePath(defaultFile);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ version: CONFIG_FILE_VERSION, policy }, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
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