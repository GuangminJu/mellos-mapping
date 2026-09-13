#!/usr/bin/env node
// @ts-check
/**
 * Register the shared runtime at user scope so it inherits each session's
 * working directory. The skill bundle and the runtime are separate host
 * adapters over the same core; no workspace path is baked into an install.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFile, launchedAsEntry, runCodex } from './codex-cli.mjs';

export const COMMAND_NOT_FOUND_EXIT_CODE = 9009;

/** @param {number | null} status */
export function describeFailure(status) {
  return status === COMMAND_NOT_FOUND_EXIT_CODE || status === null
    ? 'codex CLI not found on PATH — install Codex first, then re-run this script.'
    : `codex mcp add failed (exit ${status}).`;
}

/**
 * Validate before changing configuration. `mcp add` replaces its named entry
 * in one operation; removing first creates an unnecessary failure window.
 * Dependencies are supplied here so tests cannot change the real user config.
 * @param {string} pluginRoot
 * @param {{run?: import('./install-types.js').HostRunner, nodePath?: string, fileExists?: (path: string) => boolean}} [options]
 */
export function registerServer(pluginRoot, { run = runCodex, nodePath = process.execPath, fileExists = isFile } = {}) {
  const serverPath = join(pluginRoot, 'dist', 'server.mjs');
  if (!fileExists(serverPath)) throw new Error(`Bundled MCP server is missing: ${serverPath}. Build or reinstall the plugin first.`);
  const result = run(['mcp', 'add', 'mellos-mapping', '--', nodePath, serverPath]);
  if (result.error) throw new Error(`Codex registration could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`${describeFailure(result.status)}${detail ? `\n${detail}` : ''}`);
  }
  return { serverPath, nodePath };
}

if (launchedAsEntry(import.meta.url)) {
  try {
    const installed = registerServer(dirname(dirname(fileURLToPath(import.meta.url))));
    console.log(`mellos-mapping MCP registered with Codex: ${installed.nodePath} ${installed.serverPath}`);
    console.log('State files resolve to each session’s working directory (.mellos/map.json).');
    console.log('Start a new Codex conversation to load the skills and six mmap tools.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
