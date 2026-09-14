/** Cooperative, cross-process transactions for MCP and HTTP writers. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    if (!deadOwner(lock)) { rmSync(join(lock, '.reap'), { recursive: true, force: true }); throw new LedgerError('BUSY', 'Writer ownership changed.'); }
    rmSync(lock, { recursive: true });
    try { mkdirSync(lock); } catch { throw new LedgerError('BUSY', 'Another writer acquired the recovered lock.'); }
  }
  let initialized = false;
  try {
    writeFileSync(owner, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    initialized = true;
    return action();
  } finally {
    // Only remove the directory still owned by this invocation.
    try { if (!initialized || (JSON.parse(readFileSync(owner, 'utf8')) as { token: string }).token === token) rmSync(lock, { recursive: true }); }
    catch { /* A cleanup error must not misreport a successfully committed map as unsaved. */ }
  }
}
