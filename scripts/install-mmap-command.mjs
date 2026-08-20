#!/usr/bin/env node
/**
 * Put `mmap` on the PATH of a plugin install.
 *
 *   node scripts/install-mmap-command.mjs [--uninstall] [--json]
 *
 * npm users get `mmap` for free — package.json declares it in `bin`. Claude
 * Code installs this plugin by CLONING the repo, with no npm install and no
 * bin shims, so the one command a human is meant to type has nowhere to be
 * typed from. This script is that missing step, and nothing more: it writes
 * two tiny shims into `%LOCALAPPDATA%\mellos-mapping\bin` — `mmap.cmd` for
 * cmd/PowerShell, `mmap` for git-bash — and adds that one directory to the
 * USER PATH.
 *
 * Nobody has to run it by hand: the SessionStart hook
 * (src/hook/session-start.ts) notices a missing or stale shim when a session
 * starts and runs this script with `--json`, which prints the outcome as one
 * JSON line instead of prose — that outcome object is the contract between
 * the two files. The script stays a standalone command for the cases the
 * hook does not cover: `--uninstall`, and re-adding a PATH entry the user
 * removed while the shims still exist (the hook checks only the shims).
 *
 * What it will NEVER do, and says so instead:
 *
 *   - Touch the SYSTEM PATH. This is a per-user tool.
 *   - Rewrite a user PATH that `setx` cannot carry safely. `setx` writes a
 *     plain string and truncates past SETX_VALUE_MAX, so a PATH holding
 *     `%USERPROFILE%`-style references would come back with the references
 *     flattened, and a long one would come back SHORTER. Both are damage that
 *     outlives this tool, so in either case the shims are still installed and
 *     the exact line to add by hand is printed.
 *
 * Windows-first, deliberately: this plugin's pane is Windows Terminal. On
 * other platforms `mmap` is `npm i -g mellos-mapping`, or a shell alias.
 *
 * Pure helpers are exported for the spec; the installer runs only as an entry
 * point, so importing this file is inert.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { launchedAsEntry, pluginRootOf } from './pane-core.mjs';

export const USAGE = 'usage: node scripts/install-mmap-command.mjs [--uninstall] [--json]';

/**
 * Longest value `setx` stores without truncating it, in characters. Documented
 * by the tool itself ("the maximum size is 1024 characters") and the reason
 * this script would rather refuse than shorten someone's PATH.
 */
export const SETX_VALUE_MAX = 1024;

/** The one directory this installer owns, given a `%LOCALAPPDATA%`. */
export function binDirIn(localAppData) {
  return join(localAppData, 'mellos-mapping', 'bin');
}

/** The cmd/PowerShell shim: forwards every argument, prints nothing of its own. */
export function cmdShim(mmapPath) {
  return ['@echo off', `node "${mmapPath}" %*`, ''].join('\r\n');
}

/**
 * The git-bash shim. The target is written with forward slashes: a Windows
 * path inside sh double quotes keeps its backslashes verbatim, and `\U` in
 * `C:\Users` is one escape away from being someone else's bug.
 */
export function shShim(mmapPath) {
  return ['#!/bin/sh', `exec node "${mmapPath.replaceAll('\\', '/')}" "$@"`, ''].join('\n');
}

/** PATH entries as written, empties dropped — the unit every rule below works on. */
function entriesOf(rawPath) {
  return rawPath.split(';').filter((e) => e.trim() !== '');
}

