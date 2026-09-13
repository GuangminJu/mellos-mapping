import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Result, err, ok } from '../domain/types.js';
import { type StoreError } from './format.js';
import { type PageId } from './format.js';
import { errnoOf } from './atomic.js';

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
