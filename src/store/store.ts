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
 *       writing a PRIVATE sibling temp file and renaming it over the target.
 *
 * The concurrency model P2 buys, stated plainly:
 *   - Several writers may target one project at once. Each save is atomic and
 *     lands whole, so a reader never sees half a map — but there is NO
 *     lost-update protection: two saves of the same page race, and the last
 *     rename wins, silently discarding what the other writer computed from an
 *     older read. Pages are the isolation unit (one effort = one page); two
 *     sessions that must not clobber each other belong on two pages.
 *   - The temp file carries the writer's pid and a random suffix, so
 *     concurrent writers never share one and never install each other's
 *     half-written content.
 *   - A rename can transiently fail while a reader holds the target open
 *     (EPERM/EBUSY on Windows), so it is retried with a short backoff before
 *     the save is reported as failed.
 *   - A page can also be DELETED (deletePageFile). Deletion races a writer
 *     the same way a save does, and the WRITER WINS: a save landing after it
 *     recreates the page. Stated at the function, not defended against.
 *
 * Expected failures (missing file, malformed JSON, invariant violations, a
 * write that would not land) are Result values. A failed save changed
 * nothing: the previous file content is intact and the caller may retry.
 * Only truly unexpected I/O faults on the READ path are allowed to propagate
 * as exceptions.
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

// ---------------------------------------------------------------------------
// atomic writes — the one primitive every save in this module is built on
// ---------------------------------------------------------------------------

/**
 * How many times a rename is attempted before the save is reported failed.
 * A reader's open handle blocks a rename on Windows for as long as it holds
 * the file; the watcher reads a page in well under a tick, so a handful of
 * attempts spans far more than any legitimate reader needs.
 */
const RENAME_MAX_ATTEMPTS = 10;

/** Backoff granularity: attempt N waits N * this, so ten attempts span ~450ms. */
const RENAME_BACKOFF_STEP_MS = 10;

/**
 * errno codes a rename can raise while the target is momentarily unavailable
 * — a reader holding it open (EPERM/EBUSY/EACCES on Windows) or an
 * antivirus/indexer briefly owning it (ENOENT between its own operations).
 * Anything else (ENOSPC, EROFS, ENOTDIR) is a real fault: retrying it only
 * delays the report.
 */
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT']);

/**
 * Block this thread for `ms`. The save path is synchronous by contract (the
 * MCP tool answers after the file is on disk), so the backoff must be too.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The failed write's leftover temp, removed on a best-effort basis. */
function discardTemp(tmp: string): void {
  try {
    rmSync(tmp, { force: true });
  } catch {
    // The temp is unreachable for the same reason the write failed; leaving
    // a stray *.tmp is strictly better than masking the original refusal.
  }
}

function errnoOf(e: unknown): string {
  return (e as NodeJS.ErrnoException).code ?? (e as Error).message;
}

/**
 * Write `contents` to `path` atomically (P2).
 *
 * Preconditions: none — the parent directory is created if missing.
 * Postcondition on ok: `path` holds exactly `contents` and no temp file
 * remains. Postcondition on error: `path` is untouched (it keeps its
 * previous content, or stays absent) and no temp file remains.
 *
 * The temp name is private to this call — `<path>.<pid>.<random>.tmp` — so
 * two writers racing on one page cannot install each other's partial content
 * or make each other's rename miss its file.
 */
