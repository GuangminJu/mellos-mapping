import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Result, err, ok } from '../domain/types.js';
import { type StoreError } from './format.js';

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

export function errnoOf(e: unknown): string {
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
export function writeFileAtomic(path: string, contents: string): Result<void, StoreError> {
  return writeAtomic(path, contents, RENAME_MAX_ATTEMPTS);
}

/** A heartbeat may yield to the next tick; an authoritative save must retry. */
export function writeAtomic(path: string, contents: string, maxAttempts: number): Result<void, StoreError> {
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
      if (!TRANSIENT_RENAME_CODES.has(code) || attempt >= maxAttempts) {
        discardTemp(tmp);
        return err({ kind: 'save-failed', path, detail: `${code} after ${attempt} attempt(s)` });
      }
      sleepSync(attempt * RENAME_BACKOFF_STEP_MS);
      attempt += 1;
    }
  }
}
