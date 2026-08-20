/**
 * Spec for the PATH installer (scripts/install-mmap-command.mjs).
 *
 * Everything here is about ONE promise: this script edits a user's Windows
 * environment, so it must be able to say exactly what it would write, and it
 * must refuse rather than damage. Nothing in this spec touches a real PATH.
 *
 * Written in .mjs because the subject is: a JavaScript file, imported the way
 * node imports it.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SETX_VALUE_MAX,
  binDirIn,
  cmdShim,
  pathContains,
  pathWith,
  pathWithout,
  setxRefusal,
  shShim,
} from './install-mmap-command.mjs';

describe('the one directory it owns', () => {
  it('lives under the caller\'s LOCALAPPDATA, never a path of its own', () => {
    expect(binDirIn('C:\\Users\\ada\\AppData\\Local')).toBe(join('C:\\Users\\ada\\AppData\\Local', 'mellos-mapping', 'bin'));
  });
});

describe('the two shims', () => {
  it('forwards every argument from cmd and PowerShell', () => {
    const shim = cmdShim('C:\\plugin\\dist\\mmap.mjs');
    expect(shim).toContain('node "C:\\plugin\\dist\\mmap.mjs" %*');
    expect(shim.startsWith('@echo off')).toBe(true);
  });

  it('forwards every argument from git-bash, with a path sh will not eat', () => {
    const shim = shShim('C:\\plugin\\dist\\mmap.mjs');
    expect(shim).toContain('exec node "C:/plugin/dist/mmap.mjs" "$@"');
    expect(shim).not.toContain('\\U'); // an sh escape waiting to happen
    expect(shim.startsWith('#!/bin/sh')).toBe(true);
  });
});

describe('what it would write to the PATH', () => {
  const bin = 'C:\\Users\\ada\\AppData\\Local\\mellos-mapping\\bin';

  it('recognizes the entry however it was written', () => {
    for (const written of [bin, `${bin}\\`, bin.toUpperCase(), ` ${bin} `, `"${bin}"`]) {
      expect(pathContains(`C:\\other;${written};C:\\more`, bin)).toBe(true);
    }
    expect(pathContains('C:\\other;C:\\more', bin)).toBe(false);
  });

  it('appends once and is then a no-op — installing twice changes nothing', () => {
    const before = 'C:\\other';
    const after = pathWith(before, bin);
    expect(after).toBe(`C:\\other;${bin}`);
    expect(pathWith(after, bin)).toBe(after);
  });

  it('appends to an empty PATH without leaving a stray separator', () => {
    expect(pathWith('', bin)).toBe(bin);
    expect(pathWith(';;', bin)).toBe(bin);
  });

  it('removes every mention on uninstall, and leaves the rest in order', () => {
    expect(pathWithout(`C:\\a;${bin};C:\\b;${bin}\\`, bin)).toBe('C:\\a;C:\\b');
    expect(pathWithout('C:\\a;C:\\b', bin)).toBe('C:\\a;C:\\b');
  });
});

describe('when setx would do damage, it refuses instead', () => {
  it('refuses a PATH built out of %VARIABLE% references — setx would flatten them', () => {
    const refusal = setxRefusal('%USERPROFILE%\\bin;C:\\a', '%USERPROFILE%\\bin;C:\\a;C:\\new');
    expect(refusal).toContain('%VARIABLE%');
  });

  it('refuses a PATH setx would truncate', () => {
    const long = 'C:\\'.padEnd(SETX_VALUE_MAX, 'x');
    expect(setxRefusal(long, `${long};C:\\new`)).toContain(String(SETX_VALUE_MAX));
  });

  it('has nothing to say about a plain PATH that fits', () => {
    expect(setxRefusal('C:\\a;C:\\b', 'C:\\a;C:\\b;C:\\new')).toBeUndefined();
  });
});