function writeFileAtomic(path: string, contents: string): Result<void, StoreError> {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, contents, 'utf8');
  } catch (e) {
    discardTemp(tmp);
    return err({ kind: 'save-failed', path, detail: `writing the temp file failed: ${errnoOf(e)}` });
  }

  let attempt = 1;
  for (;;) {
    try {
      renameSync(tmp, path);
      return ok(undefined);
    } catch (e) {
      const code = errnoOf(e);
      if (!TRANSIENT_RENAME_CODES.has(code) || attempt >= RENAME_MAX_ATTEMPTS) {
        discardTemp(tmp);
        return err({ kind: 'save-failed', path, detail: `${code} after ${attempt} attempt(s)` });
      }
      sleepSync(attempt * RENAME_BACKOFF_STEP_MS);
      attempt += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// reading text that a human may have touched — shared by every load below
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Drop a leading UTF-8 byte-order mark. Windows editors (Notepad, some
 * PowerShell redirections) add one when a human edits a state file by hand,
 * and JSON.parse refuses the result — an invisible character would otherwise
 * read as "your map is corrupt". The BOM carries no meaning for us: the
 * files are UTF-8 by contract.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Project-relative location of the DEFAULT page's state file. The store lives
 * in the tool-owned `.mellos/` directory: the map belongs to mellos-mapping,
 * not to whichever host (Claude Code, Codex, a harness) happens to drive the
 * server, so no host brand appears in the path. Pre-0.20 stores under
 * `.claude/` are moved once by {@link migrateLegacyStore}.
 */
export const STATE_FILE_RELATIVE_PATH = join('.mellos', 'map.json');

// ---------------------------------------------------------------------------
// pages — a project may keep several maps side by side (one effort = one page)
// ---------------------------------------------------------------------------
//
// The default page IS the classic map.json. Named pages live in a sibling
// directory, one file each: file-per-page keeps concurrent sessions isolated —
// two writers on two pages can never clobber each other, because every save
// renames a whole file.

/** Directory (next to the default file) holding the named pages. */
export const PAGES_DIR_NAME = 'pages';

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

/**
 * Delete one page's file — a named page, or the DEFAULT page (whose file is
 * optional by design, so removing it is a legal state, not a mutilation).
 *
 * Preconditions: none. Postcondition on ok: no file at `path` — an already
 * absent one is ok too, because the goal state is what is promised, not the
 * act. Postcondition on error: the file is still there and the caller may
 * retry or report; the errno is carried in the detail.
 *
 * Concurrency, stated plainly: deletion races a concurrent writer and THE
 * WRITER WINS. A server saving that page while this runs simply recreates the
 * file (its rename is atomic and needs no existing target), so the page comes
 * back. That is accepted rather than defended against — the store has no
 * lost-update protection anywhere (see the module header), and locking one
 * operation would only make the race rarer, never absent, while claiming
 * otherwise. Pages are the isolation unit: nobody deletes a page another
 * session is writing.
 *
 * What it deliberately does NOT do: sweep `<path>.<pid>.<random>.tmp`
 * siblings. Those temps are private to a save IN FLIGHT, and a live writer
 * whose temp vanished would fail its rename — turning a harmless leftover
 * into a broken save. A stray temp only exists when a write failed AND its
 * own cleanup failed; it is inert, and the README documents it.
 */
export function deletePageFile(path: string): Result<void, StoreError> {
  try {
    // force: an absent file is the goal state already, not a failure.
    // No `recursive`: a DIRECTORY where a page file belongs is a fault to
    // report, never a tree to erase.
    rmSync(path, { force: true });
    return ok(undefined);
  } catch (e) {
    return err({ kind: 'delete-failed', path, detail: errnoOf(e) });
  }
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
export const FOCUS_FILE_NAME = 'focus';

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
// quit requests — "close yourself" messages from the toggle to the watcher
// ---------------------------------------------------------------------------
//
// The mirror of the focus file, and there for the same reason: a human who
// types `mmap` in some OTHER terminal has no channel to the pane that is
// already running. The quit file is that channel, one-shot on purpose — the
// watcher consumes the request AND DELETES the file, so a request lives about
// one poll tick and nothing stale survives to close tomorrow's pane.
//
// The request carries no payload. A pane belongs to one store, so "close the
// pane watching this store" has nothing to say beyond being asked.

/** Sibling of the default file carrying a one-shot "close the pane" request. */
export const QUIT_FILE_NAME = 'quit';

export function quitFilePath(defaultFile: string): string {
  return join(dirname(defaultFile), QUIT_FILE_NAME);
}

/**
 * Consume a pending quit request: read it, delete the file, say whether there
 * was one. Absent file — the overwhelmingly common case — or content that is
 * not a JSON object means NO request; the channel is best-effort and junk is
 * swept by the same delete.
 *
 * The empty JSON object is the whole grammar. It exists so that a stray file
 * of this name — an editor backup, a half-written write from a foreign tool —
 * cannot take a live pane down by accident; a pane closing is the one thing
 * in this channel a user cannot undo by waiting.
 */
export function takeQuitRequest(defaultFile: string): boolean {
  const path = quitFilePath(defaultFile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  sweepQuitRequest(defaultFile);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    return false;
  }
  return isRecord(parsed);
}

/**
 * Delete a quit request WITHOUT acting on it — the same file, read as a
 * leftover rather than as a message.
 *
 * A toggle that wrote the request and then lost its watcher (a crash, a
 * closed window, a `taskkill`) leaves the file behind, and the next pane to
 * open would consume it on its first tick and close instantly. The watcher
 * sweeps at STARTUP for exactly that: a request that predates the pane cannot
 * have been addressed to it. Best-effort, like every delete in this channel.
 */
export function sweepQuitRequest(defaultFile: string): void {
  try {
    rmSync(quitFilePath(defaultFile), { force: true });
  } catch {
    // The file is unreachable for some reason the next tick will meet again;
    // re-consuming a request we cannot delete only closes a pane the user
    // asked to close.
  }
}

// ---------------------------------------------------------------------------
// mapping policy — WHEN the assistant should open a map, chosen by the user
// ---------------------------------------------------------------------------
//
// Plugin configuration, not map data: it never enters a MellosMap and the
// ledger never enforces it (the ledger is not a judge). It lives in its own
// sibling file so hand-editing or corrupting it can never touch a map.

/** Sibling of the default file holding the project's plugin configuration. */
export const CONFIG_FILE_NAME = 'config.json';

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
    raw = JSON.parse(stripBom(text));
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

/**
 * Persist the policy atomically (P2), same write as the map files.
 * @returns ok when the file holds the policy; save-failed leaves the previous
 *   configuration in place.
 */
export function saveMappingPolicy(defaultFile: string, policy: MappingPolicy): Result<void, StoreError> {
  const body = JSON.stringify({ version: CONFIG_FILE_VERSION, policy }, null, 2) + '\n';
  return writeFileAtomic(configFilePath(defaultFile), body);
}

// ---------------------------------------------------------------------------
// legacy migration — stores written under the old host-coupled location
// ---------------------------------------------------------------------------
//
// Up to 0.19 the store lived in `.claude/mellos-mapping.*`: the map's home
// was coupled to one host brand, which turned absurd the moment another host
// (a harness, Codex) drove the same server. The move is one-time and
// explicit — entry points call it before touching the store; nothing here
// runs as a hidden side effect of ordinary loads.

/** Project-relative location of the pre-0.20 default page file. */
export const LEGACY_STATE_FILE_RELATIVE_PATH = join('.claude', 'mellos-mapping.json');
const LEGACY_PAGES_DIR_NAME = 'mellos-mapping.pages';
const LEGACY_CONFIG_FILE_NAME = 'mellos-mapping.config.json';

/**
 * Move a legacy `.claude` store — map, pages, and mapping-policy config —
 * into the tool-owned `.mellos` location. Never merges: a project whose new
 * store already holds anything keeps it untouched, whatever the legacy
 * directory still contains.
 * @param defaultFile - the NEW default page path (`<root>/.mellos/map.json`);
 *   the legacy store is looked up relative to `<root>`.
 * @returns whether a legacy store was moved.
 */
export function migrateLegacyStore(defaultFile: string): boolean {
  const projectRoot = dirname(dirname(defaultFile));
  const legacyDefault = join(projectRoot, LEGACY_STATE_FILE_RELATIVE_PATH);
  const legacyPages = join(dirname(legacyDefault), LEGACY_PAGES_DIR_NAME);
  const legacyConfig = join(dirname(legacyDefault), LEGACY_CONFIG_FILE_NAME);
  const hasLegacy = existsSync(legacyDefault) || existsSync(legacyPages) || existsSync(legacyConfig);
  const hasCurrent = existsSync(defaultFile)
    || existsSync(join(dirname(defaultFile), PAGES_DIR_NAME))
    || existsSync(configFilePath(defaultFile));
  if (!hasLegacy || hasCurrent) return false;
  mkdirSync(dirname(defaultFile), { recursive: true });
  if (existsSync(legacyDefault)) renameSync(legacyDefault, defaultFile);
  if (existsSync(legacyPages)) renameSync(legacyPages, join(dirname(defaultFile), PAGES_DIR_NAME));
  if (existsSync(legacyConfig)) renameSync(legacyConfig, configFilePath(defaultFile));
  return true;
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
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    // Expected at this boundary: hand-edited files, or a reader racing a
    // non-atomic writer from a foreign tool.
    return err({ kind: 'malformed-json', path, detail: (e as Error).message });
  }

  return parseMap(raw, path);
}

/**
 * Write the map to `path` atomically (P2): serialize to a private sibling
 * temp file, then rename it over the target, retrying a rename the OS
 * refuses transiently. Creates the parent directory if missing.
 * @returns ok when the file holds the new map; save-failed when it does not,
 *   in which case the previous content is intact and the call may be retried.
 */
export function saveMapFile(path: string, map: MellosMap): Result<void, StoreError> {
  return writeFileAtomic(path, serializeMap(map));
}