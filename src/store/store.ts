/**
 * Layer 1b — Node-side persistence for a MellosMap.
 *
 * The state file IS the event bus of the whole plugin: the MCP server writes
 * it, the terminal watcher polls it — and the watcher reports back what it is
 * showing (see viewers below), which is how a writer can tell whether anybody
 * is actually SEEING the map it is updating. The file FORMAT (version, page-id
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

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
 * The directory a store lives in, under a project root or under a user's home.
 * It is tool-owned: the map belongs to mellos-mapping, not to whichever host
 * (Claude Code, Codex, a harness) happens to drive the server, so no host
 * brand appears in the path. Pre-0.20 stores under `.claude/` are moved once
 * by {@link migrateLegacyStore}.
 */
export const STORE_DIR_NAME = '.mellos';

/** Project-relative location of the DEFAULT page's state file. */
export const STATE_FILE_RELATIVE_PATH = join(STORE_DIR_NAME, 'map.json');

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
// viewers — "somebody is looking at this store" reports, from the panes
// ---------------------------------------------------------------------------
//
// The first channel that runs the OTHER way. focus and quit are messages TO a
// pane; this is a pane answering the question every other surface had to
// guess at, and mostly guessed wrong: is anyone actually SEEING this map?
//
// The guess was the bug. An assistant would declare a design, light nodes up
// as the work went, and report all of it into a store nobody had open —
// because opening the pane took a human typing `mmap`, and nothing in the
// system could tell that it had not happened. A map nobody can see is not a
// map; it is a file. So a pane now says it is there, and the launcher, the
// toggle and the MCP server read the same answer instead of inventing three.
//
// One file per pane, named by its pid: two panes on one store (a split and a
// dedicated window, `--force`) never clobber each other's report, and the
// name IS the identity, so nothing inside the payload repeats it.
//
// FRESHNESS IS THE FILE'S MTIME, and nothing else. A pane rewrites its report
// every VIEWER_HEARTBEAT_MS, so a report older than VIEWER_STALE_MS belongs
// to a pane that is gone — killed, closed with its window, or wedged. A
// timestamp INSIDE the payload would be a second truth about the same fact,
// free to disagree with the first; a pid checked for liveness would be worse
// still, because Windows recycles pids and a recycled one would report a
// phantom pane — exactly the lie this channel exists to end.

/** Directory (next to the default file) holding one report per live pane. */
export const VIEWERS_DIR_NAME = 'viewers';

/** On-disk report format version. Bump only with a documented migration. */
export const VIEWER_FILE_VERSION = 1;

/**
 * How often a pane refreshes its report — the pane's timer, and the unit the
 * two thresholds below are counted in.
 */
export const VIEWER_HEARTBEAT_MS = 1_000;

/**
 * A report older than this is not a pane, it is a pane's remains. Five missed
 * heartbeats: long enough to survive a garbage collection, a slow repaint or
 * a busy disk, short enough that a closed pane is known closed before anyone
 * asks twice.
 */
export const VIEWER_STALE_MS = 5_000;

/**
 * A report this old is deleted on sight by whoever reads it. A pane that was
 * killed leaves its file behind forever, and a file that outlives every pane
 * would keep answering for one. The gap to VIEWER_STALE_MS is deliberate
 * slack: a machine that just woke from sleep has stale reports whose panes
 * are alive and about to beat again, and there is no reason to make them pay
 * for the sleep with a deleted file.
 */
export const VIEWER_SWEEP_MS = 60_000;

/** Where a store's viewer reports live, given the default page's file path. */
export function viewersDirPath(defaultFile: string): string {
  return join(dirname(defaultFile), VIEWERS_DIR_NAME);
}

/** Where ONE pane's report lives. The pid in the name is the pane's identity. */
export function viewerFilePath(defaultFile: string, pid: number): string {
  return join(viewersDirPath(defaultFile), `${pid}.json`);
}

/** What a pane says about itself while it is up. */
export interface ViewerReport {
  /** The page on screen right now; undefined = the default page. */
  readonly page: PageId | undefined;
  /** Auto-follow: whether the pane will switch to whatever page is written next. */
  readonly follow: boolean;
}

/** A report fresh enough to be a pane, with whose it is and how old. */
export interface LiveViewer extends ViewerReport {
  readonly pid: number;
  /** Age of the report in ms — how long ago that pane last said anything. */
  readonly ageMs: number;
}

