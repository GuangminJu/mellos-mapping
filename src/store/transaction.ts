/** Cooperative, cross-process transactions for MCP and HTTP writers. */
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { serializeMap } from './format.js';
import { nativeLock } from './native-lock.js';
import type { MellosMap } from '../domain/types.js';

/** Viewer health must identify the writer protocol before a new client reuses it. */
export const STORE_LOCK_PROTOCOL = 'os-file-v1';

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

function checkLockPath(lock: string): void {
  const entry = lstatSync(lock, { throwIfNoEntry: false });
  if (entry?.isDirectory()) {
    throw new LedgerError('LOCK_MIGRATION_REQUIRED',
      `Legacy directory lock at ${lock}. Stop all old MCP servers, viewers and watchers for this project, then move that directory aside for inspection and retry. Never remove the new regular lock file.`,
      { path: lock });
  }
  if (entry && !entry.isFile()) {
    throw new LedgerError('LOCK_UNAVAILABLE', `Project lock must be a regular file, not a symlink or special file: ${lock}`, { path: lock });
  }
}

/**
 * A synchronous transaction on a permanent, independent OS lock file.
 * The action must finish synchronously; all cooperating writers use this entry.
 * Never unlink/rename this file: another opener must reach the same lock object.
 * Contention is BUSY immediately, with no timer, stale lease or PID recovery.
 */
export function withStoreLock<T>(file: string, action: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
  let backend;
  try { backend = nativeLock(); }
  catch (error) {
    throw new LedgerError('LOCK_UNAVAILABLE', `Cannot load the operating-system lock backend: ${error instanceof Error ? error.message : String(error)}`);
  }
  const dir = storeDirectory(file);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.write-lock');
  checkLockPath(lock);
  let fd: number;
  // a+ atomically opens/creates without truncation. At a legacy/new startup
  // race, either old mkdir wins (we refuse its directory), or our file wins
  // (old mkdir gets EEXIST and cannot find owner.json, so refuses to write).
  try { fd = openSync(lock, 'a+', 0o600); }
  catch (error) {
    checkLockPath(lock);
    throw new LedgerError('LOCK_UNAVAILABLE', `Cannot open project lock ${lock}: ${error instanceof Error ? error.message : String(error)}`, { path: lock });
  }
  let acquired = false;
  try {
    checkLockPath(lock);
    if (!fstatSync(fd).isFile()) throw new LedgerError('LOCK_UNAVAILABLE', `Project lock is not a regular file: ${lock}`);
    try { acquired = backend.tryLock(fd); }
    catch (error) {
      throw new LedgerError('LOCK_UNAVAILABLE', `Cannot acquire project lock ${lock}: ${error instanceof Error ? error.message : String(error)}`, { path: lock });
    }
    if (!acquired) throw new LedgerError('BUSY', `Another writer owns ${lock}; retry after it completes.`);
    return action();
  } finally {
    // Closing also releases this descriptor's lock if explicit unlock fails.
    // Cleanup must not misreport an already committed map as unsaved.
    try { if (acquired) backend.unlock(fd); }
    catch { warnLockCleanup(`Could not explicitly unlock ${lock}; closing its file handle.`); }
    finally {
      try { closeSync(fd); }
      catch { warnLockCleanup(`Could not close the project lock handle for ${lock}; restart this process before retrying writes.`); }
    }
  }
}

function warnLockCleanup(message: string): void {
  try { process.stderr.write(`mellos-mapping: ${message}\n`); } catch { /* Preserve the action's result. */ }
}
