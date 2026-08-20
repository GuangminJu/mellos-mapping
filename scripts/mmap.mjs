#!/usr/bin/env node
/**
 * `mmap` — the human's entrance to the map pane. A TOGGLE.
 *
 *   mmap                      open the pane for this project, or close the one
 *                             that is already open
 *   mmap <slug>               open the pane ON that page, or retarget the pane
 *                             that is already open. Never closes anything:
 *                             naming a page is asking to SEE it
 *   mmap [--window] [--ascii] [--no-color] [--no-mouse] [--no-follow]
 *        [--interval <ms>] [--force]
 *
 * Two things make this a different command from scripts/open-pane.mjs rather
 * than a flag on it:
 *
 *   1. It has no project argument. A human types `mmap` wherever they happen
 *      to be standing, so the project is DISCOVERED — walk up from the cwd to
 *      the nearest directory holding the store, the way git finds its root.
 *   2. It closes. `mmap` with a pane open writes the store's one-shot quit
 *      request and the pane exits within a poll tick. The agent's launcher
 *      deliberately cannot do that.
 *
 * Everything else — the window probe, the already-running check, the `wt`
 * payload — is ./pane-core.mjs, shared verbatim with open-pane.mjs.
 *
 * Pure helpers are exported for the spec; the command runs only as an entry
 * point, so importing this file is inert.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DEDICATED_WINDOW_NAME,
  PANE_MODE,
  launchedAsEntry,
  loadPluginPaths,
  placePane,
  pluginRootOf,
  takeWatcherFlag,
  watcherAlreadyRunning,
  writeFocusRequest,
  writeQuitRequest,
} from './pane-core.mjs';

export const USAGE =
  'usage: mmap [<page-slug>] [--window] [--force] [--ascii] [--no-color] [--no-mouse]' +
  ' [--no-follow] [--interval <ms>]\n' +
  '       bare `mmap` toggles: it opens the map pane for this project, or closes the open one.';

/**
 * Parse the toggle's command line.
 *
 * @param argv - arguments after the script path.
 * @param idRule - the store's page-slug grammar (ID_RULE), passed in rather
 *   than restated, so this parser cannot drift from the ids the store accepts.
 * @returns ok(config) or err(message). One positional argument at most, and it
 *   is a PAGE SLUG — not a directory: `mmap` is typed inside the project it
 *   means. An unknown flag is refused rather than dropped, exactly as the
 *   watcher and the agent launcher refuse one.
 */
