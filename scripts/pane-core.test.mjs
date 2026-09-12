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
  preparePane,
  placePane,
  selectPaneViewer,
  awaitNewPane,
  takeWatcherFlag,
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

describe('a pane belongs beside its own session', () => {
  const cfg = { mode: 'split', projectDir: 'C:\\项目 folder', pageSlug: 'design', watcherFlags: [] };
  const session = { owners: ['split-11-22'], owner: 'split-11-22', hwnd: '333' };
  const viewer = { pid: 44, owner: session.owner, page: 'design', follow: true };
  const source = (viewers) => ({ readLiveViewers: () => viewers });
  const probe = { inspectSession: () => ({ ok: true, value: session }) };

  it('ignores a separate window, legacy viewer and another session on the same project', () => {
    const elsewhere = [{ ...viewer, owner: 'window' }, { ...viewer, owner: undefined }, { ...viewer, owner: 'split-55-66' }];
    expect(selectPaneViewer(elsewhere, session.owners)).toBeUndefined();
    expect(preparePane(cfg, source(elsewhere), 'map', probe).value.viewer).toBeUndefined();
    expect(selectPaneViewer([...elsewhere, viewer], session.owners)).toEqual(viewer);
  });

  it('reuses an owned pane even while its source tab is inactive', () => {
    const inactive = { inspectSession: () => ({ ok: true, value: { owners: session.owners } }) };
    expect(preparePane(cfg, source([viewer]), 'map', inactive).value.viewer).toEqual(viewer);
    expect(preparePane({ ...cfg, force: true }, source([viewer]), 'map', inactive).ok).toBe(false);
  });

  it('requires the source window to be identified before creating a split', () => {
    const unknown = { inspectSession: () => ({ ok: true, value: { owners: [] } }) };
    const result = preparePane(cfg, source([{ ...viewer, owner: 'window' }]), 'map', unknown);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no separate window was opened');
  });

  it('opens a separate window only when explicitly requested', () => {
    const context = preparePane({ ...cfg, mode: 'window' }, source([viewer]), 'map', {}).value;
    expect(context.viewer).toBeUndefined();
    const calls = [];
    const result = placePane(cfg, 'watch', 'map', context.target, {
      openWt: (args) => { calls.push(args); return { ok: true }; },
    });
    expect(result.ok).toBe(true);
    expect(calls[0].slice(0, 3)).toEqual(['-w', 'mellos-mapping', 'nt']);
  });

  it('does not launch anything if Windows denies focus', () => {
    const result = placePane(cfg, 'watch', 'map', { ...session, mode: 'split' }, {
      focusSession: () => ({ ok: false, error: 'focus denied' }),
      openWt: () => { throw new Error('must not open a fallback'); },
    });
    expect(result).toEqual({ ok: false, error: 'focus denied' });
  });

  it('preserves project, page and owner, splits vertically, then restores left input focus', () => {
    const calls = [];
    const result = placePane(cfg, 'C:\\插件\\watch.mjs', 'C:\\项目 folder\\map', { ...session, mode: 'split' }, {
      focusSession: (hwnd) => { expect(hwnd).toBe('333'); return { ok: true }; },
      openWt: (args) => { calls.push(args); return { ok: true }; },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([[
      '-w', '0', 'sp', '-V', '--size', '0.42', '--title', 'mellos map', '-d', cfg.projectDir,
      'node', 'C:\\插件\\watch.mjs', '--file', 'C:\\项目 folder\\map', '--page', 'design',
      '--owner', session.owner, ';', 'move-focus', 'previous',
    ]]);
  });

  it('cannot use an older viewer as evidence that a new pane started', async () => {
    const context = { target: { owner: session.owner }, previousPids: [44] };
    expect((await awaitNewPane(source([viewer]), 'map', context, 0)).ok).toBe(false);
    expect((await awaitNewPane(source([viewer, { ...viewer, pid: 45 }]), 'map', context, 0)).value.pid).toBe(45);
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

describe('WATCHER_VALUE_FLAGS is the value half of the vocabulary', () => {
  it('shares no flag with the boolean half', () => {
    expect(WATCHER_VALUE_FLAGS.filter((f) => WATCHER_BOOLEAN_FLAGS.includes(f))).toEqual([]);
  });
});
