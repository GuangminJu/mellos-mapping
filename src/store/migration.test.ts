import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyStore } from './migration.js';
import { nativeLock, type NativeLock } from './native-lock.js';
import { withStoreLock } from './transaction.js';

// Inject a competing commit only at acquisition; filesystem operations and
// both writers' exclusion still use the shipped native OS lock backend.
vi.mock('./native-lock.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./native-lock.js')>();
  return { ...actual, nativeLock: vi.fn(actual.nativeLock) };
});

let root: string;
let legacy: string;
let current: string;
let backend: NativeLock;

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('./native-lock.js')>('./native-lock.js');
  backend = actual.nativeLock();
  vi.mocked(nativeLock).mockReset().mockReturnValue(backend);
  root = mkdtempSync(join(tmpdir(), 'mellos-migration-lock-'));
  legacy = join(root, '.claude', 'mellos-mapping.json');
  current = join(root, '.mellos', 'map.json');
  mkdirSync(dirname(legacy), { recursive: true });
  writeFileSync(legacy, 'legacy map');
});

afterEach(() => {
  vi.mocked(nativeLock).mockReset();
  rmSync(root, { recursive: true, force: true });
});

describe('legacy migration writer exclusion', () => {
  it('refuses to migrate while a current writer owns the project, preserving the legacy store', () => {
    withStoreLock(current, () => {
      expect(() => migrateLegacyStore(current)).toThrow(expect.objectContaining({ code: 'BUSY' }));
      expect(readFileSync(legacy, 'utf8')).toBe('legacy map');
      expect(existsSync(current)).toBe(false);
    });
    expect(migrateLegacyStore(current)).toBe(true);
    expect(readFileSync(current, 'utf8')).toBe('legacy map');
  });

  it.each(['map.json', join('pages', 'named.json'), 'config.json'])('preserves a current %s committed before migration acquires its lock', relative => {
    const destination = join(dirname(current), relative);
    const commit = vi.fn(() => withStoreLock(current, () => {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, 'current writer committed');
    }));
    vi.mocked(nativeLock).mockReturnValueOnce({
      tryLock(fd) { commit(); return backend.tryLock(fd); },
      unlock: fd => backend.unlock(fd),
    });

    expect(migrateLegacyStore(current)).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
    expect(readFileSync(destination, 'utf8')).toBe('current writer committed');
    expect(readFileSync(legacy, 'utf8')).toBe('legacy map');
  });

  it('leaves an old directory lock and all legacy files untouched', () => {
    const lock = join(dirname(current), '.write-lock');
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'owner.json'), 'legacy owner');
    expect(() => migrateLegacyStore(current)).toThrow(expect.objectContaining({ code: 'LOCK_MIGRATION_REQUIRED' }));
    expect(readFileSync(join(lock, 'owner.json'), 'utf8')).toBe('legacy owner');
    expect(readFileSync(legacy, 'utf8')).toBe('legacy map');
    expect(existsSync(current)).toBe(false);
  });
});
