import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildNativeLock } from './build-native-lock.mjs';
import { NATIVE_LOCK_FILES } from './native-lock-assets.mjs';
import { CODEX_FILES } from './package-codex.mjs';

let temporary;
let first;
let second;
beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'mellos-native-package-spec-'));
  first = join(temporary, 'first');
  second = join(temporary, 'second');
  await buildNativeLock(first);
  await buildNativeLock(second);
});
afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); });

describe('standalone native lock distribution', () => {
  it('builds identical assets for every supported platform and includes them in releases', () => {
    const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
    for (const file of NATIVE_LOCK_FILES) {
      const relative = file.slice('dist/'.length);
      expect(hash(join(first, relative)), file).toBe(hash(join(second, relative)));
      expect(CODEX_FILES).toContain(file);
    }
    const licenses = readFileSync(join(first, 'native/LICENSES.txt'), 'utf8');
    expect(licenses).toContain('fs-native-extensions@1.5.1');
    expect(licenses).toContain('which-runtime@');
    expect(licenses).toContain('Copyright 2023 Holepunch Inc');
    expect(licenses).toContain('Copyright 2023 Contributors');
  });

  it('acquires, contends, and releases across processes without resolving any npm package', () => {
    expect(existsSync(join(temporary, 'node_modules'))).toBe(false);
    const probe = join(temporary, 'probe.cjs');
    writeFileSync(probe, `
      const assert = require('node:assert/strict');
      const { spawnSync } = require('node:child_process');
      const { openSync, closeSync } = require('node:fs');
      const { isAbsolute, join } = require('node:path');
      const Module = require('node:module');
      const originalResolve = Module._resolveFilename;
      Module._resolveFilename = function (request, ...args) {
        if (!Module.isBuiltin(request) && !isAbsolute(request) && !request.startsWith('.')) {
          throw new Error('Unexpected npm dependency: ' + request);
        }
        return originalResolve.call(this, request, ...args);
      };
      const lock = require(join(__dirname, 'first/native-lock.cjs'));
      assert.deepEqual(Object.keys(lock).sort(), ['tryLock', 'unlock']);
      const fd = openSync(join(__dirname, 'fixed.lock'), 'a+');
      if (process.argv[2] === 'contender') {
        const acquired = lock.tryLock(fd);
        if (acquired) lock.unlock(fd);
        closeSync(fd);
        process.stdout.write(String(acquired));
      } else {
        const contend = () => {
          const result = spawnSync(process.execPath, [__filename, 'contender'], { encoding: 'utf8', timeout: 5000 });
          assert.equal(result.status, 0, result.stderr);
          return result.stdout;
        };
        try {
          assert.equal(lock.tryLock(fd), true);
          assert.equal(contend(), 'false');
          lock.unlock(fd);
          assert.equal(contend(), 'true');
          process.stdout.write('standalone native locking passed');
        } finally {
          closeSync(fd);
        }
      }
    `);
    const result = spawnSync(process.execPath, [probe], {
      cwd: temporary, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    expect(result.status, result.stderr || String(result.error)).toBe(0);
    expect(result.stdout).toBe('standalone native locking passed');
  });
});
