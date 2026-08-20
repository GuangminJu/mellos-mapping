/**
 * Spec for what every way of opening the pane has in common
 * (scripts/pane-core.mjs).
 *
 * The core is plain node — it cannot import the TypeScript sources — so the
 * things a COPY of a constant would break are pinned here: a request it writes
 * must be readable by the store's own consumer, and the module must not
 * restate the store's paths or the id grammar at all.
 *
 * Written in .mjs because the subject is: a JavaScript file, imported the way
 * node imports it.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { focusFilePath, quitFilePath, takeFocusRequest, takeQuitRequest } from '../src/store/store.js';
import {
  PANE_FLAGS,
  WATCHER_BOOLEAN_FLAGS,
  WATCHER_VALUE_FLAGS,
  paneCommand,
  powerShellQuote,
  takeWatcherFlag,
  watcherProbeScript,
  writeFocusRequest,
  writeQuitRequest,
} from './pane-core.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'pane-core.mjs');

describe('the one-shot channels reach the running watcher', () => {
  let dir;
  let mapFile;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mmap-pane-'));
    mapFile = join(dir, '.mellos', 'map.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a focus request the store consumes — one filename, two sides', () => {
    writeFocusRequest(focusFilePath(mapFile), 'design-notes');
    expect(takeFocusRequest(mapFile)).toEqual({ page: 'design-notes' });
    expect(takeFocusRequest(mapFile)).toBeUndefined(); // one-shot: consumed and deleted
  });

  it('sweeps the orphan file 0.20.x launchers left in the project', () => {
    const orphan = join(dir, '.mellos', 'mellos-mapping.focus');
    writeFocusRequest(focusFilePath(mapFile), 'first');
    writeFileSync(orphan, '{"page":"never-read"}');
    writeFocusRequest(focusFilePath(mapFile), 'second');
    expect(existsSync(orphan)).toBe(false);
    expect(takeFocusRequest(mapFile)).toEqual({ page: 'second' });
  });

  it('writes a quit request the store consumes — the toggle closing a pane', () => {
    writeQuitRequest(quitFilePath(mapFile));
    expect(takeQuitRequest(mapFile)).toBe(true);
    expect(takeQuitRequest(mapFile)).toBe(false); // one-shot, like the focus file
  });

  it('leaves no temp behind: a torn read would be swept as junk', () => {
    writeQuitRequest(quitFilePath(mapFile));
    writeFocusRequest(focusFilePath(mapFile), 'api');
    expect(existsSync(`${quitFilePath(mapFile)}.tmp`)).toBe(false);
    expect(existsSync(`${focusFilePath(mapFile)}.tmp`)).toBe(false);
  });
});

describe('no second copy of the store vocabulary', () => {
  it('reads the paths from the generated bundle instead of restating them', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain('store-paths.mjs');
    expect(source).not.toContain('map.json');
    expect(source).not.toContain('.mellos');
    expect(source).not.toMatch(/\[a-z0-9\]\[a-z0-9-\]/); // a copy of ID_RULE
  });
});

describe('the shared flag vocabulary', () => {
  it('takes a boolean watcher flag and consumes exactly its own token', () => {
    for (const flag of WATCHER_BOOLEAN_FLAGS) {
      expect(takeWatcherFlag([flag, 'next'], 0)).toEqual({ kind: 'taken', next: 0, flags: [flag] });
    }
  });

  it('takes a value flag together with its value', () => {
    expect(takeWatcherFlag(['--interval', '500'], 0)).toEqual({
      kind: 'taken',
      next: 1,
      flags: ['--interval', '500'],
    });
  });

  it('refuses a value flag whose value is missing or not a number', () => {
    expect(takeWatcherFlag(['--interval'], 0).kind).toBe('bad-value');
    expect(takeWatcherFlag(['--interval', 'soon'], 0).kind).toBe('bad-value');
  });

  it("says nothing about tokens that are not its own — including the launchers' flags", () => {
    for (const flag of [...PANE_FLAGS, '--page', '--nonsense', 'a-slug']) {
      expect(takeWatcherFlag([flag], 0)).toEqual({ kind: 'other' });
    }
  });
});

describe('the wt payload', () => {
  it('hands the watcher its file, the forwarded flags and the page', () => {
    const cfg = { projectDir: 'C:\\proj', pageSlug: 'api', watcherFlags: ['--no-follow'] };
    expect(paneCommand(cfg, 'C:\\p\\dist\\watch.mjs', 'C:\\proj\\.mellos\\map.json')).toEqual([
      '--title',
      'mellos map',
      '-d',
      'C:\\proj',
      'node',
      'C:\\p\\dist\\watch.mjs',
      '--file',
      'C:\\proj\\.mellos\\map.json',
      '--no-follow',
      '--page',
      'api',
    ]);
  });

  it('omits --page when no page is the subject', () => {
    const cfg = { projectDir: 'C:\\proj', pageSlug: undefined, watcherFlags: [] };
    expect(paneCommand(cfg, 'w.mjs', 'm.json')).not.toContain('--page');
  });
});

describe('finding an already-running watcher', () => {
  it('matches a path containing wildcard characters literally', () => {
    const script = watcherProbeScript('C:\\work\\[wip]\\a*b?\\.mellos\\map.json');
    expect(script).toContain("'C:\\work\\[wip]\\a*b?\\.mellos\\map.json'");
    expect(script).not.toContain('-like'); // wildcards in a path are not a pattern
    expect(script).toContain('OrdinalIgnoreCase');
  });

  it('closes the PowerShell string a quote in the path would otherwise open', () => {
    expect(powerShellQuote("C:\\it's\\map.json")).toBe("'C:\\it''s\\map.json'");
  });
});

describe('WATCHER_VALUE_FLAGS is the value half of the vocabulary', () => {
  it('shares no flag with the boolean half', () => {
    expect(WATCHER_VALUE_FLAGS.filter((f) => WATCHER_BOOLEAN_FLAGS.includes(f))).toEqual([]);
  });
});
