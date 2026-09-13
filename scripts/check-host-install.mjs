#!/usr/bin/env node
/** Opt-in real host CLI check; all configuration and runtime paths are temporary. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageEdition } from './release-layout.mjs';
import { copyRelease, installRelease, validateRelease } from './install-release.mjs';
import { hostRunner, requireSuccess } from './host-cli.mjs';
import { verifyRuntime } from './verify-runtime.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edition = process.argv[2];
if (!['claude', 'chatgpt-app'].includes(edition)) throw new Error('Specify claude or chatgpt-app');
const temporary = mkdtempSync(join(tmpdir(), 'mellos-real-host-'));
try {
  const profile = join(temporary, '用户 & home');
  const hostConfig = join(profile, 'host-config');
  mkdirSync(hostConfig, { recursive: true });
  const env = { ...process.env, CODEX_HOME: hostConfig, CLAUDE_CONFIG_DIR: hostConfig,
    HOME: profile, USERPROFILE: profile };
  delete env.MELLOS_MAPPING_CWD; delete env.CLAUDE_PROJECT_DIR;
  const original = packageEdition(root, edition);
  const clone = join(temporary, '克隆 & source');
  copyRelease(original, clone, validateRelease(original));
  const installHome = join(profile, '.mellos/installations');
  const logs = [];
  const options = { env, installHome, log: value => logs.push(value) };
  const old = join(temporary, 'previous release');
  const oldManifest = validateRelease(clone);
  copyRelease(clone, old, oldManifest);
  const version = oldManifest.version;
  const [major, minor, patch] = version.split('.').map(Number);
  oldManifest.version = patch > 0 ? `${major}.${minor}.${patch - 1}` : minor > 0 ? `${major}.${minor - 1}.999` : `${major - 1}.999.999`;
  for (const file of Object.keys(oldManifest.sha256)) {
    const path = join(old, file);
    if (file.endsWith('.json')) {
      const content = readFileSync(path, 'utf8').replaceAll(`"version": "${version}"`, `"version": "${oldManifest.version}"`);
      writeFileSync(path, content);
    }
    if (file.endsWith('dist/server.mjs')) writeFileSync(path, readFileSync(path, 'utf8') + '\n// Previous release fixture\n');
    oldManifest.sha256[file] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  writeFileSync(join(old, 'release.json'), JSON.stringify(oldManifest));
  const previous = await installRelease(old, [], options);
  let checks = 0;
  await assert.rejects(installRelease(clone, [], { ...options, verify: async (...args) => {
    if (++checks === 2) throw new Error('Injected post-install failure');
    return verifyRuntime(...args);
  } }), /Injected post-install failure/);
  assert.deepEqual(validateRelease(previous.target), oldManifest);
  const first = await installRelease(clone, [], options);
  const second = await installRelease(clone, [], options);
  assert.equal(first.target, second.target);
  // Move/delete the clone; the runtime must continue to work without it.
  rmSync(clone, { recursive: true, force: true });
  const prefix = edition === 'chatgpt-app' ? 'plugins/mellos-mapping' : '';
  await verifyRuntime(join(first.target, prefix, 'dist/server.mjs'), profile, env);
  const run = hostRunner(edition, env);
  const installed = requireSuccess(run(edition === 'chatgpt-app'
    ? ['plugin', 'list', '--marketplace', first.market, '--json']
    : ['plugin', 'list', '--json']), 'List installed plugins');
  assert.ok(installed.includes('mellos-mapping'));
  console.log(JSON.stringify({ edition, firstInstall: true, upgrade: true, failedUpgradeRestored: true, repeatedInstall: true,
    cloneRemoved: true, runtimeHandshake: true, installation: JSON.parse(installed) }, null, 2));
} finally {
  // Solely the generated test profile and configuration, never the real profile.
  rmSync(temporary, { recursive: true, force: true });
}
