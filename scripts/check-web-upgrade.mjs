#!/usr/bin/env node
/** Optional acceptance against an actual previous edition's dist/web.mjs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveMapFile } from '../lib/store/maps.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!process.argv[2]) throw new Error('Pass the previous edition dist/web.mjs');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-web-upgrade-')));
const file = join(dir, '.mellos/map.json');
const urls = [];
const map = { title: 'Persistent map', layers: [], groups: [], lanes: [], nodes: [], edges: [] };
async function launch(entry) {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(entry), dir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Old viewer startup timed out')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); code === 0 ? resolvePromise(stdout) : reject(new Error(stderr)); });
  });
  return JSON.parse(output).url;
}
try {
  assert.ok(saveMapFile(file, map).ok);
  const oldUrl = await launch(process.argv[2]); urls.push(oldUrl);
  assert.ok(!(await (await fetch(new URL('api/health', oldUrl))).json()).formats?.includes(2));
  assert.ok(saveMapFile(file, { ...map, context: { next: 'Resume with source checks' } }).ok);
  const nextUrl = await launch(join(root, 'dist/web.mjs')); urls.push(nextUrl);
  assert.notEqual(nextUrl, oldUrl);
  assert.ok((await (await fetch(new URL('api/health', nextUrl))).json()).formats.includes(2));
  const state = await (await fetch(new URL('api/state', nextUrl))).json();
  assert.equal(state.value.pages[0].map.context.next, 'Resume with source checks');
  console.log('Web upgrade: actual previous service replaced; format-2 checkpoint preserved and visible through the new service.');
} finally {
  for (const url of urls) await fetch(new URL('api/stop', url), { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => {});
  assert.equal(dirname(dir), realpathSync(tmpdir())); assert.ok(basename(dir).startsWith('mellos-web-upgrade-'));
  rmSync(dir, { recursive: true, force: true });
}
