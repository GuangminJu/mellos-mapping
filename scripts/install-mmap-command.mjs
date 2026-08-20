#!/usr/bin/env node
/**
 * Put `mmap` on the PATH of a plugin install.
 *
 *   node scripts/install-mmap-command.mjs [--uninstall]
 *
 * npm users get `mmap` for free — package.json declares it in `bin`. Claude
 * Code installs this plugin by CLONING the repo, with no npm install and no
 * bin shims, so the one command a human is meant to type has nowhere to be
 * typed from. This script is that missing step, and nothing more: it writes
 * two tiny shims into `%LOCALAPPDATA%\mellos-mapping\bin` — `mmap.cmd` for
 * cmd/PowerShell, `mmap` for git-bash — and adds that one directory to the
 * USER PATH.
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

export const USAGE = 'usage: node scripts/install-mmap-command.mjs [--uninstall]';

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
  if (wanted === raw) {
    console.log('Your user PATH already says what it should — leaving it alone.');
    return;
  }
  const refusal = setxRefusal(raw, wanted);
  if (refusal !== undefined) {
    console.log(`NOT touching your user PATH: ${refusal}.`);
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

function main() {
  const argv = process.argv.slice(2);
  const uninstall = argv.includes('--uninstall');
  const unknown = argv.find((a) => a !== '--uninstall');
  if (unknown !== undefined) {
    console.error(`unknown argument "${unknown}"\n${USAGE}`);
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

  const binDir = binDirIn(localAppData);
  const cmdPath = join(binDir, 'mmap.cmd');
  const shPath = join(binDir, 'mmap');
  const raw = readUserPath();

  if (uninstall) {
    for (const path of [cmdPath, shPath]) {
      rmSync(path, { force: true });
      console.log(`removed ${path}`);
    }
    applyPath(raw, pathWithout(raw, binDir));
    console.log('Open a new terminal for the change to take effect.');
    return;
  }

  const mmapPath = join(pluginRootOf(import.meta.url), 'dist', 'mmap.mjs');
  if (!existsSync(mmapPath)) {
    console.error(`the plugin is not built — run "npm run build" (missing ${mmapPath})`);
    process.exit(1);
  }
  mkdirSync(binDir, { recursive: true });
  writeFileSync(cmdPath, cmdShim(mmapPath));
  writeFileSync(shPath, shShim(mmapPath));
  try {
    chmodSync(shPath, 0o755); // git-bash honors the execute bit it can see
  } catch {
    // A filesystem without POSIX modes still runs the shim through `sh`;
    // refusing to install over a chmod would be theatre.
  }
  console.log(`wrote ${cmdPath}`);
  console.log(`wrote ${shPath}`);
  applyPath(raw, pathWith(raw, binDir));
  console.log('Open a new terminal, then type `mmap` in any project: it opens the map pane, or closes the open one.');
}

if (launchedAsEntry(process.argv[1], import.meta.url)) main();
