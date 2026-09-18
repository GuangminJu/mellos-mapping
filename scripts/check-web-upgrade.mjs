#!/usr/bin/env node
/** Optional acceptance of the explicit restart from an actual legacy viewer. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, realpathSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveMapFile } from '../lib/store/maps.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!process.argv[2]) throw new Error('Pass the previous edition dist/web.mjs');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-web-upgrade-')));
const project = join(dir, 'project');
const file = join(project, '.mellos/map.json');
const runtimeDirectory = join(project, '.mellos/web');
const runtimeFile = join(runtimeDirectory, 'server.json');
const nextEntry = join(root, 'dist/web.mjs');
const services = [];
const map = { title: 'Persistent map', layers: [], groups: [], lanes: [], nodes: [], edges: [],
  context: { next: 'Resume with source checks' } };

async function cli(entry, ...args) {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(entry), project, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Viewer CLI timed out')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); code === 0 ? resolvePromise(stdout) : reject(new Error(stderr)); });
  });
  return JSON.parse(output);
}

/** Own the real service process so stopping is checked by its exit event. */
async function startService(entry) {
  const child = spawn(process.execPath, [entry, '--serve', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const service = { child, exited: new Promise(resolvePromise => child.once('close', resolvePromise)), url: undefined };
  services.push(service);
  service.url = await new Promise((resolvePromise, reject) => {
    let watcher;
    const finish = (error, url) => {
      clearTimeout(deadline); watcher?.close();
      child.off('error', onError); child.off('close', onClose);
      error ? reject(error) : resolvePromise(url);
    };
    const onError = error => finish(error);
    const onClose = code => finish(new Error(`Viewer exited before readiness (${code}): ${stderr}`));
    const inspect = () => {
      try {
        const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
        if (runtime.pid === child.pid) finish(null, `http://127.0.0.1:${runtime.port}/${runtime.token}/`);
      } catch { /* An atomic rename may produce multiple directory events. */ }
    };
    const deadline = setTimeout(() => finish(new Error(`Viewer readiness timed out: ${stderr}`)), 15000);
    child.once('error', onError); child.once('close', onClose);
    watcher = watch(runtimeDirectory, inspect);
    // Subscribe before reading to cover readiness both before and after subscribe.
    inspect();
  });
  return service;
}

async function waitForExit(service) {
  let deadline;
  try {
    const code = await Promise.race([service.exited, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Viewer did not exit after stop')), 5000);
    })]);
    assert.equal(code, 0);
  } finally { clearTimeout(deadline); }
}

async function json(url, route) {
  const response = await fetch(new URL(route, url), { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  // Copy every old runtime asset, never execute from a user's installed plugin.
  const oldDist = join(dir, 'previous-dist');
  cpSync(dirname(resolve(process.argv[2])), oldDist, { recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });
  assert.ok(saveMapFile(file, map).ok);
  const original = readFileSync(file);
  const old = await startService(join(oldDist, basename(process.argv[2])));
  const oldHealth = await json(old.url, 'api/health');
  assert.notEqual(oldHealth.lockProtocol, 'os-file-v1', 'Supply a release from before OS file locks');
  // 0.23/0.24 already support format 2. Format support cannot authorize reuse.
  await assert.rejects(cli(nextEntry), /older storage-lock protocol/);
  assert.equal((await json(old.url, 'api/health')).pid, oldHealth.pid);
  assert.deepEqual(readFileSync(file), original);

  assert.equal((await cli(nextEntry, '--stop')).stopped, true);
  await waitForExit(old);
  assert.equal(existsSync(runtimeFile), false);

  const probe = join(project, '.mellos/pages/upgrade-probe.json');
  assert.ok(saveMapFile(probe, { ...map, title: 'Disposable upgrade write probe' }).ok);
  const next = await startService(nextEntry);
  assert.equal((await cli(nextEntry)).url, next.url);
  const health = await json(next.url, 'api/health');
  assert.equal(health.lockProtocol, 'os-file-v1');
  assert.ok(health.formats.includes(2));
  const state = await json(next.url, 'api/state');
  assert.equal(state.value.pages.find(page => page.id === '').map.context.next, map.context.next);
  const deleted = await fetch(new URL('api/pages/upgrade-probe', next.url), {
    method: 'DELETE', headers: { 'If-Match': `"${state.revision}"` }, signal: AbortSignal.timeout(3000),
  });
  assert.equal(deleted.status, 200, await deleted.text());
  assert.equal(existsSync(probe), false);
  assert.ok(lstatSync(join(project, '.mellos/.write-lock')).isFile());
  assert.deepEqual(readFileSync(file), original);
  assert.equal((await cli(nextEntry, '--stop')).stopped, true);
  await waitForExit(next);
  console.log('Web upgrade: legacy reuse refused; explicit stop/restart preserved the format-2 checkpoint; new viewer mutation acquired the permanent OS lock.');
} finally {
  // Also clean up a service whose startup or assertion failed before its URL was returned.
  for (const service of services) {
    if (service.child.exitCode === null && service.child.signalCode === null) service.child.kill();
    await service.exited;
  }
  assert.equal(dirname(dir), realpathSync(tmpdir())); assert.ok(basename(dir).startsWith('mellos-web-upgrade-'));
  rmSync(dir, { recursive: true, force: true });
}
