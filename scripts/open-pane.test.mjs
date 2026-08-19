/**
 * Spec for the pane launcher (scripts/open-pane.mjs).
 *
 * The launcher is plain node — it cannot import the TypeScript sources — so
 * the two things a copy of a constant would break are pinned here: a focus
 * request must be readable by the store's own consumer, and the script must
 * not restate the store's paths or the id grammar at all.
 *
 * Written in .mjs because the subject is: a JavaScript file, imported the way
 * node imports it.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ID_RULE } from '../src/domain/types.js';
import { focusFilePath, takeFocusRequest } from '../src/store/store.js';
import { USAGE, paneCommand, parsePaneArgs, powerShellQuote, watcherProbeScript, writeFocusRequest } from './open-pane.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'open-pane.mjs');

describe('focus requests reach the running watcher', () => {
  let dir;
  let mapFile;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mmap-pane-'));
    mapFile = join(dir, '.mellos', 'map.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a request the store consumes — the launcher and the watcher share one filename', () => {
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

});

describe('no second copy of the store vocabulary', () => {
  it('states no store path and no id grammar of its own', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain('store-paths.mjs');
    expect(source).not.toContain('map.json');
    expect(source).not.toContain('.mellos');
    expect(source).not.toMatch(/\[a-z0-9\]\[a-z0-9-\]/); // a copy of ID_RULE
  });
});

describe('command line', () => {
  const parse = (...argv) => parsePaneArgs(argv, ID_RULE);

  it('forwards every watcher flag it accepts, and only those', () => {
    const cfg = parse('.', '--ascii', '--no-follow', '--no-mouse', '--no-color', '--interval', '500');
    expect(cfg.ok).toBe(true);
    expect(cfg.value.watcherFlags).toEqual(['--ascii', '--no-follow', '--no-mouse', '--no-color', '--interval', '500']);
  });

  it('refuses an unknown flag instead of dropping it silently', () => {
    const cfg = parse('.', '--no-fllow');
    expect(cfg.ok).toBe(false);
    expect(cfg.error).toContain('unknown flag "--no-fllow"');
    expect(cfg.error).toContain(USAGE);
  });

  it('refuses --interval without a number, and --page without a slug', () => {
    expect(parse('.', '--interval').ok).toBe(false);
    expect(parse('.', '--interval', 'soon').ok).toBe(false);
    expect(parse('.', '--page').ok).toBe(false);
  });

  it('validates the page slug against the store id grammar', () => {
    expect(parse('.', '--page', 'my-page').ok).toBe(true);
    expect(parse('.', '--page', 'My Page').ok).toBe(false);
    expect(parse('.', '--page', '-leading').ok).toBe(false);
  });

  it('keeps its own flags to itself', () => {
    const cfg = parse('.', '--window', '--force', '--ascii');
    expect(cfg.value.mode).toBe('window');
    expect(cfg.value.force).toBe(true);
    expect(cfg.value.watcherFlags).toEqual(['--ascii']);
  });

  it('needs exactly one project directory', () => {
    expect(parse().ok).toBe(false);
    expect(parse('a', 'b').ok).toBe(false);
  });

  it('hands the watcher its file, the forwarded flags and the page', () => {
    const cfg = parse('.', '--no-follow', '--page', 'api').value;
    const cmd = paneCommand(cfg, 'C:\\p\\dist\\watch.mjs', 'C:\\proj\\.mellos\\map.json');
    expect(cmd).toEqual([
      '--title',
      'mellos map',
      '-d',
      cfg.projectDir,
      'node',
      'C:\\p\\dist\\watch.mjs',
      '--file',
      'C:\\proj\\.mellos\\map.json',
      '--no-follow',
      '--page',
      'api',
    ]);
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