/**
 * The pid a viewer file name denotes, or undefined when the name is not one
 * of ours. Strict on purpose: the directory also holds the `*.tmp` files of
 * saves in flight (writeFileAtomic), and a temp read as a report would be a
 * pane that never existed.
 */
function viewerPidOf(fileName: string): number | undefined {
  const m = /^(\d+)\.json$/.exec(fileName);
  return m === null ? undefined : Number(m[1]);
}

/** Read one report's payload; undefined for anything that is not one. */
function parseViewerReport(raw: string): ViewerReport | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    return undefined; // a torn read from a foreign writer, or junk
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed['version'] !== VIEWER_FILE_VERSION) return undefined;
  const follow = parsed['follow'];
  if (typeof follow !== 'boolean') return undefined;
  const page = parsed['page'];
  if (page === null || page === undefined) return { page: undefined, follow };
  if (typeof page !== 'string') return undefined;
  const id = makePageId(page);
  return id.ok ? { page: id.value, follow } : undefined;
}

/**
 * Publish this pane's report, atomically (P2) — a reader polling the file
 * sees the previous whole report or the new one, never half of one.
 *
 * Preconditions: none; the viewers directory is created if missing.
 * Postcondition on ok: the pane's file holds `report` and its mtime is now,
 * which is what says the pane is alive. On error nothing about the pane is
 * claimed, and the next heartbeat is the whole recovery — so a caller reports
 * a failed beat at most once and keeps beating.
 */
