/** Install a prebuilt edition without npm dependencies or developer-local paths. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { hostRunner, requireSuccess } from './host-cli.mjs';
import { registerServer } from './codex-register.mjs';
import { verifyRuntime } from './verify-runtime.mjs';

const editions = ['claude', 'chatgpt-app'];
export const USAGE = 'node install.mjs [claude|chatgpt-app] [--check]';
const hash = data => createHash('sha256').update(data).digest('hex');

export function checkedPath(root, file) {
  if (isAbsolute(file) || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`Invalid release path: ${file}`);
  }
  const path = resolve(root, file);
  const rel = relative(resolve(root), path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes release: ${file}`);
  const boundary = resolve(root);
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Redirected installation path: ${cursor}`);
    if (cursor === boundary) break;
  }
  return path;
}

export function validateRelease(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
  if (!editions.includes(manifest.edition) || !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
      !manifest.sha256 || typeof manifest.sha256 !== 'object') throw new Error('Invalid release.json');
  const prefix = manifest.edition === 'chatgpt-app' ? 'plugins/mellos-mapping/' : '';
  for (const required of ['dist/server.mjs', 'dist/watch.mjs', 'skills/mellos-mapping/SKILL.md']) {
    if (!manifest.sha256[prefix + required]) throw new Error(`Release is missing ${required}`);
  }
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    if (hash(readFileSync(checkedPath(root, file))) !== expected) throw new Error(`Release checksum mismatch: ${file}. Download a complete release again.`);
  }
  return manifest;
}

export function copyRelease(source, target, manifest) {
  for (const file of [...Object.keys(manifest.sha256), 'release.json']) {
    const destination = checkedPath(target, file);
    const data = readFileSync(checkedPath(source, file));
    if (existsSync(destination) && readFileSync(destination).equals(data)) continue;
    mkdirSync(dirname(destination), { recursive: true });
    const temporary = `${destination}.install-${process.pid}`;
    try { writeFileSync(temporary, data, { flag: 'wx' }); renameSync(temporary, destination); }
    finally { if (existsSync(temporary)) rmSync(temporary); }
  }
}

export async function installRelease(source, argv, {
  env = process.env, installHome = join(homedir(), '.mellos', 'installations'),
  makeRunner = hostRunner, verify = verifyRuntime, log = console.log,
} = {}) {
  if (argv.includes('--help')) { log(USAGE); return; }
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js 18+ is required. Install Node.js and retry.');
  const selected = argv.find(arg => editions.includes(arg));
  if (argv.some(arg => !editions.includes(arg) && arg !== '--check') || argv.filter(arg => editions.includes(arg)).length > 1) throw new Error(USAGE);
  if (!existsSync(join(source, 'release.json'))) {
    if (!selected) throw new Error(`Choose the host: ${USAGE}`);
    const { packageEdition } = await import('./release-layout.mjs');
    source = packageEdition(source, selected);
  }
  const manifest = validateRelease(source);
  if (selected && selected !== manifest.edition) throw new Error(`This is the ${manifest.edition} edition. Clone the ${selected} branch instead.`);
  const edition = manifest.edition;
  const codex = edition === 'chatgpt-app';
  const run = makeRunner(edition, env);
  const cliVersion = requireSuccess(run(['--version']), 'Host CLI prerequisite').trim();
  requireSuccess(run(['plugin', codex ? 'add' : 'install', '--help']), 'Host plugin support (update your host CLI if missing)');
  if (codex) requireSuccess(run(['mcp', 'add', '--help']), 'Codex MCP registration support');
  const prefix = codex ? 'plugins/mellos-mapping' : '';
  const scratch = mkdtempSync(join(tmpdir(), 'mellos-install-check-'));
  // Use a new project; never migrate or write the caller's maps during installation.
  const checkEnv = { ...env };
  delete checkEnv.MELLOS_MAPPING_CWD;
  delete checkEnv.CLAUDE_PROJECT_DIR;
  try { await verify(join(source, prefix, 'dist/server.mjs'), scratch, checkEnv); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
  log(`Verified ${edition} ${manifest.version}: ${cliVersion}; all six MCP tools available.`);
  if (argv.includes('--check')) return { edition, checked: true };
  const target = join(installHome, edition);
  copyRelease(source, target, manifest);
  const market = codex ? 'mellos-mapping-codex' : 'mellos-mapping';
  if (codex) {
    requireSuccess(run(['plugin', 'marketplace', 'add', target]), 'Register Codex marketplace');
    requireSuccess(run(['plugin', 'add', `mellos-mapping@${market}`]), 'Install Codex plugin');
    registerServer(join(target, prefix), { run });
    const registered = JSON.parse(requireSuccess(run(['mcp', 'get', 'mellos-mapping', '--json']), 'Verify MCP registration'));
    const transport = registered.transport ?? registered;
    if (!transport.args?.includes(join(target, prefix, 'dist/server.mjs'))) throw new Error('Codex MCP registration points to a different runtime.');
    const plugins = JSON.parse(requireSuccess(run(['plugin', 'list', '--marketplace', market, '--json']), 'Verify Codex plugin installation'));
    if (!plugins.installed?.some(plugin => plugin.name === 'mellos-mapping' && plugin.enabled && plugin.version === manifest.version)) {
      throw new Error('Codex did not report this release as installed and enabled.');
    }
  } else {
    // A local catalog has a stable path. Re-running installation updates its cache.
    const listed = JSON.parse(requireSuccess(run(['plugin', 'marketplace', 'list', '--json']), 'Read Claude marketplaces'));
    const markets = Array.isArray(listed) ? listed : listed.marketplaces ?? [];
    const existing = markets.find(entry => entry.name === market);
    if (existing) {
      const location = existing.source?.path ?? existing.source?.source ?? existing.path ?? existing.installLocation;
      if (!location || resolve(location) !== resolve(target)) {
        throw new Error(`Claude marketplace '${market}' already comes from another source. Keep that install, or remove that marketplace with Claude before switching to this clone.`);
      }
      requireSuccess(run(['plugin', 'marketplace', 'update', market]), 'Update Claude marketplace');
    } else requireSuccess(run(['plugin', 'marketplace', 'add', target]), 'Register Claude marketplace');
    requireSuccess(run(['plugin', 'install', `mellos-mapping@${market}`, '--scope', 'user']), 'Install Claude plugin');
    if (existing) requireSuccess(run(['plugin', 'update', `mellos-mapping@${market}`]), 'Update Claude plugin');
    const plugins = JSON.parse(requireSuccess(run(['plugin', 'list', '--json']), 'Verify Claude plugin installation'));
    if (!plugins.some(plugin => plugin.id === `mellos-mapping@${market}` && plugin.enabled && plugin.version === manifest.version)) {
      throw new Error('Claude did not report this release as installed and enabled.');
    }
  }
  log(`Installed in ${target}. The clone can be moved or deleted; runtime files are retained here.`);
  log('Start a new host conversation to load the skill and tools. Existing conversations keep their previous tools.');
  if (codex) log('Ask: 用梅勒斯地图制定计划，并在当前对话右侧终端展示。 If the host has no terminal-input tool, paste the supplied startup command once.');
  return { edition, target, market };
}