export function parseMmapArgs(argv, idRule) {
  const positional = [];
  const watcherFlags = [];
  let mode = PANE_MODE.split;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const watcher = takeWatcherFlag(argv, i);
    if (watcher.kind === 'bad-value') return { ok: false, error: `${watcher.message}\n${USAGE}` };
    if (watcher.kind === 'taken') {
      watcherFlags.push(...watcher.flags);
      i = watcher.next;
    } else if (a === '--window') {
      mode = PANE_MODE.window;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--page') {
      // The slug is the positional here; accepting both spellings would make
      // `mmap api --page other` a question with no answer.
      return { ok: false, error: `mmap takes the page slug as its argument, not --page\n${USAGE}` };
    } else if (a.startsWith('--')) {
      return { ok: false, error: `unknown flag "${a}"\n${USAGE}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) return { ok: false, error: `mmap takes at most one page slug\n${USAGE}` };
  const pageSlug = positional[0];
  if (pageSlug !== undefined && !idRule.test(pageSlug)) {
    return { ok: false, error: `a page is a kebab-case slug (got "${pageSlug}")\n${USAGE}` };
  }
  return { ok: true, value: { pageSlug, mode, force, watcherFlags } };
}

/**
 * The directories to look in for a project's store, nearest first: the
 * starting directory, then every ancestor up to and including the filesystem
 * root.
 *
 * Pure on purpose — the caller asks the filesystem which of these actually
 * holds a store — so the walk itself is specifiable without a project tree.
 */
export function storeSearchPath(startDir) {
  const dirs = [];
  let dir = resolve(startDir);
  for (;;) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return dirs; // the filesystem root is its own parent
    dir = parent;
  }
}

/**
 * The directory whose presence marks a project, taken from the store's own
 * default-page path (its first segment). Derived rather than restated: this
 * script must not carry a second copy of the store's layout.
 */
export function storeMarkerOf(storeRelativePath) {
  return storeRelativePath.split(/[\\/]/)[0];
}

/**
 * Which project `mmap` was typed in: the NEAREST candidate that holds a store,
 * the way git discovers its root.
 *
 * @param candidates - storeSearchPath's answer, nearest first.
 * @param holdsStore - whether each candidate holds the store directory, in the
 *   same order. A parallel array of answers rather than a predicate to call:
 *   the filesystem question belongs to the entry point, and this rule is then
 *   a fold over values that a spec can state in full.
 * @returns the project root, and whether a store was actually found —
 *   `found: false` means the starting directory is being used because nothing
 *   above it has a map yet, which is a legitimate first open, not an error.
 */
export function nearestProject(candidates, holdsStore) {
  const at = holdsStore.indexOf(true);
  return at >= 0 ? { root: candidates[at], found: true } : { root: candidates[0], found: false };
}

/**
 * What a `mmap` invocation means, given whether a pane is already up.
 *
 * The toggle rule in one place: a BARE `mmap` against a running pane closes
 * it; naming a page never does — asking to see something is not asking to
 * lose it — and retargets the running pane instead. With no pane running,
 * every form opens one.
 *
 * @param running - a watcher for this project's map file is alive.
 * @param pageSlug - the page named on the command line, if any.
 * @param force - `--force`: open another pane regardless.
 */
export function toggleAction(running, pageSlug, force = false) {
  if (!running || force) return { kind: 'open' };
  return pageSlug === undefined ? { kind: 'quit' } : { kind: 'focus', page: pageSlug };
}

async function main() {
  const loaded = await loadPluginPaths(pluginRootOf(import.meta.url));
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exit(1);
  }
  const { store, watchPath } = loaded.value;

  const parsed = parseMmapArgs(process.argv.slice(2), store.ID_RULE);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  if (process.platform !== 'win32') {
    console.error('mmap opens the pane through Windows Terminal — on other platforms run the watcher yourself:');
    console.error(`  node "${watchPath}" --file "<project>/${store.STATE_FILE_RELATIVE_PATH}"`);
    process.exit(1);
  }

  const candidates = storeSearchPath(process.cwd());
  const marker = storeMarkerOf(store.STATE_FILE_RELATIVE_PATH);
  const project = nearestProject(candidates, candidates.map((dir) => existsSync(join(dir, marker))));
  const cfg = { ...parsed.value, projectDir: project.root };
  const mapFile = join(project.root, store.STATE_FILE_RELATIVE_PATH);
  const action = toggleAction(watcherAlreadyRunning(mapFile), cfg.pageSlug, cfg.force);

  if (action.kind === 'quit') {
    writeQuitRequest(store.quitFilePath(mapFile));
    console.log(`Closing the map pane for ${project.root}.`);
    return;
  }
  if (action.kind === 'focus') {
    writeFocusRequest(store.focusFilePath(mapFile), action.page);
    console.log(`The map pane for ${project.root} is already open — showing page "${action.page}".`);
    return;
  }

  const placed = placePane(cfg, watchPath, mapFile);
  if (!placed.ok) {
    console.error(placed.error);
    process.exit(1);
  }
  const where =
    placed.value.mode === PANE_MODE.window
      ? `in the dedicated "${DEDICATED_WINDOW_NAME}" window (${placed.value.reason})`
      : 'beside this terminal (vertical split)';
  console.log(`Map opened for ${project.root} ${where}.`);
  if (!project.found) {
    console.log(
      'This project has no map yet, so the pane will sit on its standby screen ' +
        'until the assistant declares one.',
    );
  }
}

if (launchedAsEntry(process.argv[1], import.meta.url)) await main();