export function publishViewer(defaultFile: string, pid: number, report: ViewerReport): Result<void, StoreError> {
  const body = { version: VIEWER_FILE_VERSION, page: report.page ?? null, follow: report.follow };
  return writeFileAtomic(viewerFilePath(defaultFile, pid), `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Take this pane's report back — the pane is going away and says so, rather
 * than leaving readers to wait out VIEWER_STALE_MS for the same conclusion.
 *
 * Best-effort by contract: an exit path is the worst place to raise, and a
 * report nobody could delete goes stale on its own within seconds.
 */
export function retireViewer(defaultFile: string, pid: number): void {
  try {
    rmSync(viewerFilePath(defaultFile, pid), { force: true });
  } catch {
    // The file outlives us by VIEWER_STALE_MS. That is the whole cost.
  }
}

/**
 * Every pane currently showing this store, youngest report first.
 *
 * @param nowMs - the caller's clock (Date.now()), passed in so the ageing
 *   rules can be tested without waiting for real seconds to pass.
 * @returns the live reports; an EMPTY array means nobody is seeing this map.
 *
 * Reading sweeps: a report past VIEWER_SWEEP_MS is deleted here, because the
 * pane that would have refreshed it is provably gone and no other code runs
 * often enough to notice. A report between stale and sweep is ignored but
 * kept — see VIEWER_SWEEP_MS. Nothing here has an opinion about WHOSE pane a
 * report is: a viewer started by hand counts exactly like one the launcher
 * opened, because the user can see both.
 */
export function readLiveViewers(defaultFile: string, nowMs: number): readonly LiveViewer[] {
  const dir = viewersDirPath(defaultFile);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no directory — no pane has ever run here, the common case
  }
  const live: LiveViewer[] = [];
  for (const name of names) {
    const pid = viewerPidOf(name);
    if (pid === undefined) continue;
    const path = join(dir, name);
    let raw: string;
    let ageMs: number;
    try {
      // stat BEFORE the read: a report that goes stale between the two calls
      // is merely counted a millisecond young, while the reverse order would
      // age every report by however long its read took.
      ageMs = Math.max(0, nowMs - statSync(path).mtimeMs);
      if (ageMs > VIEWER_SWEEP_MS) {
        rmSync(path, { force: true });
        continue;
      }
      if (ageMs > VIEWER_STALE_MS) continue;
      raw = readFileSync(path, 'utf8');
    } catch {
      continue; // vanished or unreadable under us: not a pane we can speak for
    }
    const report = parseViewerReport(raw);
    if (report !== undefined) live.push({ ...report, pid, ageMs });
  }
  return live.sort((a, b) => a.ageMs - b.ageMs || a.pid - b.pid);
}

// ---------------------------------------------------------------------------
// mapping policy — WHEN the assistant should open a map, chosen by the user
// ---------------------------------------------------------------------------
//
// Plugin configuration, not map data: it never enters a MellosMap and the
// ledger never enforces it (the ledger is not a judge). It lives in its own
// file so hand-editing or corrupting it can never touch a map.
//
// TWO SCOPES, one file format:
//
//   user    <home>/.mellos/config.json — the normal one. The question "when
//           should maps open?" is about how somebody works, not about a
//           particular repository, so it is asked ONCE, right after install,
//           and answered for every project they will ever open.
//   project <root>/.mellos/config.json — the override. A project that needs a
//           different answer from its owner's habit says so, and wins.
//
// PROJECT beats USER wherever both are set (effectiveMappingPolicy); neither
// set means nobody has chosen yet, which is the one state that still prompts.
// Both are read and written by the same pair of functions, which take the
// CONFIG FILE PATH — not a map path — precisely so neither scope can grow a
// loader of its own.

/** Name of the file holding a mapping-policy configuration, in either scope. */
export const CONFIG_FILE_NAME = 'config.json';

/** On-disk config format version. Bump only with a documented migration. */
export const CONFIG_FILE_VERSION = 1;

/** The PROJECT-scope configuration file: sibling of the default page. */
export function configFilePath(defaultFile: string): string {
  return join(dirname(defaultFile), CONFIG_FILE_NAME);
}

/**
 * The USER-scope configuration file: the same store directory name, under the
 * user's own base directory.
 *
 * @param userBase - the user's home directory. Always passed in, never read
 *   from the environment down here: a function that reached for os.homedir()
 *   itself would make every spec a gamble on the developer's real
 *   configuration, and one of them would eventually write it. Entry points
 *   resolve the home once and hand it down.
 */
export function userConfigFilePath(userBase: string): string {
  return join(userBase, STORE_DIR_NAME, CONFIG_FILE_NAME);
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
 * The policy recorded in ONE configuration file, or ok(undefined) when nobody
 * has chosen there (missing file or missing key — both mean the same thing).
 * A file that exists but does not parse is an error, never silently ignored.
 *
 * @param path - the configuration file itself: {@link configFilePath} for a
 *   project, {@link userConfigFilePath} for the user. One loader, two scopes.
 */
export function loadMappingPolicy(path: string): Result<MappingPolicy | undefined, StoreError> {
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
 * @param path - the configuration file to write; see {@link loadMappingPolicy}.
 * @returns ok when the file holds the policy; save-failed leaves the previous
 *   configuration in place.
 */
export function saveMappingPolicy(path: string, policy: MappingPolicy): Result<void, StoreError> {
  const body = JSON.stringify({ version: CONFIG_FILE_VERSION, policy }, null, 2) + '\n';
  return writeFileAtomic(path, body);
}

/** The two places a mapping policy can be recorded, in override order. */
export const POLICY_SCOPES = ['user', 'project'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

/** What both scopes say, and which of them actually governs. */
export interface MappingPolicyScopes {
  readonly project: MappingPolicy | undefined;
  readonly user: MappingPolicy | undefined;
  /** What to act on. undefined = nobody has chosen yet, anywhere. */
  readonly effective: MappingPolicy | undefined;
  /** Where `effective` came from; undefined exactly when `effective` is. */
  readonly source: PolicyScope | undefined;
}

/**
 * Resolve the policy that governs this project: the PROJECT file if it names
 * one, otherwise the USER file, otherwise nothing.
 *
 * Both scopes are reported, not just the winner — a surface that says "always"
 * without saying where it came from cannot tell a user why changing their
 * user-level choice did nothing here.
 *
 * @param projectConfigFile - see {@link configFilePath}.
 * @param userConfigFile - see {@link userConfigFilePath}.
 * @returns err as soon as EITHER file exists and is broken, project first: a
 *   configuration nobody can read is not the same as a configuration nobody
 *   wrote, and silently falling through to the other scope would act on a
 *   choice the user did not make.
 */
export function effectiveMappingPolicy(
  projectConfigFile: string,
  userConfigFile: string,
): Result<MappingPolicyScopes, StoreError> {
  const project = loadMappingPolicy(projectConfigFile);
  if (!project.ok) return project;
  const user = loadMappingPolicy(userConfigFile);
  if (!user.ok) return user;
  const effective = project.value ?? user.value;
  const source: PolicyScope | undefined =
    project.value !== undefined ? 'project' : user.value !== undefined ? 'user' : undefined;
  return ok({ project: project.value, user: user.value, effective, source });
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