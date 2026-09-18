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
  SHIM_MARKER,
  linkDirCandidates,
  reachableDirs,
  shimIsOurs,
  shimLaunches,
  shimTarget,
  binDirIn,
  cmdShim,
  pathContains,
  pathWith,
  pathWithout,
  planPath,
  setxRefusal,
  shShim,
} from './install-mmap-command.mjs';

describe('the one directory it owns', () => {
  it('lives under the caller\'s LOCALAPPDATA, never a path of its own', () => {
    expect(binDirIn('C:\\Users\\ada\\AppData\\Local')).toBe(join('C:\\Users\\ada\\AppData\\Local', 'mellos-mapping', 'bin'));
  });
});

describe('the two shims', () => {
  it('carry the ownership marker both hosts read back — the literal is pinned on both sides', () => {
    expect(SHIM_MARKER).toBe('mellos-mapping mmap shim');
  });

  it('forwards every argument from cmd and PowerShell', () => {
    const shim = cmdShim('C:\\plugin\\dist\\mmap.mjs');
    expect(shim).toContain('node "C:\\plugin\\dist\\mmap.mjs" %*');
    expect(shim.startsWith('@echo off')).toBe(true);
    expect(shim).toContain(`rem ${SHIM_MARKER}`); // who wrote this file, said by the file
  });

  it('forwards every argument from git-bash, with a path sh will not eat', () => {
    const shim = shShim('C:\\plugin\\dist\\mmap.mjs');
    expect(shim).toContain('exec node "C:/plugin/dist/mmap.mjs" "$@"');
    expect(shim).not.toContain('\\U'); // an sh escape waiting to happen
    expect(shim.startsWith('#!/bin/sh')).toBe(true);
    expect(shim).toContain(`# ${SHIM_MARKER}`);
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

describe('the plan every mode executes — decided before anything is done', () => {
  it('a PATH already right is a no-op, never a rewrite of the same value', () => {
    expect(planPath('C:\\a;C:\\bin', 'C:\\a;C:\\bin')).toEqual({ action: 'unchanged' });
  });

  it('a safe change is a write', () => {
    expect(planPath('C:\\a', 'C:\\a;C:\\bin')).toEqual({ action: 'write' });
  });

  it('a change setx would damage is a refusal that names the damage', () => {
    const plan = planPath('%USERPROFILE%\\bin', '%USERPROFILE%\\bin;C:\\bin');
    expect(plan.action).toBe('refused');
    expect(plan.reason).toContain('%VARIABLE%');
  });
});

describe('a PATH that refuses the edit still gets a working command', () => {
  const local = 'C:\\Users\\ada\\AppData\\Local';
  const home = 'C:\\Users\\ada';

  it('offers only per-user directories Windows already searches', () => {
    const dirs = linkDirCandidates(local, home);
    expect(dirs[0]).toContain('WindowsApps'); // the App Execution Alias home
    expect(dirs[1]).toBe(join(home, '.local', 'bin'));
  });

  it('lists the candidates this PATH can already reach, in the order they should be tried', () => {
    const [windowsApps, dotLocal] = linkDirCandidates(local, home);
    const exists = () => true;
    expect(reachableDirs([windowsApps, dotLocal], `${windowsApps};C:\\Windows`, exists)).toEqual([windowsApps]);
    expect(reachableDirs([windowsApps, dotLocal], dotLocal, exists)).toEqual([dotLocal]);
    expect(reachableDirs([windowsApps, dotLocal], 'C:\\Windows', exists)).toEqual([]);
  });

  it('never picks a directory that does not exist, however well it is named', () => {
    const [windowsApps] = linkDirCandidates(local, home);
    expect(reachableDirs([windowsApps], windowsApps, () => false)).toEqual([]);
  });
});

describe('a shared directory is not ours to overwrite', () => {
  const ours = cmdShim('C:\\Users\\ada\\.omp\\plugins\\cache\\mellos-mapping___x___1.0.0\\dist\\mmap.mjs');
  const oursSh = shShim('C:\\Users\\ada\\.omp\\plugins\\cache\\mellos-mapping___x___1.0.0\\dist\\mmap.mjs');

  it('recognizes every shim this plugin writes — cmd form and git-bash form', () => {
    expect(shimIsOurs(ours)).toBe(true);
    expect(shimIsOurs(oursSh)).toBe(true); // the sh path is written with forward slashes
  });

  it('leaves a stranger mmap command alone', () => {
    expect(shimIsOurs('@echo off\r\nnode "C:\\tools\\mmap\\index.js" %*\r\n')).toBe(false);
    expect(shimIsOurs('#!/bin/sh\nexec /usr/bin/mmap "$@"\n')).toBe(false);
    expect(shimIsOurs('')).toBe(false);
  });
});

describe('one ownership reader for both shim shapes', () => {
  const target = 'C:\\Users\\ada\\.omp\\plugins\\cache\\plugins\\mellos-mapping___x___1.0.0\\dist\\mmap.mjs';

  it('normalizes the cmd and git-bash shapes to one target', () => {
    expect(shimTarget(cmdShim(target))).toBe(shimTarget(shShim(target)));
  });

  it('recognizes a shim that launches exactly this bundle — either shape', () => {
    expect(shimLaunches(cmdShim(target), target)).toBe(true);
    expect(shimLaunches(shShim(target), target)).toBe(true); // the forward-slash form counts too
  });

  it('does not mistake another install, or a stranger, for this one', () => {
    expect(shimLaunches(cmdShim(target.replace('1.0.0', '2.0.0')), target)).toBe(false);
    expect(shimLaunches('@echo off\r\nnode "C:\\tools\\mmap\\index.js" %*\r\n', target)).toBe(false);
    expect(shimLaunches('', target)).toBe(false);
    expect(shimTarget('#!/bin/sh\nexec /usr/bin/mmap "$@"\n')).toBeUndefined();
  });

  it('owns a shim under any directory name once the marker is on it', () => {
    const arbitrary = 'C:\\Users\\ada\\Downloads\\mm-2.0\\dist\\mmap.mjs';
    expect(shimIsOurs(cmdShim(arbitrary))).toBe(true);
    expect(shimIsOurs(shShim(arbitrary))).toBe(true);
    // shims from before the marker are still recognized by the path that named the plugin
    expect(shimIsOurs('@echo off\r\nnode "C:\\x\\mellos-mapping\\dist\\mmap.mjs" %*\r\n')).toBe(true);
  });
});
