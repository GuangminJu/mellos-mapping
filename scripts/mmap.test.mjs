/**
 * Spec for the human's `mmap` toggle (scripts/mmap.mjs).
 *
 * The three decisions this command makes that nothing else in the repo makes:
 * which project the user meant, whether the invocation opens or closes, and
 * what its command line accepts.
 *
 * Written in .mjs because the subject is: a JavaScript file, imported the way
 * node imports it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ID_RULE } from '../src/domain/types.js';
import { USAGE, nearestProject, parseMmapArgs, storeMarkerOf, storeSearchPath, toggleAction } from './mmap.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'mmap.mjs');

describe('finding the project the user is standing in', () => {
  it('walks from the starting directory up to the filesystem root, nearest first', () => {
    const start = resolve('a', 'b', 'c');
    const path = storeSearchPath(start);
    expect(path[0]).toBe(start);
    expect(path[1]).toBe(dirname(start));
    expect(path[path.length - 1]).toBe(resolve(sep)); // the root is its own parent — the walk stops
    expect(new Set(path).size).toBe(path.length); // and never loops there
  });

  it('takes the marker directory from the store\'s own layout, never a copy', () => {
    expect(storeMarkerOf(join('.mellos', 'map.json'))).toBe('.mellos');
    expect(storeMarkerOf('.mellos/map.json')).toBe('.mellos'); // either separator
  });

  it('picks the nearest ancestor that holds a store', () => {
    const dirs = ['/a/b/c', '/a/b', '/a', '/'];
    expect(nearestProject(dirs, [false, true, true, false])).toEqual({ root: '/a/b', found: true });
    expect(nearestProject(dirs, [true, false, false, false])).toEqual({ root: '/a/b/c', found: true });
  });

  it('falls back to where the user is standing — a first open is legitimate', () => {
    const dirs = ['/a/b/c', '/a/b', '/a', '/'];
    expect(nearestProject(dirs, [false, false, false, false])).toEqual({ root: '/a/b/c', found: false });
  });
});

describe('the toggle rule', () => {
  it('opens when nothing is running', () => {
    expect(toggleAction(false, undefined)).toEqual({ kind: 'open' });
    expect(toggleAction(false, 'api')).toEqual({ kind: 'open' });
  });

  it('closes a running pane when no page was named — the bare form is the toggle', () => {
    expect(toggleAction(true, undefined)).toEqual({ kind: 'quit' });
  });

  it('never closes when a page was named: asking to SEE a page is not asking to lose it', () => {
    expect(toggleAction(true, 'api')).toEqual({ kind: 'focus', page: 'api' });
  });

  it('--force opens another pane rather than toggling', () => {
    expect(toggleAction(true, undefined, true)).toEqual({ kind: 'open' });
    expect(toggleAction(true, 'api', true)).toEqual({ kind: 'open' });
  });
});

describe('command line', () => {
  const parse = (...argv) => parseMmapArgs(argv, ID_RULE);

  it('is bare by default: no page, split mode, no forwarded flags', () => {
    expect(parse()).toEqual({
      ok: true,
      value: { pageSlug: undefined, mode: 'split', force: false, watcherFlags: [] },
    });
  });

  it('takes the page as a positional argument', () => {
    expect(parse('design-notes').value.pageSlug).toBe('design-notes');
  });

  it('forwards every watcher flag verbatim and keeps its own', () => {
    const cfg = parse('api', '--window', '--force', '--ascii', '--no-color', '--interval', '500').value;
    expect(cfg.mode).toBe('window');
    expect(cfg.force).toBe(true);
    expect(cfg.watcherFlags).toEqual(['--ascii', '--no-color', '--interval', '500']);
    expect(cfg.pageSlug).toBe('api');
  });

  it('refuses an unknown flag instead of dropping it silently', () => {
    const cfg = parse('--no-fllow');
    expect(cfg.ok).toBe(false);
    expect(cfg.error).toContain('unknown flag "--no-fllow"');
    expect(cfg.error).toContain(USAGE);
  });

  it('refuses --interval without a number', () => {
    expect(parse('--interval').ok).toBe(false);
    expect(parse('--interval', 'soon').ok).toBe(false);
  });

  it('refuses --page: the slug is the positional, and two spellings would contradict', () => {
    const cfg = parse('--page', 'api');
    expect(cfg.ok).toBe(false);
    expect(cfg.error).toContain('not --page');
  });

  it('validates the page slug against the store id grammar', () => {
    expect(parse('my-page').ok).toBe(true);
    expect(parse('My Page').ok).toBe(false);
    expect(parse('-leading').ok).toBe(false);
  });

  it('takes at most one page', () => {
    expect(parse('a', 'b').ok).toBe(false);
  });
});

describe('no second copy of the store vocabulary', () => {
  it('states no store path and no id grammar of its own', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).not.toContain('map.json');
    expect(source).not.toContain('.mellos');
    expect(source).not.toMatch(/\[a-z0-9\]\[a-z0-9-\]/); // a copy of ID_RULE
  });
});
