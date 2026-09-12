#!/usr/bin/env node
/**
 * Open the live map pane in the RIGHT Windows Terminal window — the AGENT's
 * launcher, addressed by `/mmap` and by the skill.
 *
 *   node scripts/open-pane.mjs <project-dir> [--page <slug>] [--window] [--force]
 *                              [--ascii] [--no-color] [--no-mouse] [--no-follow]
 *                              [--interval <ms>]
 *
 * Why this exists: the agent's shell runs on a hidden console (no WT_SESSION),
 * so a bare `wt -w 0 sp` targets the MOST RECENTLY USED terminal window — with
 * several windows open the map lands wherever the user last clicked, not
 * beside the conversation. The window probe that solves it, the check for an
 * already-running watcher and the `wt` payload live in ./pane-core.mjs, which
 * documents each of them; this file is the command line, the policy and the
 * machine-readable report on top.
 *
 * --page <slug> opens the map ON that page (the effort under discussion, not
 * whatever page the store lists first). With a watcher owned by this console already running it
 * writes the one-shot focus file instead — the existing pane retargets within
 * a poll tick — so re-running with --page is also how you steer an open pane.
 * Every other flag belongs to the WATCHER and is forwarded verbatim; an
 * unknown flag is a usage error, never a silently dropped intention.
 *
 * What this launcher deliberately does NOT do is CLOSE a pane. An assistant
 * asking for the map must not be able to take one away from the user; the
 * toggle is the human's command, `mmap` (./mmap.mjs).
 *
 * Pure helpers are exported for the spec; the launcher runs only as an entry
 * point, so importing this file is inert.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEDICATED_WINDOW_NAME,
  PANE_MODE,
  launchedAsEntry,
  loadPluginPaths,
  placePane,
  preparePane,
  awaitNewPane,
  pluginRootOf,
  takeWatcherFlag,
  writeFocusRequest,
} from './pane-core.mjs';

export const USAGE =
  'usage: node scripts/open-pane.mjs <project-dir> [--page <slug>] [--window] [--force]' +
  ' [--ascii] [--no-color] [--no-mouse] [--no-follow] [--interval <ms>]';

/**
 * Parse the launcher's command line.
 *
 * @param argv - arguments after the script path.
 * @param idRule - the store's page-slug grammar (ID_RULE), passed in rather
 *   than restated, so this parser cannot drift from the ids the store accepts.
 * @returns ok(config) or err(message) — a bad command line is an expected
 *   outcome of a hand-typed line, not an exception.
 */
export function parsePaneArgs(argv, idRule) {
  const positional = [];
  const watcherFlags = [];
  let pageSlug;
  let mode = PANE_MODE.split;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const watcher = takeWatcherFlag(argv, i);
    if (watcher.kind === 'bad-value') return { ok: false, error: `${watcher.message}\n${USAGE}` };
    if (watcher.kind === 'taken') {
      watcherFlags.push(...watcher.flags);
      i = watcher.next;
    } else if (a === '--page') {
      pageSlug = argv[++i];
      if (pageSlug === undefined) return { ok: false, error: `--page needs a slug\n${USAGE}` };
    } else if (a === '--window') {
      mode = PANE_MODE.window;
    } else if (a === '--force') {
      force = true;
    } else if (a.startsWith('--')) {
      return { ok: false, error: `unknown flag "${a}"\n${USAGE}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) return { ok: false, error: USAGE };
  if (pageSlug !== undefined && !idRule.test(pageSlug)) {
    return { ok: false, error: `--page needs a kebab-case slug (got "${pageSlug}")\n${USAGE}` };
  }
  return { ok: true, value: { projectDir: resolve(positional[0]), pageSlug, mode, force, watcherFlags } };
}

async function main() {
  const loaded = await loadPluginPaths(pluginRootOf(import.meta.url));
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exit(1);
  }
  const { store, watchPath } = loaded.value;

  const parsed = parsePaneArgs(process.argv.slice(2), store.ID_RULE);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  const cfg = parsed.value;
  if (!existsSync(cfg.projectDir)) {
    console.error(`project directory does not exist: ${cfg.projectDir}`);
    process.exit(1);
  }
  if (process.platform !== 'win32') {
    console.error('open-pane.mjs is Windows Terminal-only — use the tmux/manual route from the command doc.');
    process.exit(1);
  }

  const mapFile = join(cfg.projectDir, store.STATE_FILE_RELATIVE_PATH);

  const prepared = preparePane(cfg, store, mapFile);
  if (!prepared.ok) {
    console.error(prepared.error);
    process.exit(1);
  }
  const context = prepared.value;
  if (!cfg.force && context.viewer) {
    if (cfg.pageSlug !== undefined) {
      writeFocusRequest(store.focusFilePath(mapFile, context.viewer.pid), cfg.pageSlug);
      console.log(`MMAP_PANE already-open pid=${context.viewer.pid} refocused=${cfg.pageSlug}`);
      console.log(`A watcher for ${mapFile} is already running — asked it to show page "${cfg.pageSlug}".`);
    } else {
      console.log(`MMAP_PANE already-open pid=${context.viewer.pid}`);
      console.log(`A watcher for ${mapFile} is already running — not opening another pane (use --force to override).`);
    }
    process.exit(0);
  }

  const placed = placePane(cfg, watchPath, mapFile, context.target);
  if (!placed.ok) {
    console.error(placed.error);
    process.exit(1);
  }
  const reported = await awaitNewPane(store, mapFile, context);
  if (!reported.ok) {
    console.error(reported.error);
    process.exit(1);
  }
  if (placed.value.mode === PANE_MODE.window) {
    console.log(`MMAP_PANE mode=window pid=${reported.value.pid} name=${DEDICATED_WINDOW_NAME} reason=${placed.value.reason}`);
    console.log(`Map opened in the dedicated "${DEDICATED_WINDOW_NAME}" window.`);
  } else {
    console.log(`MMAP_PANE mode=split pid=${reported.value.pid} hwnd=${placed.value.hwnd}`);
    console.log('Map opened beside this conversation (vertical split).');
  }
}

if (launchedAsEntry(process.argv[1], import.meta.url)) await main();
