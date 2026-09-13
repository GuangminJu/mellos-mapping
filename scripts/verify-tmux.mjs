#!/usr/bin/env node
/** Linux integration check: real MCP, launcher, tmux PTYs and viewer reports.
 * Uses a private tmux socket directory; never inspects or mutates user sessions.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readLiveViewers, STATE_FILE_RELATIVE_PATH } from '../dist/store-paths.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'mmap-tmux-'));
const project = join(temporary, "项目 ' $(literal); path");
mkdirSync(project);
const env = { ...process.env, TMUX_TMPDIR: temporary, MELLOS_MAPPING_CWD: project, TERM: 'xterm-256color' };
for (const key of ['TMUX', 'TMUX_PANE', 'MELLOS_MAPPING_TMUX_SOCKET', 'MELLOS_MAPPING_TMUX_TARGET']) delete env[key];
const clients = [];
const terminalClients = [];
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
function tmux(...args) {
  const result = spawnSync('tmux', args, { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('tmux client did not reach the expected state');
}
async function attach(session) {
  const child = spawn('script', ['-q', '-c', ['tmux', 'attach-session', '-t', session].map(quote).join(' '), '/dev/null'], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  terminalClients.push(child);
  child.stdout.resume();
  child.stderr.resume();
  await until(() => Number(tmux('display-message', '-p', '-t', session, '#{session_attached}')) > 0);
}
async function connect(overrides = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/server.mjs')],
    env: { ...env, ...overrides }, stderr: 'pipe' });
  const client = new Client({ name: 'tmux-integration', version: '1.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}
async function call(client, name, args = {}, error = false) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  assert.equal(result.isError === true, error, text);
  return text;
}
const paneCount = () => tmux('list-panes', '-a', '-F', '#{pane_id}').split('\n').length;

try {
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'source', '-x', '180', '-y', '45');
  const sourcePane = tmux('display-message', '-p', '-t', 'source', '#{pane_id}');
  const sourceWindow = tmux('display-message', '-p', '-t', 'source', '#{window_id}');
  const inheritedTmux = tmux('display-message', '-p', '-t', 'source', '#{socket_path},#{pid},0');
  await attach('source');
  const client = await connect(); // No TMUX: discover the single attached session.
  const declaration = { layers: [{ id: 'base', name: 'Base', rank: 0 }], nodes: [{ id: 'core', label: 'Core', layer: 'base' }] };
  await call(client, 'mmap_declare', { ...declaration, page: 'first' });
  assert.match(await call(client, 'mmap_open', { page: 'first' }), /backend=tmux/);
  assert.equal(paneCount(), 2);
  assert.equal(tmux('display-message', '-p', '-t', 'source', '#{pane_id}'), sourcePane);
  await call(client, 'mmap_declare', { ...declaration, page: 'second' });
  assert.match(await call(client, 'mmap_open', { page: 'second' }), /already-open/);
  assert.equal(paneCount(), 2);
  const rendered = tmux('capture-pane', '-p', '-t', tmux('list-panes', '-t', sourceWindow, '-F', '#{pane_id}').split('\n')[1]);
  assert.match(rendered, /Core|Base/);
  assert.match(await call(client, 'mmap_open', { page: 'second', window: true }), /mode=window/);
  assert.equal(paneCount(), 3);
  assert.match(await call(client, 'mmap_open', { page: 'first', window: true }), /already-open/);
  assert.equal(paneCount(), 3);

  tmux('new-session', '-d', '-s', 'other', '-x', '180', '-y', '45');
  await attach('other');
  const ambiguous = await call(client, 'mmap_open', { page: 'second' }, true);
  assert.match(ambiguous, /Multiple attached tmux sessions/);
  assert.match(ambiguous, /Run this command in a visible terminal/);
  assert.equal(paneCount(), 4);
  // A failed new placement must not hide an existing, visibly running viewer.
  assert.match(await call(client, 'mmap_update', { page: 'second', updates: [{ id: 'core', status: 'in-progress' }] }), /pane: open/);

  // An inherited exact pane wins even with several attached sessions.
  const inherited = await connect({ TMUX: inheritedTmux, TMUX_PANE: sourcePane });
  assert.match(await call(inherited, 'mmap_open', { page: 'second' }), /already-open/);
  assert.equal(paneCount(), 4);
  const explicit = await connect({ MELLOS_MAPPING_TMUX_SOCKET: tmux('display-message', '-p', '#{socket_path}'),
    MELLOS_MAPPING_TMUX_TARGET: sourcePane });
  assert.match(await call(explicit, 'mmap_open', { page: 'second' }), /already-open/);
  assert.equal(paneCount(), 4);

  // The human toggle closes only this pane, and can reopen it afterwards.
  const toggle = () => spawnSync(process.execPath, [join(root, 'dist/mmap.mjs')], {
    env: { ...env, TMUX: inheritedTmux, TMUX_PANE: sourcePane }, cwd: project, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(toggle().status, 0);
  await until(() => paneCount() === 3);
  assert.equal(toggle().status, 0);
  assert.equal(paneCount(), 4);
  const forced = spawnSync(process.execPath, [join(root, 'scripts/open-pane.mjs'), project, '--force', '--page', 'second', '--no-follow'], {
    env: { ...env, TMUX: inheritedTmux, TMUX_PANE: sourcePane }, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(paneCount(), 5);
  assert.ok(readLiveViewers(join(project, STATE_FILE_RELATIVE_PATH), Date.now()).some(viewer => !viewer.follow));

  // A host without tmux must stop asking to reopen on every write, and the
  // exact fallback it returns must run when pasted into a visible terminal.
  const fallbackProject = join(temporary, "fallback ' $(literal)");
  mkdirSync(fallbackProject);
  const noTmux = await connect({ PATH: '/nonexistent', MELLOS_MAPPING_CWD: fallbackProject });
  await call(noTmux, 'mmap_declare', { ...declaration, page: 'first' });
  const unavailable = await call(noTmux, 'mmap_open', { page: 'first' }, true);
  assert.match(unavailable, /ENOENT/);
  assert.match(await call(noTmux, 'mmap_update', { page: 'first', updates: [{ id: 'core', status: 'in-progress' }] }), /automatic opening previously failed/);
  assert.match(await call(noTmux, 'mmap_view', { page: 'first' }), /Do not retry mmap_open/);
  const fallback = unavailable.split('Run this command in a visible terminal:\n')[1]?.split('\n')[0];
  assert.ok(fallback);
  tmux('new-window', '-t', 'source:', '-n', 'fallback', '-c', fallbackProject, fallback);
  await until(() => readLiveViewers(join(fallbackProject, STATE_FILE_RELATIVE_PATH), Date.now()).some(viewer => viewer.page === 'first'));
  assert.match(await call(noTmux, 'mmap_view', { page: 'first' }), /pane: open on this page/);
  console.log('tmux integration passed: stripped/inherited TMUX, explicit target/socket, literal paths, rendering, focus, reuse, page retarget, new window, force, ambiguous sessions, failure feedback, runnable fallback and human toggle.');
} finally {
  for (const client of clients) await client.close().catch(() => {});
  spawnSync('tmux', ['kill-server'], { env, timeout: 5000 });
  for (const child of terminalClients) {
    child.stdin.destroy();
    child.kill();
  }
  rmSync(temporary, { recursive: true, force: true });
}
