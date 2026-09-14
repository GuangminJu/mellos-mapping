#!/usr/bin/env node
/** Opt-in real host CLI check; all configuration and runtime paths are temporary. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageEdition } from './release-layout.mjs';
import { copyRelease, installRelease, validateRelease } from './install-release.mjs';
import { hostRunner, requireSuccess } from './host-cli.mjs';
import { verifyRuntime } from './verify-runtime.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Read installed skills using an optional actual desktop engine, without model turns. */
async function checkDesktopSkills(engine, env, cwd) {
  const child = spawn(engine, ['app-server', '--listen', 'stdio://'], { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const ended = new Promise(resolve => child.once('close', resolve));
  child.stderr.resume();
  const input = createInterface({ input: child.stdout });
  let id = 0;
  const pending = new Map();
  input.on('line', line => { let message; try { message = JSON.parse(line); } catch { return; } const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); });
  const request = (method, params) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timed out: ${method}`)); }, 25000); pending.set(key, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n'); });
  try {
    const hello = await request('initialize', { clientInfo: { name: 'mellos-install-check', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const response = await request('skills/list', { cwds: [cwd], forceReload: true });
    const skills = response.data.flatMap(entry => entry.skills).filter(skill => skill.name.includes('mellos-mapping'));
    assert.equal(skills.length, 1); assert.equal(skills[0].enabled, true);
    assert.match(skills[0].description, /resume persistent/);
    return { engine: hello.userAgent, skills };
  } finally { for (const waiter of pending.values()) clearTimeout(waiter.timer); child.stdin.end(); const stop = setTimeout(() => child.kill(), 1500); await ended; clearTimeout(stop); input.close(); }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const edition = process.argv[2];
// Optional actual previous and candidate edition directories for release acceptance.
const previousRelease = process.argv[3];
const nextRelease = process.argv[4];
if (!['claude', 'chatgpt-app'].includes(edition)) throw new Error('Specify claude or chatgpt-app');
const temporary = mkdtempSync(join(tmpdir(), 'mellos-real-host-'));
try {
  const profile = join(temporary, '用户 & home');
  const hostConfig = join(profile, 'host-config');
  mkdirSync(hostConfig, { recursive: true });
  const env = { ...process.env, CODEX_HOME: hostConfig, CLAUDE_CONFIG_DIR: hostConfig,
    HOME: profile, USERPROFILE: profile };
  delete env.MELLOS_MAPPING_CWD; delete env.CLAUDE_PROJECT_DIR;
  const original = nextRelease ?? packageEdition(root, edition);
  const clone = join(temporary, '克隆 & source');
  copyRelease(original, clone, validateRelease(original));
  const installHome = join(profile, '.mellos/installations');
  const logs = [];
  const options = { env, installHome, log: value => logs.push(value) };
  const old = join(temporary, 'previous release');
  const oldManifest = validateRelease(previousRelease ?? clone);
  copyRelease(previousRelease ?? clone, old, oldManifest);
  if (!previousRelease) {
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
  }
  // Verify actual older releases against their own protocol contract (six vs eight tools).
  const { verifyRuntime: verifyPrevious } = await import(pathToFileURL(join(old, 'scripts/verify-runtime.mjs')).href);
  const previous = await installRelease(old, [], { ...options, verify: verifyPrevious });
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
  const desktop = edition === 'chatgpt-app' && process.argv[5] ? await checkDesktopSkills(process.argv[5], env, profile) : undefined;
  console.log(JSON.stringify({ edition, previousVersion: oldManifest.version, version: validateRelease(first.target).version,
    previousRelease: previousRelease ?? 'synthetic previous release fixture',
    firstInstall: true, upgrade: true, failedUpgradeRestored: true, repeatedInstall: true,
    cloneRemoved: true, runtimeHandshake: true, installation: JSON.parse(installed), ...(desktop ? { desktop } : {}) }, null, 2));
} finally {
  // Solely the generated test profile and configuration, never the real profile.
  rmSync(temporary, { recursive: true, force: true });
}
