/** Process adapter and explicit-open receipt verification. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LiveViewer, readLiveViewers } from '../store/store.js';
const pageName = (page: string | undefined): string => page ?? '(default)';
/**
 * How long the launcher may run before it is abandoned. It is the sum of what
 * the launcher itself allows — 30s probe, 5s focus, 15s wt and 8s handshake — so
 * this timeout can only fire when the launcher has stopped answering, never
 * on a slow-but-working machine.
 */
const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * How long to wait for the NEW pane to report itself in (the viewers channel)
 * before answering without it. Generous next to a pane's first heartbeat: a
 * cold `wt` window, node's startup and the first paint all happen in here.
 */
export const PANE_REPORT_TIMEOUT_MS = 8_000;

/** How often the wait above looks. */
const PANE_REPORT_POLL_MS = 250;

/**
 * Where the agent's launcher lives, given this module's URL.
 *
 * One rule serves both shapes this module runs in, because both sit exactly
 * one directory below the root: `dist/server.mjs` in an installed plugin,
 * `src/server/server.ts` in a checkout under test.
 */
export function launcherPath(moduleUrl: string): string {
  return join(dirname(dirname(fileURLToPath(moduleUrl))), 'scripts', 'open-pane.mjs');
}

/** The project a store belongs to: `<project>/.mellos/map.json` -> `<project>`. */
export function projectDirOf(stateFile: string): string {
  return dirname(dirname(stateFile));
}

/**
 * The launcher's command line for one open request — the whole translation
 * from tool arguments to the flags scripts/open-pane.mjs understands.
 */
export function launcherArgs(projectDir: string, page: string | undefined, window: boolean): string[] {
  const args = [projectDir];
  if (page !== undefined) args.push('--page', page);
  if (window) args.push('--window');
  return args;
}

/** What running the launcher came to. */
export interface LauncherRun {
  /** It exited 0: the pane was placed, or an already-open one was retargeted. */
  readonly ok: boolean;
  /** Everything it said, both streams, trimmed — including its `MMAP_PANE …` line. */
  readonly output: string;
}

/**
 * Run the launcher and collect what it said.
 *
 * stdio is PIPED, never inherited: this process's stdout is the JSON-RPC
 * channel, and one line of a child's chatter on it would end the session.
 * Asynchronous for the same reason the server is — a spawnSync here would
 * hold the whole server still for as long as a window probe takes.
 */
function runLauncher(script: string, args: readonly string[]): Promise<LauncherRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const abandon = setTimeout(() => child.kill(), LAUNCH_TIMEOUT_MS);
    child.on('error', (e: Error) => {
      clearTimeout(abandon);
      resolve({ ok: false, output: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(abandon);
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

/** Resolve the installed launcher at the process boundary, independently of map operations. */
export function launchPane(args: readonly string[]): Promise<LauncherRun> {
  const script = launcherPath(import.meta.url);
  if (!existsSync(script)) return Promise.resolve({ ok: false,
    output: `the launcher is missing at ${script}. This install is incomplete — reinstall the plugin (a source checkout needs "npm run build").`,
  });
  return runLauncher(script, args);
}

/**
 * Is what was asked for on a screen?
 *
 * A call that named a page is answered by THAT page being shown. A call
 * that named none asked for the map, not for a particular page of it, so
 * any live pane answers it — including the one that was already open, which
 * would otherwise be waited on for a page it was never asked to switch to.
 */
export function paneShows(viewers: readonly LiveViewer[], page: string | undefined): boolean {
  return page === undefined ? viewers.length > 0 : viewers.some((v) => v.page === page);
}

/** Wait until a pane shows what was asked for, or until the deadline passes. */
export async function awaitPane(stateFile: string, page: string | undefined, deadlineMs: number, pid?: number): Promise<readonly LiveViewer[]> {
  for (;;) {
    const viewers = readLiveViewers(stateFile, Date.now()).filter((viewer) => pid === undefined || viewer.pid === pid);
    if (paneShows(viewers, page)) return viewers;
    if (Date.now() >= deadlineMs) return viewers;
    await new Promise((r) => setTimeout(r, PANE_REPORT_POLL_MS));
  }
}

/**
 * What to tell the caller, given how the launcher went and what the panes
 * report afterwards. Pure, so the wording is a thing the spec can hold.
 *
 * The distinction that matters is between "a pane exists" and "the page you
 * are working on is on it" — the first was always guessable from the exit
 * code, and it is the second that the user actually experiences.
 */
export function openOutcome(run: LauncherRun, viewers: readonly LiveViewer[], page: string | undefined): string {
  const pid = launcherViewerPid(run);
  viewers = viewers.filter((viewer) => pid === undefined || viewer.pid === pid);
  if (!run.ok) {
    return (
      `could not open the pane: ${run.output === '' ? 'the launcher failed without saying why' : run.output}\n` +
      'Relay the launcher reason and any copyable fallback command. Do not retry mmap_open until the terminal environment changes or the user asks to retry. A failed default split is not permission to open a separate window.'
    );
  }
  if (paneShows(viewers, page)) {
    const visible = /^MMAP_PANE [^\r\n]*\bvisibility=visible(?:\s|$)/m.test(run.output);
    return `pane: running and reporting ${pageName(page)} — ${visible
      ? 'the launcher verified its tmux window is active and its pane is visible in the attached session.'
      : 'terminal visibility is not confirmed by the process heartbeat.'}\n${run.output}`;
  }
  if (viewers.length > 0) {
    const elsewhere = [...new Set(viewers.map((v) => pageName(v.page)))].join(', ');
    return (
      `pane: open, but it reports ${elsewhere} rather than ${pageName(page)}. With auto-follow on it ` +
      'lands there on your next write; with follow off the user is holding that page on purpose.\n' +
      run.output
    );
  }
  return (
    `the launcher succeeded but no pane has reported in within ${PANE_REPORT_TIMEOUT_MS / 1000}s. It may still be ` +
    'starting; the `pane:` line on your next write says whether it made it.\n' +
    run.output
  );
}

/** A placement receipt binds verification to that exact watcher. */
export function launcherViewerPid(run: LauncherRun): number | undefined {
  const raw = /^MMAP_PANE [^\r\n]*\bpid=([1-9]\d*)(?:\s|$)/m.exec(run.output)?.[1];
  return raw === undefined ? undefined : Number(raw);
}
