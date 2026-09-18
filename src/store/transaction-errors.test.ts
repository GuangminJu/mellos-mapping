import { existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeLock, type NativeLock } from './native-lock.js';
import { withStoreLock } from './transaction.js';

// Inject only the failing boundary. Successful acquisitions and descriptor
// cleanup still exercise the shipped native backend and the real filesystem.
vi.mock('./native-lock.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./native-lock.js')>();
  return { ...actual, nativeLock: vi.fn(actual.nativeLock) };
});

let root: string;
let file: string;
let lock: string;
let backend: NativeLock;

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('./native-lock.js')>('./native-lock.js');
  backend = actual.nativeLock();
  vi.mocked(nativeLock).mockReset().mockReturnValue(backend);
  root = mkdtempSync(join(tmpdir(), 'mellos-lock-errors-'));
  const dir = join(root, '项目', '.mellos');
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'map.json');
  lock = join(dir, '.write-lock');
  writeFileSync(file, 'original map');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(nativeLock).mockReset();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('project lock failures', () => {
  it('refuses the write when the native backend cannot load, without changing the saved map', () => {
    vi.mocked(nativeLock).mockImplementationOnce(() => { throw new Error('missing native addon'); });
    const write = vi.fn(() => writeFileSync(file, 'must not be saved'));

    expect(() => withStoreLock(file, write)).toThrow(expect.objectContaining({ code: 'LOCK_UNAVAILABLE' }));
    expect(write).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('original map');
    expect(existsSync(lock)).toBe(false);

    expect(withStoreLock(file, () => 'backend restored')).toBe('backend restored');
  });

  it('closes the descriptor even if acquisition fails after taking a real OS lock', () => {
    let descriptor: number | undefined;
    let acquired = false;
    vi.mocked(nativeLock).mockReturnValueOnce({
      tryLock(fd) {
        descriptor = fd;
        acquired = backend.tryLock(fd);
        throw new Error('native acquisition failed');
      },
      unlock: fd => backend.unlock(fd),
    });
    const write = vi.fn(() => writeFileSync(file, 'must not be saved'));

    expect(() => withStoreLock(file, write)).toThrow(expect.objectContaining({ code: 'LOCK_UNAVAILABLE' }));
    expect(acquired).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('original map');
    expect(descriptor).toBeDefined();
    expect(() => fstatSync(descriptor!)).toThrow(expect.objectContaining({ code: 'EBADF' }));

    withStoreLock(file, () => writeFileSync(file, 'retry saved'));
    expect(readFileSync(file, 'utf8')).toBe('retry saved');
  });

  it('preserves a committed result when explicit unlock fails, warns, and releases the OS lock by closing', () => {
    const warnings = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let descriptor: number | undefined;
    vi.mocked(nativeLock).mockReturnValueOnce({
      tryLock(fd) { descriptor = fd; return backend.tryLock(fd); },
      unlock() { throw new Error('native unlock failed'); },
    });
    const committed = { saved: true };

    const result = withStoreLock(file, () => {
      // This refusal proves the injected backend is holding a real exclusive
      // lock, so a successful subsequent call proves close actually freed it.
      expect(() => withStoreLock(file, () => 'must not enter')).toThrow(expect.objectContaining({ code: 'BUSY' }));
      writeFileSync(file, 'committed map');
      return committed;
    });

    expect(result).toBe(committed);
    expect(readFileSync(file, 'utf8')).toBe('committed map');
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('Could not explicitly unlock'));
    expect(descriptor).toBeDefined();
    expect(() => fstatSync(descriptor!)).toThrow(expect.objectContaining({ code: 'EBADF' }));
    expect(withStoreLock(file, () => 'next writer')).toBe('next writer');
    expect(lstatSync(lock).isFile()).toBe(true);
  });

  it('refuses a symlink lock path without modifying its target or running the write', context => {
    const target = join(root, 'lock-target');
    writeFileSync(target, 'preserve this file');
    try { symlinkSync(target, lock, 'file'); }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip('Windows did not grant permission to create a file symlink.');
        return;
      }
      throw error;
    }
    const write = vi.fn(() => writeFileSync(file, 'must not be saved'));

    expect(() => withStoreLock(file, write)).toThrow(expect.objectContaining({ code: 'LOCK_UNAVAILABLE' }));
    expect(write).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('original map');
    expect(lstatSync(lock).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('preserve this file');
  });
});
