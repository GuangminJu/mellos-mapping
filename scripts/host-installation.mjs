// @ts-check
/** Host protocol adapters. Acceptance checks the files the host actually loads. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerServer } from './codex-register.mjs';
import { requireSuccess } from './host-cli.mjs';
import { checkedPath } from './release-files.mjs';

/** @param {string} root @param {import('./install-types.js').ReleaseManifest} manifest */
export function verifyInstalledFiles(root, manifest) {
  const prefix = manifest.edition === 'chatgpt-app' ? 'plugins/mellos-mapping/' : '';
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    if (!file.startsWith(prefix)) continue;
    const local = file.slice(prefix.length);
    // Verify runtime, instructions and host configuration, not distribution tooling.
    if (!/^(dist\/|scripts\/|skills\/|commands\/|hooks\/|\.mcp\.json$|\.(?:claude|codex)-plugin\/plugin\.json$)/.test(local)) continue;
    let actual;
    try { actual = createHash('sha256').update(readFileSync(checkedPath(root, local))).digest('hex'); }
    catch (error) { throw new Error(`Host installation is incomplete: ${local}`, { cause: error }); }
    if (actual !== expected) throw new Error(`Host cache contains different files: ${local}. Publish a new version before updating; a matching version number does not prove an upgrade.`);
  }
}

/** @param {string} edition @param {string} target @param {import('./install-types.js').HostRunner} run */
export function createHostInstallation(edition, target, run) {
  const codex = edition === 'chatgpt-app';
  const market = codex ? 'mellos-mapping-codex' : 'mellos-mapping';
  const id = `mellos-mapping@${market}`;
  const prefix = codex ? 'plugins/mellos-mapping' : '';
  /** @param {string[]} args @param {string} label */
  const json = (args, label) => JSON.parse(requireSuccess(run(args), label));
  /** @returns {import('./install-types.js').HostPlugin[]} */
  const list = () => {
    const value = json(['plugin', 'list', '--json'], 'Read installed plugins');
    return codex ? value.installed ?? [] : value;
  };
  /** @param {import('./install-types.js').HostPlugin} plugin */
  const matches = plugin => codex ? plugin.pluginId === id : plugin.id === id;
  const previous = list().find(matches);
  /** @type {boolean} */
  let existing = false;
  if (!codex) {
    const listed = json(['plugin', 'marketplace', 'list', '--json'], 'Read Claude marketplaces');
    const registered = (Array.isArray(listed) ? listed : listed.marketplaces ?? []).find(/** @param {{name: string}} entry */ entry => entry.name === market);
    existing = registered !== undefined;
    if (registered) {
      const location = registered.source?.path ?? registered.source?.source ?? registered.path ?? registered.installLocation;
      if (!location || resolve(location) !== resolve(target)) throw new Error(`Claude marketplace '${market}' already comes from another source. Keep that install, or remove that marketplace with Claude before switching to this clone.`);
    }
  } else if (previous && resolve(previous.source?.path ?? '') !== resolve(join(target, prefix))) {
    throw new Error('Codex plugin already comes from another source. Keep that install, or remove it before switching.');
  }
  return {
    market,
    previous,
    /** @param {import('./install-types.js').ReleaseManifest} manifest */
    install(manifest) {
      if (codex) {
        requireSuccess(run(['plugin', 'marketplace', 'add', target]), 'Register Codex marketplace');
        requireSuccess(run(['plugin', 'add', id]), 'Install Codex plugin');
        registerServer(join(target, prefix), { run });
        const registered = json(['mcp', 'get', 'mellos-mapping', '--json'], 'Verify MCP registration');
        if (!(registered.transport ?? registered).args?.includes(join(target, prefix, 'dist/server.mjs'))) throw new Error('Codex MCP registration points to a different runtime.');
      } else {
        requireSuccess(run(existing ? ['plugin', 'marketplace', 'update', market] : ['plugin', 'marketplace', 'add', target]), 'Register or update Claude marketplace');
        existing = true;
        requireSuccess(run(['plugin', 'install', id, '--scope', 'user']), 'Install Claude plugin');
        requireSuccess(run(['plugin', 'update', id, '--scope', 'user']), 'Update Claude plugin');
      }
      const installed = list().find(matches);
      if (!installed?.enabled || installed.version !== manifest.version) throw new Error(`${edition} did not report this release as installed and enabled.`);
      const runtimeRoot = codex ? installed.source?.path : installed.installPath;
      if (!runtimeRoot) throw new Error(`${edition} did not report the installed runtime path; upgrade the host CLI before retrying.`);
      verifyInstalledFiles(runtimeRoot, manifest);
      return runtimeRoot;
    },
  };
}
