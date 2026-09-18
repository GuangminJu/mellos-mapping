import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withStoreLock } from './transaction.js';
import { nativeLock } from './native-lock.js';

const fixtures: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mellos-kernel-lock-'));
  fixtures.push(root);
  const dir = join(root, '我的项目', '.mellos');
  mkdirSync(dir, { recursive: true });
  return { dir, file: join(dir, 'map.json'), lock: join(dir, '.write-lock') };
}
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('permanent OS project lock', () => {
  it('keeps the same regular file across successful and throwing transactions on a Unicode path', () => {
    const f = fixture();
    expect(withStoreLock(f.file, () => 'first')).toBe('first');
    const original = statSync(f.lock);
    expect(original.isFile()).toBe(true);
    expect(() => withStoreLock(f.file, () => { throw new Error('action failed'); })).toThrow('action failed');
    expect(withStoreLock(f.file, () => 'third')).toBe('third');
    const current = statSync(f.lock);
    expect([current.dev, current.ino]).toEqual([original.dev, original.ino]);
    expect(existsSync(join(f.lock, 'owner.json'))).toBe(false);
    expect(existsSync(join(f.lock, '.reap'))).toBe(false);
  });

  it('refuses reentry and a named-page writer while the same project is locked', () => {
    const f = fixture();
    withStoreLock(f.file, () => {
      for (const target of [f.file, join(f.dir, 'pages', 'other.json')]) {
        let entered = false;
        expect(() => withStoreLock(target, () => { entered = true; })).toThrow(expect.objectContaining({ code: 'BUSY' }));
        expect(entered).toBe(false);
      }
    });
    expect(withStoreLock(join(f.dir, 'pages', 'other.json'), () => 1)).toBe(1);
  });

  it('closing an old descriptor cannot release the successor lock', () => {
    const f = fixture();
    const backend = nativeLock();
    const first = openSync(f.lock, 'a+');
    const second = openSync(f.lock, 'a+');
    let firstClosed = false;
    try {
      expect(backend.tryLock(first)).toBe(true);
      backend.unlock(first);
      // B takes over between A's explicit unlock and A's close. A's later
      // cleanup must leave B's independently opened description locked.
      expect(backend.tryLock(second)).toBe(true);
      closeSync(first); firstClosed = true;
      expect(() => withStoreLock(f.file, () => 'must not enter')).toThrow(expect.objectContaining({ code: 'BUSY' }));
    } finally {
      backend.unlock(second); closeSync(second);
      if (!firstClosed) closeSync(first);
    }
    expect(withStoreLock(f.file, () => 'next')).toBe('next');
  });

  it.each(['active owner', 'dead owner and reaper', 'missing metadata'])('refuses a legacy directory without modifying it: %s', state => {
    const f = fixture();
    mkdirSync(f.lock);
    if (state !== 'missing metadata') writeFileSync(join(f.lock, 'owner.json'), JSON.stringify({ pid: state === 'active owner' ? process.pid : 2147483647, token: 'legacy' }));
    if (state === 'dead owner and reaper') mkdirSync(join(f.lock, '.reap'));
    const before = state === 'missing metadata' ? undefined : readFileSync(join(f.lock, 'owner.json'), 'utf8');
    let entered = false;
    expect(() => withStoreLock(f.file, () => { entered = true; })).toThrow(expect.objectContaining({ code: 'LOCK_MIGRATION_REQUIRED' }));
    expect(entered).toBe(false);
    expect(lstatSync(f.lock).isDirectory()).toBe(true);
    if (before !== undefined) expect(readFileSync(join(f.lock, 'owner.json'), 'utf8')).toBe(before);
    if (state === 'dead owner and reaper') expect(existsSync(join(f.lock, '.reap'))).toBe(true);
  });

  it('allows independent projects to write while one project is locked', () => {
    const a = fixture(), b = fixture();
    expect(withStoreLock(a.file, () => withStoreLock(b.file, () => 'both independent'))).toBe('both independent');
  });

});
