/**
 * What every way of opening (or closing) the map pane has in common.
 *
 * Two entry points sit on top of this module and they are deliberately not
 * one script:
 *
 *   scripts/open-pane.mjs — the AGENT's launcher. Takes the project directory
 *     as a positional argument, prints machine-readable `MMAP_PANE …` lines,
 *     and never closes anything: an assistant asking for the map must not be
 *     able to take a pane away from the user.
 *   scripts/mmap.mjs — the HUMAN's toggle. Takes no project directory (it
 *     discovers one by walking up from the cwd), prints sentences, and closes
 *     a pane that is already open.
 *
 * Folding them into one script with two personalities would mean branching on
 * how it was invoked — the hidden control flow this repo refuses everywhere
 * else. Sharing this module instead means the window probe, the
 * already-running check and the `wt` payload have exactly one definition, and
 * the two command lines stay honestly different.
 *
 * Everything here runs on plain node: these scripts ship in the plugin, which
 * Claude Code installs by cloning the repo with no build and no npm install,
 * so nothing here may import the TypeScript sources. The store's own
 * vocabulary — where the map lives, what the focus and quit channels are
 * called, which panes are live, what a page slug may look like — is read at
 * runtime from the generated dist/store-paths.mjs (see loadPluginPaths). A
 * second copy of a filename is how the focus request came to be written to a
 * name no watcher ever read.
 *
 * Pure helpers are exported for the spec; nothing here runs on import.
 */
import * as terminal from './terminal-session.mjs';
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// the flag vocabulary, shared so the two entry points cannot drift
// ---------------------------------------------------------------------------

/**
 * Watcher flags forwarded verbatim to dist/watch.mjs — the full boolean set
 * parseArgs (src/watch/watch.ts) understands, minus the two the launchers own
 * themselves (--file, --page). Forwarding the whole set is one rule the caller
 * can hold in their head; a curated subset silently ate --no-follow.
 */
export const WATCHER_BOOLEAN_FLAGS = ['--ascii', '--no-color', '--no-mouse', '--no-follow'];
/** Watcher flags that consume the next argument as their value. */
export const WATCHER_VALUE_FLAGS = ['--interval'];
/** Flags a launcher consumes itself; they never reach the watcher. */
export const PANE_FLAGS = ['--window', '--force'];

/** How the pane is placed: beside the conversation, or in its own window. */
export const PANE_MODE = { split: 'split', window: 'window' };

/**
 * Read argv[i] as a WATCHER flag.
 *
 * @param argv - the whole argument list.
 * @param i - index of the token to read.
 * @returns `other` when the token belongs to the caller's own vocabulary,
 *   `taken` with the index of the LAST token consumed and the flags to
 *   forward, or `bad-value` with a message the caller wraps in its own usage.
 *   A Result-shaped value rather than a throw: a hand-typed command line
 *   getting a flag wrong is expected, not exceptional.
 */
export function takeWatcherFlag(argv, i) {
  const flag = argv[i];
  if (WATCHER_BOOLEAN_FLAGS.includes(flag)) return { kind: 'taken', next: i, flags: [flag] };
  if (!WATCHER_VALUE_FLAGS.includes(flag)) return { kind: 'other' };
  const value = argv[i + 1];
  if (value === undefined || !Number.isFinite(Number(value))) return { kind: 'bad-value', message: `${flag} needs a number` };
  return { kind: 'taken', next: i + 1, flags: [flag, value] };
}

// ---------------------------------------------------------------------------
// where the plugin keeps the things these scripts run
// ---------------------------------------------------------------------------

/**
 * The plugin root, given an entry point's `import.meta.url`.
 *
 * Both entry points live exactly one directory below the root — `scripts/` in
 * a plugin checkout, `dist/` for the bundled `mmap` binary — so one rule
 * serves both. It takes the url rather than reading its own, because this
 * module is BUNDLED into dist/mmap.mjs: `import.meta.url` in here would then
 * be the bundle's, and every caller would silently get the bundle's answer.
 */
export function pluginRootOf(moduleUrl) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/**
 * Load the built artifacts an entry point needs: the store's path vocabulary
 * and the watcher itself.
 *
 * @returns ok with `{ store, watchPath }`, or err with a message naming the
 *   missing file — an unbuilt checkout is a state to report, not a crash.
 */
export async function loadPluginPaths(pluginRoot) {
  const pathsModule = join(pluginRoot, 'dist', 'store-paths.mjs');
  const watchPath = join(pluginRoot, 'dist', 'watch.mjs');
  const missing = !existsSync(pathsModule) ? pathsModule : !existsSync(watchPath) ? watchPath : undefined;
  if (missing !== undefined) {
    return { ok: false, error: `the plugin is not built — run "npm run build" (missing ${missing})` };
  }
  return { ok: true, value: { store: await import(pathToFileURL(pathsModule).href), watchPath } };
}

/**
 * Was this script RUN, or merely imported? A spec importing an entry point
 * must not launch a terminal.
 *
 * Compared by real path: npm bin shims launch through a symlink and shells may
 * pass relative paths, so the two strings rarely match as written.
 * @param argv1 - process.argv[1].
 * @param moduleUrl - the script's own `import.meta.url`.
 */