/** Two PATH entries naming the same directory: case and a trailing slash do not count. */
function samePathEntry(a, b) {
  const norm = (s) => s.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** Is `dir` already on this PATH? Then installing it again must change nothing. */
export function pathContains(rawPath, dir) {
  return entriesOf(rawPath).some((e) => samePathEntry(e, dir));
}

/** `rawPath` with `dir` appended — unchanged when it is already there. */
export function pathWith(rawPath, dir) {
  return pathContains(rawPath, dir) ? rawPath : [...entriesOf(rawPath), dir].join(';');
}

/** `rawPath` with every mention of `dir` removed. */
export function pathWithout(rawPath, dir) {
  return entriesOf(rawPath)
    .filter((e) => !samePathEntry(e, dir))
    .join(';');
}

/**
 * Why `setx` must not be used to write `nextValue`, or undefined when it can.
 *
 * @param rawValue - the USER PATH exactly as the registry holds it.
 * @param nextValue - what this script would write.
 * @returns a sentence naming the damage that would be done, for the caller to
 *   print beside the manual instructions.
 */
export function setxRefusal(rawValue, nextValue) {
  if (rawValue.includes('%')) {
    return 'your user PATH contains %VARIABLE% references, and setx would store them flattened to whatever they mean right now';
  }
  if (nextValue.length > SETX_VALUE_MAX) {
    return `your user PATH would be ${nextValue.length} characters and setx truncates past ${SETX_VALUE_MAX}`;
  }
  return undefined;
}

/**
 * What bringing the PATH from `raw` to `wanted` takes — decided, not done.
 * The single place the write/refuse/no-op judgment lives; both the prose
 * path and the `--json` path execute exactly this plan.
 * @returns {{action: 'unchanged'} | {action: 'write'} | {action: 'refused', reason: string}}
 */
export function planPath(raw, wanted) {
  if (wanted === raw) return { action: 'unchanged' };
  const reason = setxRefusal(raw, wanted);
  return reason === undefined ? { action: 'write' } : { action: 'refused', reason };
}

/**
 * The USER PATH exactly as the registry holds it — unexpanded, so a
 * `%USERPROFILE%` in it is still a `%USERPROFILE%` here.
 *
 * node's own `process.env.Path` is the merged, expanded, per-process value and
 * writing THAT back would fold the machine's PATH into the user's.
 * @returns the raw value, or '' when the user has no PATH of their own.
 */
function readUserPath() {
  const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout ?? '').match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/m);
  return m === null ? '' : m[1].trimEnd();
}

