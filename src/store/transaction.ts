/** Cooperative, cross-process transactions for MCP and HTTP writers. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { serializeMap } from './format.js';
import type { MellosMap } from '../domain/types.js';

export class LedgerError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}
export const revisionOf = (map: MellosMap): string => createHash('sha256').update(serializeMap(map)).digest('hex');
export function assertRevision(actual: string, expected?: string): void {
  if (expected !== undefined && expected !== actual) throw new LedgerError('CONFLICT', 'Map changed; read the current revision before retrying.', { expectedRevision: expected, actualRevision: actual });
}

/** A named page and the default page share the same project lock. */
export function storeDirectory(file: string): string {
  const dir = dirname(file);
  return dir.endsWith('/pages') || dir.endsWith('\\pages') ? dirname(dir) : dir;
}

function deadOwner(lock: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as { pid?: number };
    if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0) return false;
    try { process.kill(owner.pid!, 0); return false; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
  } catch { return false; }
}

/**
 * Delete a lock directory, whether or not `rmSync` is telling the truth.
 *
 * On Windows, a recursive `rmSync` can report success and delete NOTHING:
 * nodejs/node#65578 reports it for every Node from 23.0.0 up to 24.13.0 the
 * moment any path segment is non-ASCII, and 24.14.0 is the first release we
 * measured clean. An empty directory is enough to show it, and `force`,
 * retrying and waiting all change nothing, while the manual walk below does
 * remove it — the same issue notes `unlinkSync`/`rmdirSync` keep working on
 * exactly the paths `rm`/`rmSync` fail. Trusting the return value there leaves the lock directory
 * behind, and a lock directory that outlives its owner is a project nobody
 * can write to again: this process sees its own live pid and answers BUSY,
 * and every later one fails to recover the same directory. So the removal is
 * verified rather than assumed.
 *
 * @param lock - the lock directory to remove.
 * @returns whether the directory is gone afterwards.
 */
function removeLockTree(lock: string): boolean {
  try { rmSync(lock, { recursive: true, force: true }); } catch { /* the walk below still gets its chance */ }
  if (existsSync(lock)) {
    try {
      /** Depth-first, because a directory only goes once it is empty. */
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path); else unlinkSync(path);
        }
        rmdirSync(dir);
      };
      walk(lock);
    } catch { /* reported to the caller through the result */ }
  }
  return !existsSync(lock);
}

/** No timed polling: contention is an explicit retryable BUSY result. Never steal a live lock. */
export function withStoreLock<T>(file: string, action: () => T): T {
  const dir = storeDirectory(file);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.write-lock');
  const owner = join(lock, 'owner.json');
  const token = randomUUID();
  try { mkdirSync(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Reapers serialize inside the old directory and recheck its owner after acquiring.
    // Missing/invalid owners are deliberately not reclaimed on an age heuristic.
    if (!deadOwner(lock)) throw new LedgerError('BUSY', `Another writer owns ${lock}; retry after it completes. An orphan without owner metadata needs manual inspection.`);
    try { mkdirSync(join(lock, '.reap')); }
    catch { throw new LedgerError('BUSY', 'Another process is recovering the writer lock.'); }
    if (!deadOwner(lock)) { removeLockTree(join(lock, '.reap')); throw new LedgerError('BUSY', 'Writer ownership changed.'); }
    removeLockTree(lock);
    try { mkdirSync(lock); } catch { throw new LedgerError('BUSY', 'Another writer acquired the recovered lock.'); }
  }
  let initialized = false;
  try {
    writeFileSync(owner, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    initialized = true;
    return action();
  } finally {
    // Only remove the directory still owned by this invocation.
    try {
      if (!initialized || (JSON.parse(readFileSync(owner, 'utf8')) as { token: string }).token === token) {
        // A cleanup error must not misreport a successfully committed map as
        // unsaved, so this stays non-fatal — but it is never silent: a lock
        // that could not be removed makes every later write answer BUSY.
        if (!removeLockTree(lock)) process.stderr.write(`mellos-mapping: could not remove ${lock}; writes will report BUSY until it is deleted by hand.\n`);
      }
    } catch { /* the map is committed either way */ }
  }
}