export function launchedAsEntry(argv1, moduleUrl) {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// the one-shot channels a running pane listens on
// ---------------------------------------------------------------------------

/**
 * Name written by 0.20.0/0.20.1 launchers for the focus channel. No watcher
 * ever read it, so every steered pane left one behind in the user's project;
 * writing a request now sweeps the orphan away.
 */
const ORPHANED_FOCUS_FILE_NAME = 'mellos-mapping.focus';

/**
 * Write a one-shot request into the store's message channel.
 *
 * @param path - the store's OWN path for the channel, never assembled here,
 *   so the writer and the reader can only ever agree.
 * @param body - the request's JSON payload.
 * Temp + rename because the watcher polls: a torn read would be swept as
 * junk, silently losing the request.
 */
function writeRequest(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(body));
  renameSync(`${path}.tmp`, path);
}

/**
 * Write the one-shot focus request a RUNNING watcher consumes (see
 * takeFocusRequest in src/store/store.ts).
 * @param focusFile - the store's own focus path for this map file.
 */
export function writeFocusRequest(focusFile, pageSlug) {
  writeRequest(focusFile, { page: pageSlug });
  try {
    rmSync(join(dirname(focusFile), ORPHANED_FOCUS_FILE_NAME), { force: true });
  } catch {
    // sweeping a dead file is a courtesy; the request itself already landed
  }
}

/**
 * Write the one-shot quit request a RUNNING watcher consumes (see
 * takeQuitRequest in src/store/store.ts) — the toggle's OFF half.
 *
 * The payload is an empty object on purpose: the store accepts any JSON
 * object and reads nothing out of it, so the request says only that it was
 * made. The empty object is what tells a stray file of the same name apart
 * from a message.
 * @param quitFile - the store's own quit path for this map file.
 */
export function writeQuitRequest(quitFile) {
  writeRequest(quitFile, {});
}

// ---------------------------------------------------------------------------
// finding, focusing and splitting the right Windows Terminal window
// ---------------------------------------------------------------------------

/** The `wt` payload that runs the watcher: the pane's title, cwd and command. */
export function paneCommand(cfg, watchPath, mapFile) {
  const cmd = ['--title', 'mellos map', '-d', cfg.projectDir, 'node', watchPath, '--file', mapFile, ...cfg.watcherFlags];
  if (cfg.pageSlug !== undefined) cmd.push('--page', cfg.pageSlug);
  return cmd;
}

/** Explicitly requested independent window; default opens never fall back here. */
export const DEDICATED_WINDOW_NAME = 'mellos-mapping';
const SPLIT_SIZE = '0.42';

/** Pure reuse rule: a live viewer belongs to a console, not just to a project. */
export function selectPaneViewer(viewers, owners) {
  return viewers.find((viewer) => viewer.owner !== undefined && owners.includes(viewer.owner));
}

/** Resolve identity before deciding whether to reuse, open or toggle. */
export function preparePane(cfg, store, mapFile, io = terminal) {
  const inspected = cfg.mode === PANE_MODE.window
    ? { ok: true, value: { owners: ['window'], owner: 'window' } }
    : io.inspectSession();
  if (!inspected.ok) return inspected;
  const session = inspected.value;
  const viewers = store.readLiveViewers(mapFile, Date.now());
  const viewer = selectPaneViewer(viewers, session.owners);
  if (cfg.mode === PANE_MODE.split && !session.hwnd && (!viewer || cfg.force)) {
    return { ok: false, error: 'Could not identify this conversation’s active Windows Terminal pane. Activate its PowerShell tab and retry; no separate window was opened. Use --window only if you want a separate window.' };
  }
  return { ok: true, value: {
    target: { mode: cfg.mode, owner: session.owner ?? viewer?.owner, hwnd: session.hwnd },
    viewer,
    previousPids: viewers.map((item) => item.pid),
  } };
}

/** Compose a verified target with the watcher payload. Never changes the requested mode. */
export function placePane(cfg, watchPath, mapFile, target, io = terminal) {
  const payload = [...paneCommand(cfg, watchPath, mapFile), '--owner', target.owner];
  if (target.mode === PANE_MODE.window) {
    const opened = io.openWt(['-w', DEDICATED_WINDOW_NAME, 'nt', ...payload], 'open the requested window');
    return opened.ok ? { ok: true, value: { ...target, reason: 'requested' } } : opened;
  }
  const focused = io.focusSession(target.hwnd);
  if (!focused.ok) return focused;
  const opened = io.openWt([
    '-w', '0', 'sp', '-V', '--size', SPLIT_SIZE, ...payload,
    ';', 'move-focus', 'previous',
  ], 'split the session window');
  return opened.ok ? { ok: true, value: target } : opened;
}

/** Wait for the newly launched, correctly bound watcher rather than an older window. */
export async function awaitNewPane(store, mapFile, context, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const viewer = store.readLiveViewers(mapFile, Date.now()).find((item) =>
      item.owner === context.target.owner && !context.previousPids.includes(item.pid));
    if (viewer) return { ok: true, value: viewer };
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return { ok: false, error: 'The requested pane has not reported in. Its placement is unverified; do not assume that another open map is the requested split.' };
}
