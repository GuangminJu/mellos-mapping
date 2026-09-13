import { readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Result } from '../domain/types.js';
import { type StoreError } from './format.js';
import { type PageId, makePageId } from './format.js';
import { writeAtomic } from './atomic.js';
import { isRecord, stripBom } from './json-text.js';

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
  /** Launching console identity, or "window" for an explicitly separate pane. */
  readonly owner?: string;
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
  const owner = parsed['owner'];
  if (owner !== undefined && (typeof owner !== 'string' || !makePageId(owner).ok)) return undefined;
  const binding = owner === undefined ? {} : { owner: owner as string };
  const page = parsed['page'];
  if (page === null || page === undefined) return { page: undefined, follow, ...binding };
  if (typeof page !== 'string') return undefined;
  const id = makePageId(page);
  return id.ok ? { page: id.value, follow, ...binding } : undefined;
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
  const body = { version: VIEWER_FILE_VERSION, page: report.page ?? null, follow: report.follow, owner: report.owner };
  // This disposable report runs on the input thread every second. A locked
  // target keeps its previous complete report; the next heartbeat retries.
  return writeAtomic(viewerFilePath(defaultFile, pid), `${JSON.stringify(body, null, 2)}\n`, 1);
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
