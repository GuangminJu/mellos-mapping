/** Frozen 0.24.0 directory/owner lock algorithm; only TypeScript types removed.
 * Test-only compatibility fixture. Never shipped or used by the current store.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

class LedgerError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function storeDirectory(file) {
  const dir = dirname(file);
  return dir.endsWith('/pages') || dir.endsWith('\\pages') ? dirname(dir) : dir;
}

function deadOwner(lock) {
  try {
    const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (e) { return e.code === 'ESRCH'; }
  } catch { return false; }
}

export function withStoreLock(file, action) {
  const dir = storeDirectory(file);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.write-lock');
  const owner = join(lock, 'owner.json');
  const token = randomUUID();
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
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
    try { if (!initialized || JSON.parse(readFileSync(owner, 'utf8')).token === token) rmSync(lock, { recursive: true }); }
    catch { /* Preserve the exact legacy cleanup behavior. */ }
  }
}
