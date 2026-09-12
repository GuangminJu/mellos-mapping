#!/usr/bin/env node
/** Opt-in real host CLI check; all configuration and runtime paths are temporary. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  console.log(JSON.stringify({ edition, firstInstall: true, repeatedInstall: true,
    cloneRemoved: true, runtimeHandshake: true, installation: JSON.parse(installed) }, null, 2));
} finally {
  // Solely the generated test profile and configuration, never the real profile.
  rmSync(temporary, { recursive: true, force: true });
}