/** Ask Windows to store the user's PATH, and to tell running shells about it. */
function writeUserPath(value) {
  const r = spawnSync('setx', ['PATH', value], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? { ok: true, value: undefined } : { ok: false, error: (r.stderr || r.stdout || '').trim() };
}

/**
 * Bring the USER PATH to where it should be, saying out loud what changes
 * before anything does.
 * @param wanted - the PATH value this run wants.
 * @param raw - the PATH value as it stands.
 */
function applyPath(raw, wanted) {
  const plan = planPath(raw, wanted);
  if (plan.action === 'unchanged') {
    console.log('Your user PATH already says what it should — leaving it alone.');
    return;
  }
  if (plan.action === 'refused') {
    console.log(`NOT touching your user PATH: ${plan.reason}.`);
    console.log('Add (or remove) this entry yourself, in Settings > "Edit environment variables for your account":');
    console.log(`  ${wanted}`);
    return;
  }
  console.log('Changing ONE thing in your Windows user environment — your user PATH becomes:');
  console.log(`  ${wanted}`);
  const written = writeUserPath(wanted);
  if (!written.ok) {
    console.error(`setx refused: ${written.error}`);
    process.exit(1);
  }
}

/**
 * The install itself, with the narration stripped out: write the shims, bring
 * the PATH in line, report what happened as data. This outcome object IS the
 * `--json` output and the contract the SessionStart hook reads — change a
 * field here and src/hook/session-start.ts must follow.
 *
 * @returns one of
 *   {kind: 'not-built', missing}  — dist/mmap.mjs absent, nothing written;
 *   {kind: 'installed', binDir, cmdPath, shPath, path, wanted, reason?} —
 *     shims written; `path` says what happened to the USER PATH:
 *       'unchanged' — the entry was already there,
 *       'updated'   — the entry was appended,
 *       'refused'   — setx would damage this PATH (`reason` says how); the
 *                     entry in `wanted` must be added by hand,
 *       'error'     — setx itself failed (`reason` is its message).
 */
export function install(localAppData, pluginRoot) {
  const mmapPath = join(pluginRoot, 'dist', 'mmap.mjs');
  if (!existsSync(mmapPath)) return { kind: 'not-built', missing: mmapPath };

  const binDir = binDirIn(localAppData);
  const cmdPath = join(binDir, 'mmap.cmd');
  const shPath = join(binDir, 'mmap');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(cmdPath, cmdShim(mmapPath));
  writeFileSync(shPath, shShim(mmapPath));
  try {
    chmodSync(shPath, 0o755); // git-bash honors the execute bit it can see
  } catch {
    // A filesystem without POSIX modes still runs the shim through `sh`;
    // refusing to install over a chmod would be theatre.
  }

  const raw = readUserPath();
  const wanted = pathWith(raw, binDir);
  const plan = planPath(raw, wanted);
  if (plan.action === 'unchanged') return { kind: 'installed', binDir, cmdPath, shPath, path: 'unchanged', wanted };
  if (plan.action === 'refused') {
    return { kind: 'installed', binDir, cmdPath, shPath, path: 'refused', wanted, reason: plan.reason };
  }
  const written = writeUserPath(wanted);
  return written.ok
    ? { kind: 'installed', binDir, cmdPath, shPath, path: 'updated', wanted }
    : { kind: 'installed', binDir, cmdPath, shPath, path: 'error', wanted, reason: written.error };
}

function main() {
  const argv = process.argv.slice(2);
  const uninstall = argv.includes('--uninstall');
  const json = argv.includes('--json');
  const unknown = argv.find((a) => a !== '--uninstall' && a !== '--json');
  if (unknown !== undefined) {
    console.error(`unknown argument "${unknown}"\n${USAGE}`);
    process.exit(1);
  }
  if (uninstall && json) {
    console.error(`--uninstall talks to a human; it has no --json mode\n${USAGE}`);
    process.exit(1);
  }
  if (process.platform !== 'win32') {
    console.error('This installer is for Windows. Elsewhere, `npm i -g mellos-mapping` provides the same `mmap` command.');
    process.exit(1);
  }
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData === undefined || localAppData === '') {
    console.error('LOCALAPPDATA is not set — there is no per-user place to install into.');
    process.exit(1);
  }

  if (uninstall) {
    const binDir = binDirIn(localAppData);
    const raw = readUserPath();
    for (const path of [join(binDir, 'mmap.cmd'), join(binDir, 'mmap')]) {
      rmSync(path, { force: true });
      console.log(`removed ${path}`);
    }
    applyPath(raw, pathWithout(raw, binDir));
    console.log('Open a new terminal for the change to take effect.');
    return;
  }

  const outcome = install(localAppData, pluginRootOf(import.meta.url));
  if (json) {
    console.log(JSON.stringify(outcome));
    return;
  }
  if (outcome.kind === 'not-built') {
    console.error(`the plugin is not built — run "npm run build" (missing ${outcome.missing})`);
    process.exit(1);
  }
  console.log(`wrote ${outcome.cmdPath}`);
  console.log(`wrote ${outcome.shPath}`);
  switch (outcome.path) {
    case 'unchanged':
      console.log('Your user PATH already says what it should — leaving it alone.');
      break;
    case 'updated':
      console.log('Changed ONE thing in your Windows user environment — your user PATH is now:');
      console.log(`  ${outcome.wanted}`);
      break;
    case 'refused':
      console.log(`NOT touching your user PATH: ${outcome.reason}.`);
      console.log('Add this entry yourself, in Settings > "Edit environment variables for your account":');
      console.log(`  ${outcome.binDir}`);
      break;
    case 'error':
      console.error(`setx refused: ${outcome.reason}`);
      process.exit(1);
  }
  console.log('Open a new terminal, then type `mmap` in any project: it opens the map pane, or closes the open one.');
}

if (launchedAsEntry(process.argv[1], import.meta.url)) main();
