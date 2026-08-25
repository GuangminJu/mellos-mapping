#!/usr/bin/env node
/**
 * Register the bundled MCP server with Codex CLI — run once after installing
 * or updating the plugin: `node <plugin root>/scripts/codex-register.mjs`.
 *
 * Why this script exists instead of a plugin-shipped .mcp.json: Codex spawns
 * plugin-bundled MCP servers inside the plugin cache and gives them no way to
 * learn the user's workspace (no ${PLUGIN_ROOT}-style expansion in args, cwd
 * locked to the plugin root when set — verified empirically against
 * codex-cli 0.147.0). The state file would land in the cache instead of the
 * project. A user-level `codex mcp add` entry inherits the session's working
 * directory, which is exactly the contract dist/server.mjs already expects.
 * The registered path is absolute and version-specific, so re-run after
 * every plugin update.
 *
 * Two Windows facts shape the process handling below:
 *   - A missing `codex` is NOT a spawn error there. The call goes through
 *     cmd.exe (only a shell resolves both codex.exe and an npm .cmd shim), so
 *     "not recognized as an internal or external command" arrives as an
 *     ordinary non-zero exit, and a check for spawnSync's `error` field can
 *     never fire. PATH is probed up front instead.
 *   - The child writes its diagnostics in the console's OEM code page.
 *     Decoding those bytes as UTF-8 turns every non-English message into
 *     mojibake, so they are passed through as bytes and the terminal decodes
 *     them as it decodes everything else it prints.
 *
 * Pure helpers are exported for the spec; registration runs only as an entry
 * point, so importing this file is inert.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** cmd.exe's exit code for a command it cannot resolve on PATH. */
export const COMMAND_NOT_FOUND_EXIT_CODE = 9009;

/** Quote one argument for a cmd.exe command line. */
export function quoteForShell(arg) {
  return /[\s"]/.test(arg) ? `"${arg}"` : arg;
}

/**
 * What went wrong, in the user's terms.
 * @param status - the child's exit code (null = it never ran).
 * @returns the line to print; a missing CLI is named as such on every
 *   platform, because that is the failure a first-time reader actually hits.
 */
export function describeFailure(status) {
  return status === COMMAND_NOT_FOUND_EXIT_CODE || status === null
    ? 'codex CLI not found on PATH — install Codex first, then re-run this script.'
    : `codex mcp add failed (exit ${status}).`;
}

/** Whether `codex` resolves on PATH. */
function codexOnPath() {
  const probe =
    process.platform === 'win32'
      ? spawnSync('where', ['codex'], { stdio: 'ignore', windowsHide: true })
      : spawnSync('command', ['-v', 'codex'], { shell: true, stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Run the codex CLI. Output is captured as BYTES (no `encoding`), so the
 * child's console-code-page diagnostics reach the terminal unaltered.
 */
function codex(args) {
  if (process.platform !== 'win32') {
    return spawnSync('codex', args, { stdio: 'pipe' });
  }
  // Windows: codex may be an .exe or an npm .cmd shim; only a shell resolves
  // both. The shell needs explicit quoting for paths with spaces.
  const line = ['codex', ...args].map(quoteForShell).join(' ');
  return spawnSync(line, { shell: true, stdio: 'pipe', windowsHide: true });
}

function main() {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const serverPath = join(pluginRoot, 'dist', 'server.mjs');

  if (!codexOnPath()) {
    console.error(describeFailure(COMMAND_NOT_FOUND_EXIT_CODE));
    process.exit(1);
  }

  // Idempotent: drop any previous (possibly stale, version-specific) entry.
  codex(['mcp', 'remove', 'mellos-mapping']);

  const added = codex(['mcp', 'add', 'mellos-mapping', '--', 'node', serverPath]);
  if (added.status !== 0) {
    if (added.stderr) process.stderr.write(added.stderr);
    console.error(describeFailure(added.status));
    process.exit(1);
  }
  if (added.stdout) process.stdout.write(added.stdout);
  console.log(`mellos-mapping MCP registered with Codex: node ${serverPath}`);
  console.log('State files resolve to each session’s working directory (.mellos/map.json).');
}

/**
 * Run only as an entry point, so the spec can import the helpers above
 * without registering anything. Each script in this directory carries its own
 * copy: package.json ships them file-by-file, so a shared scripts/ module
 * would simply be missing from an npm install.
 */
function launchedAsEntry() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (launchedAsEntry()) main();
