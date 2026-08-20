/**
 * Spec for the AGENT's pane launcher (scripts/open-pane.mjs) — its command
 * line and the one thing it must never grow.
 *
 * The machinery it shares with the `mmap` toggle (the store channels, the
 * window probe, the `wt` payload) is specified in ./pane-core.test.mjs.
 *
 * Written in .mjs because the subject is: a JavaScript file, imported the way
 * node imports it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ID_RULE } from '../src/domain/types.js';
import { USAGE, parsePaneArgs } from './open-pane.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'open-pane.mjs');

describe('no second copy of the store vocabulary', () => {
  it('states no store path and no id grammar of its own', () => {
    const source = readFileSync(scriptPath, 'utf8');
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
});

describe('the agent launcher cannot close a pane', () => {
  /**
   * The toggle is the HUMAN's command. An assistant that could write the quit
   * request would be able to take the map away from the user mid-sentence, so
   * this launcher never imports that half of the channel.
   */
  it('never writes a quit request', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).not.toContain('writeQuitRequest');
    expect(source).not.toContain('quitFilePath');
  });
});
