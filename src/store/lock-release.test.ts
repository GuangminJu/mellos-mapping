/**
 * Spec for the one cleanup failure that costs a project its writability: a
 * lock directory that outlives the invocation that owns it.
 *
 * node's recursive `rmSync` is faked here (and only here) because the real
 * fault belongs to Node, not to this project: on Windows, when any path
 * segment is non-ASCII, `rm`/`rmSync` report success and delete NOTHING from
 * 23.0.0 through 24.13.0 (nodejs/node#65578 — an empty directory is enough to
 * show it, and `force`, retrying and waiting change nothing), while
 * `unlinkSync`/`rmdirSync` keep working on exactly those paths. No test can
 * make an installed Node behave that way on demand, so the fault is injected;
 * everything the fix falls back to afterwards is the real filesystem.
 *
 * What is specified: the lock is released anyway, the project stays writable,
 * genuine contention still says BUSY, and a lock that truly cannot be removed
 * is announced rather than swallowed.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Injected Node fault state. */
const fault = vi.hoisted(() => ({
  /** true = a recursive `rmSync` reports success and removes nothing. */
  silentRm: true,
  /** true = the manual unlink/rmdir walk fails too, so the lock really is stuck. */
  breakWalk: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const refuse = (): never => {
    const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
    error.code = 'EPERM';
    throw error;
  };
  return {
    ...real,
    // The bug under test: success reported, nothing deleted.
    rmSync: (path: any, options?: any) => {
      if (fault.silentRm && options && typeof options === 'object' && options.recursive) return;
      real.rmSync(path, options);
    },
    unlinkSync: (path: any) => { if (fault.breakWalk) refuse(); real.unlinkSync(path); },
    rmdirSync: (path: any) => { if (fault.breakWalk) refuse(); real.rmdirSync(path); },
  };
});

const { withStoreLock } = await import('./transaction.js');

let dir: string;
let file: string;
let lock: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-lock-release-'));
  file = join(dir, '.mellos', 'map.json');
  lock = join(dir, '.mellos', '.write-lock');
  fault.silentRm = true;
  fault.breakWalk = false;
});
afterEach(() => {
  // The injected fault must step aside before the harness deletes its own temp dir.
  fault.silentRm = false;
  fault.breakWalk = false;
  rmSync(dir, { recursive: true, force: true });
});

describe('lock release when recursive rmSync silently does nothing (nodejs/node#65578)', () => {
  it('releases the lock anyway, so the next write is not refused', () => {
    expect(withStoreLock(file, () => 'first')).toBe('first');
    expect(existsSync(lock)).toBe(false);
    // The regression this guards: a leftover lock directory left every later
    // write answering BUSY, including from a brand-new process.
    expect(withStoreLock(file, () => 'second')).toBe('second');
    expect(existsSync(lock)).toBe(false);
  });

  it('still refuses a writer that is genuinely inside the lock', () => {
    expect(() => withStoreLock(file, () => withStoreLock(file, () => 1))).toThrow('Another writer');
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the action throws', () => {
    expect(() => withStoreLock(file, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('announces a lock it truly cannot remove instead of swallowing it', () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => { written.push(String(chunk)); return true; });
    try {
      fault.breakWalk = true;
      // The map is committed either way; only the cleanup is impossible.
      expect(withStoreLock(file, () => 'committed')).toBe('committed');
    } finally {
      spy.mockRestore();
      fault.breakWalk = false;
    }
    expect(written.join('')).toContain('could not remove');
    expect(existsSync(lock)).toBe(true);
  });
});
