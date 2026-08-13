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
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(pluginRoot, 'dist', 'server.mjs');

function codex(args) {
  if (process.platform !== 'win32') {
    return spawnSync('codex', args, { stdio: 'pipe', encoding: 'utf8' });
  }
  // Windows: codex may be an .exe or an npm .cmd shim; only a shell resolves
  // both. The shell needs explicit quoting for paths with spaces.
  const line = ['codex', ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
  return spawnSync(line, { shell: true, stdio: 'pipe', encoding: 'utf8' });
}

// Idempotent: drop any previous (possibly stale, version-specific) entry.
codex(['mcp', 'remove', 'mellos-mapping']);

const added = codex(['mcp', 'add', 'mellos-mapping', '--', 'node', serverPath]);
if (added.error !== undefined || added.status !== 0) {
  process.stderr.write(added.stderr ?? '');
  console.error(
    added.error !== undefined
      ? 'codex CLI not found on PATH — install Codex first, then re-run this script.'
      : `codex mcp add failed (exit ${added.status}).`,
  );
  process.exit(1);
}
process.stdout.write(added.stdout ?? '');
console.log(`mellos-mapping MCP registered with Codex: node ${serverPath}`);
console.log('State files resolve to each session’s working directory (.claude/mellos-mapping.json).');
