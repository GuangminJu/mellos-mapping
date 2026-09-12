#!/usr/bin/env node
/** Verify the actual distribution over stdio in two independent projects. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packageCodex } from './package-codex.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = packageCodex(root);
const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const temporary = mkdtempSync(join(tmpdir(), 'mellos-codex-check-'));

async function checkProject(name) {
  const project = join(temporary, name);
  mkdirSync(project);
  const client = new Client({ name: 'codex-package-check', version: '1.0.0' });
  // No inherited host-specific project overrides. Simulates the user-level
  // registration's cwd contract, with spaces and CJK in actual disk paths.
  const env = getDefaultEnvironment();
  delete env.MELLOS_MAPPING_CWD;
  delete env.CLAUDE_PROJECT_DIR;
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(bundle, 'dist', 'server.mjs')], cwd: project, env, stderr: 'pipe',
  });
  let webUrl;
  let webRevision;
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, expectedVersion);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(),
      ['mmap_declare', 'mmap_open', 'mmap_remove', 'mmap_setup', 'mmap_update', 'mmap_view']);
    const declared = await client.callTool({ name: 'mmap_declare', arguments: {
      page: 'smoke', title: name, layers: [{ id: 'base', name: '基础', rank: 0 }],
      nodes: [{ id: 'runtime', label: '运行时', layer: 'base', detail: 'Verify local project isolation.' }],
    } });
    assert.notEqual(declared.isError, true, JSON.stringify(declared));
    const terminal = await client.callTool({ name: 'mmap_open', arguments: { page: 'smoke', surface: 'codex-terminal' } });
    assert.notEqual(terminal.isError, true, JSON.stringify(terminal));
    const terminalText = terminal.content[0].text;
    const handoff = JSON.parse(terminalText.slice(terminalText.indexOf('{'), terminalText.lastIndexOf('}') + 1));
    assert.deepEqual(handoff.args, [join(bundle, 'dist/watch.mjs'), '--file', join(project, '.mellos/map.json'), '--page', 'smoke']);
    assert.ok(existsSync(handoff.args[0]));
    assert.deepEqual(handoff.hostOpen, { placement: 'right', target: { type: 'terminal' } });
    const preview = await client.callTool({ name: 'mmap_open', arguments: { page: 'smoke', surface: 'markdown' } });
    assert.notEqual(preview.isError, true, JSON.stringify(preview));
    const previewPath = join(project, '.mellos', 'previews', 'page-smoke.md');
    assert.ok(readFileSync(previewPath, 'utf8').includes(name));
    const web = await client.callTool({ name: 'mmap_open', arguments: { page: 'smoke', surface: 'web' } });
    assert.notEqual(web.isError, true, JSON.stringify(web));
    webUrl = /^web: (.+)$/m.exec(web.content[0].text)?.[1];
    assert.ok(webUrl, 'Web surface must return a local URL');
    const webBase = new URL('.', webUrl);
    const request = (route) => fetch(new URL(route, webBase), { signal: AbortSignal.timeout(3000) });
    assert.ok((await (await fetch(webUrl)).text()).includes('交互地图画布'));
    assert.equal((await request('app.js')).status, 200);
    assert.equal((await request('app.css')).status, 200);
    webRevision = (await (await request('api/state')).json()).revision;
    const reused = await client.callTool({ name: 'mmap_open', arguments: { page: 'smoke', surface: 'web' } });
    assert.equal(/^web: (.+)$/m.exec(reused.content[0].text)?.[1], webUrl);
    const updated = await client.callTool({ name: 'mmap_update', arguments: {
      page: 'smoke', updates: [{ id: 'runtime', status: 'done', evidence: 'stdio declare/update/view passed' }],
    } });
    assert.notEqual(updated.isError, true, JSON.stringify(updated));
    const document = readFileSync(previewPath, 'utf8');
    assert.ok(document.includes('已验证 **1 / 1**'));
    const image = /!\[[^\]]*\]\((images\/[a-f0-9]+\.svg)\)/.exec(document)?.[1];
    assert.ok(image, 'Preview must reference a local SVG');
    assert.ok(readFileSync(join(dirname(previewPath), image), 'utf8').includes('<svg'));
    const view = await client.callTool({ name: 'mmap_view', arguments: { page: 'smoke' } });
    assert.notEqual(view.isError, true);
    assert.ok(view.content[0].text.includes(name));
    const stored = JSON.parse(readFileSync(join(project, '.mellos', 'pages', 'smoke.json'), 'utf8'));
    assert.equal(stored.title, name);
    assert.equal(stored.nodes[0].status, 'done');
    assert.ok(stored.nodes[0].evidence);
    const live = await (await request('api/state')).json();
    assert.notEqual(live.revision, webRevision);
    assert.equal(live.value.pages.find(page => page.id === 'smoke').map.nodes[0].status, 'done');
    assert.equal(live.value.pages.find(page => page.id === 'smoke').title, name);
    const refused = await client.callTool({ name: 'mmap_update', arguments: {
      page: 'smoke', updates: [{ id: 'runtime', evidance: 'typo' }],
    } });
    assert.equal(refused.isError, true);
    assert.deepEqual(JSON.parse(readFileSync(join(project, '.mellos', 'pages', 'smoke.json'), 'utf8')), stored);
  } finally {
    if (webUrl) await fetch(new URL('api/stop', new URL('.', webUrl)), { method: 'POST', signal: AbortSignal.timeout(3000) });
    await client.close();
    await transport.close();
  }
}

try {
  for (const excluded of ['.mcp.json', 'hooks', '.claude-plugin', 'node_modules', '.mellos']) {
    assert.equal(existsSync(join(bundle, excluded)), false, `${excluded} must not enter the Codex package`);
  }
  await checkProject('项目 A');
  await checkProject('Project B');
  assert.equal(existsSync(join(bundle, '.mellos')), false, 'Server wrote into its installation directory');
  console.log('Codex package: six tools, stdio handshake, Markdown/SVG refresh, live web assets/updates/reuse, strict errors and two-project isolation passed.');
} finally {
  // temporary is a fresh mkdtemp directory owned solely by this check.
  rmSync(temporary, { recursive: true, force: true });
}
