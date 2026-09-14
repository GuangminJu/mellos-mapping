#!/usr/bin/env node
/** Opt-in model acceptance. Uses the signed-in account, isolated config/projects,
 * actual installed plugin, and task-bound app-server completion notifications.
 * Usage: node scripts/check-codex-dialogue.mjs [cli|absolute-engine.exe] [label] [resume|proactive]
 * This consumes model usage; it is deliberately outside npm run verify.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { installRelease } from './install-release.mjs';
import { resolveCodexInvocation } from './codex-cli.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const engine = process.argv[2] ?? 'cli';
const label = process.argv[3] ?? (engine === 'cli' ? 'cli' : 'app-engine');
assert.match(label, /^[a-z0-9-]+$/);
const mode = process.argv[4] ?? 'resume';
assert.ok(['resume', 'proactive'].includes(mode), 'Mode must be resume or proactive');
const output = join(root, 'artifacts/audit/codex-reuse/dialogue', label);
mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'mellos-dialogue-')));
const profile = join(temporary, 'profile');
const configHome = join(profile, '.codex');
const project = join(temporary, 'registration-project');
const originalConfigHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const originalConfig = readFileSync(join(originalConfigHome, 'config.toml'), 'utf8');
const model = originalConfig.match(/^model\s*=\s*"([\w.-]+)"/m)?.[1];
const effort = originalConfig.match(/^model_reasoning_effort\s*=\s*"([\w-]+)"/m)?.[1];
assert.ok(model && effort, 'Expected explicit existing model and effort configuration');
const env = { ...process.env, CODEX_HOME: configHome, HOME: profile, USERPROFILE: profile };
// A child launched by the desktop must not inherit its live thread/tool bridge.
for (const key of Object.keys(env)) if (key.startsWith('CODEX_') && key !== 'CODEX_HOME') delete env[key];
delete env.MELLOS_MAPPING_CWD; delete env.CLAUDE_PROJECT_DIR;
const invocation = engine === 'cli' ? resolveCodexInvocation() : { command: resolve(engine), args: [] };
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const mapFile = join(project, '.mellos/pages/registration.json');
const snapshot = () => JSON.parse(readFileSync(mapFile, 'utf8'));
const results = { label, mode, model, effort, pluginVersion: JSON.parse(readFileSync(join(root, 'artifacts/release/chatgpt-app/release.json'), 'utf8')).version, scenarios: [] };
const eventFile = join(output, 'events.jsonl');
writeFileSync(eventFile, '');
let active;

class Host {
  events = []; pending = new Map(); listeners = new Set(); id = 0;
  constructor(cwd) {
    this.child = spawn(invocation.command, [...invocation.args, 'app-server', '--listen', 'stdio://'], {
      cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.closed = new Promise(resolve => this.child.once('close', code => {
      this.ended = true;
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error(`Host exited: ${code}`)); }
      this.pending.clear();
      for (const listener of this.listeners) listener.fail(new Error(`Host exited: ${code}`));
      resolve(code);
    }));
    this.child.once('error', error => {
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
      this.pending.clear();
      for (const listener of this.listeners) listener.fail(error);
    });
    this.child.stdin.on('error', () => {}); // close/error above releases callers.
    // Host stderr can include user configuration. Keep it out of the artifacts.
    this.child.stderr.resume();
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) {
        appendFileSync(eventFile, JSON.stringify({ unexpectedRequest: message.method }) + '\n');
        this.send({ id: message.id, error: { code: -32601, message: 'No interactive input in acceptance harness' } });
        return;
      }
      if (message.id !== undefined) {
        const task = this.pending.get(message.id); if (!task) return;
        this.pending.delete(message.id); clearTimeout(task.timer);
        message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
        return;
      }
      this.events.push(message);
      for (const listener of [...this.listeners]) listener.check(message);
      const item = message.params?.item;
      if (message.method === 'item/completed' && item?.type !== 'reasoning') {
        appendFileSync(eventFile, JSON.stringify(message) + '\n');
        if (item?.type === 'mcpToolCall') console.log(`${label}: ${item.tool} ${item.status}`);
      } else if (['turn/completed', 'thread/tokenUsage/updated', 'error'].includes(message.method)) {
        appendFileSync(eventFile, JSON.stringify(message) + '\n');
      }
    });
  }
  send(message) { this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Request timeout: ${method}`)); }, 90000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  wait(predicate, from = 0) {
    const found = this.events.slice(from).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { clearTimeout(timer); this.listeners.delete(listener); error ? reject(error) : resolve(value); };
      const listener = { check: value => { if (predicate(value)) finish(null, value); }, fail: error => finish(error) };
      const timer = setTimeout(() => finish(new Error('Completion event deadline exceeded')), 600000);
      this.listeners.add(listener);
      if (this.ended) listener.fail(new Error('Host already exited'));
    });
  }
  async init() {
    const hello = await this.request('initialize', { clientInfo: { name: 'mellos-dialogue-acceptance', version: '1' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
    results.engine = hello.userAgent;
    const skills = await this.request('skills/list', { cwds: [project], forceReload: true });
    const matching = skills.data.flatMap(row => row.skills).filter(skill => skill.name.includes('mellos-mapping'));
    assert.equal(matching.length, 1); assert.equal(matching[0].enabled, true);
    assert.match(matching[0].description, /resume persistent/);
    results.skill = { name: matching[0].name, description: matching[0].description };
  }
  async start(cwd) {
    const config = await this.request('config/read', { cwd, includeLayers: true });
    results.effectiveMcp = config.config.mcp_servers?.['mellos-mapping'];
    assert.ok(results.effectiveMcp?.args?.[0]?.startsWith(profile), 'MCP configuration escaped isolated profile');
    const response = await this.request('thread/start', { cwd, model, approvalPolicy: 'never', sandbox: 'danger-full-access',
      developerInstructions: 'Work only in the supplied test project. Do not spawn agents, contact other people, install dependencies, or publish anything.' });
    const inventory = await this.request('mcpServerStatus/list', { threadId: response.thread.id });
    const mapping = inventory.data.find(server => server.name === 'mellos-mapping');
    results.exposedTools = Object.keys(mapping?.tools ?? {});
    assert.equal(results.exposedTools.length, 8, 'Host must expose all eight candidate tools');
    return response.thread.id;
  }
  async turn(threadId, prompt) {
    const from = this.events.length;
    const started = await this.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], effort });
    const turnId = started.turn.id;
    const complete = await this.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === turnId, from);
    assert.equal(complete.params.turn.status, 'completed', JSON.stringify(complete.params.turn.error));
    return this.events.slice(from).filter(event => event.params?.threadId === threadId && event.params?.turnId === turnId);
  }
  async compact(threadId) {
    const from = this.events.length;
    await this.request('thread/compact/start', { threadId });
    const started = await this.wait(event => event.method === 'turn/started' && event.params.threadId === threadId, from);
    const turnId = started.params.turn.id;
    const done = await this.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === turnId, from);
    assert.equal(done.params.turn.status, 'completed');
    assert.ok(this.events.slice(from).some(event => event.method === 'item/completed' && event.params?.item?.type === 'contextCompaction'));
    results.compaction = { completed: true, threadId, turnId };
  }
  async close() {
    for (const task of this.pending.values()) clearTimeout(task.timer);
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 3000);
    await this.closed; clearTimeout(timer); this.lines.close();
  }
}

async function seed(runtime) {
  mkdirSync(join(project, '.git'), { recursive: true });
  const git = spawnSync('git', ['init', '--quiet', project], { env, windowsHide: true, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(join(project, 'test'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'registration-fixture', private: true, type: 'module', scripts: { test: 'node --test' } }));
  writeFileSync(join(project, 'src/name.mjs'), 'export function normalizeName(value) { return String(value); }\n');
  writeFileSync(join(project, 'src/registration.mjs'), "import { normalizeName } from './name.mjs';\nexport const register = name => ({ name: normalizeName(name) });\n");
  writeFileSync(join(project, 'test/name.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {register} from '../src/registration.mjs';\ntest('regular name', () => assert.equal(register('Ada').name, 'Ada'));\n");
  const client = new Client({ name: 'seed-dialogue-fixture', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(runtime, 'dist/server.mjs')], cwd: project, env, stderr: 'pipe' }));
  try {
    const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result)); };
    const unrelated = Array.from({ length: 120 }, (_, i) => {
      const id = `stable-${String(i).padStart(3, '0')}`;
      writeFileSync(join(project, 'src', `${id}.mjs`), `export const value = ${i};\n`);
      return { id, label: `Unrelated verified module ${i}`, layer: 'foundation', status: 'done', evidence: `Previously verified module ${i}; preserve this evidence.`, detail: `Independent module ${i}` };
    });
    await call('mmap_setup', { policy: 'always', scope: 'project' });
    await call('mmap_declare', { page: 'registration', title: '报名表姓名规范化', kind: 'dev',
      context: { summary: '报名表已有基础流程，120 个独立模块已验收。姓名规范化还待完善。', next: '继续完善 src/name.mjs 的 normalizeName；相关验证在 test/name.test.mjs。进度节点是 name-normalizer 和 registration-flow。' },
      layers: [{ id: 'foundation', name: '基础能力', rank: 0 }, { id: 'application', name: '报名流程', rank: 1 }],
      nodes: [...unrelated, { id: 'name-normalizer', label: '姓名规范化', layer: 'foundation', status: 'planned', detail: 'src/name.mjs normalizeName；test/name.test.mjs 验证姓名边界。', sources: [{ path: 'src/name.mjs', sha256: hash(join(project, 'src/name.mjs')) }] },
        { id: 'registration-flow', label: '报名流程', layer: 'application', status: 'planned', detail: 'src/registration.mjs register 调用 normalizeName；验收姓名传递。' }],
      edges: [{ from: 'registration-flow', to: 'name-normalizer' }] });
    await call('mmap_declare', { page: 'billing', title: '账单系统（其他工作）', context: { summary: '独立的已完成账单功能。' }, layers: [{ id: 'base', name: 'Base', rank: 0 }], nodes: [{ id: 'invoice', label: '发票', layer: 'base', status: 'done', evidence: 'Do not change unrelated work.' }] });
  } finally { await client.close(); }
}

async function scenario(name, host, threadId, prompt, checks) {
  console.log(`${label}: starting ${name}`);
  const before = snapshot();
  const billingHash = hash(join(project, '.mellos/pages/billing.json'));
  const start = Date.now();
  const events = await host.turn(threadId, prompt);
  const after = snapshot();
  writeFileSync(join(output, `${name}-before.json`), JSON.stringify(before, null, 2));
  writeFileSync(join(output, `${name}-after.json`), JSON.stringify(after, null, 2));
  const items = events.filter(event => event.method === 'item/completed').map(event => event.params.item);
  const calls = items.filter(item => item.type === 'mcpToolCall');
  const changedIds = before.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(after.nodes.find(other => other.id === node.id))).map(node => node.id);
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  check(JSON.stringify(before.nodes.map(node => node.id)) === JSON.stringify(after.nodes.map(node => node.id)), 'Node identities/order changed');
  check(changedIds.length > 0 && changedIds.every(id => ['name-normalizer', 'registration-flow'].includes(id)), 'Unrelated nodes changed or no progress updated');
  check(hash(join(project, '.mellos/pages/billing.json')) === billingHash, 'Unrelated page changed');
  check(readdirSync(join(project, '.mellos/pages')).sort().join() === 'billing.json,registration.json', 'Duplicate or missing pages');
  check(!existsSync(join(project, 'src/.mellos')), 'Subdirectory got a duplicate store');
  check(!calls.some(call => call.tool === 'mmap_declare'), 'Re-declared existing structure');
  const writes = calls.filter(call => ['mmap_update', 'mmap_batch', 'mmap_remove', 'mmap_declare'].includes(call.tool));
  check(writes.length > 0, 'No mutation through MCP');
  check(writes.every(call => call.arguments.page === 'registration' && typeof call.arguments.expectedRevision === 'string'), 'Write omitted page/revision');
  const firstRead = calls.findIndex(call => call.tool === 'mmap_read');
  const firstWrite = calls.findIndex(call => ['mmap_update', 'mmap_batch', 'mmap_remove', 'mmap_declare'].includes(call.tool));
  check(firstRead >= 0 && firstRead < firstWrite, 'Did not read saved map before writing');
  check(after.nodes.find(node => node.id === 'name-normalizer').status === 'done', 'Normalizer not verified done');
  check(after.nodes.find(node => node.id === 'name-normalizer').sources?.some(source => source.path === 'src/name.mjs' && source.sha256 === hash(join(project, source.path))), 'Verified source baseline was not refreshed');
  check(Boolean(after.context?.next), 'Missing next-step checkpoint');
  const verify = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {register} from './src/registration.mjs'; ${checks}`], { cwd: project, env, encoding: 'utf8', windowsHide: true });
  check(verify.status === 0, `Independent behavior check failed: ${verify.stderr}`);
  const tests = spawnSync(process.execPath, ['--test'], { cwd: project, env, encoding: 'utf8', windowsHide: true });
  check(tests.status === 0, `Project tests failed: ${tests.stderr}`);
  const record = { name, prompt, threadId, elapsedMs: Date.now() - start, changedIds, mcpCalls: calls.map(call => ({ tool: call.tool, arguments: call.arguments, status: call.status })),
    commands: items.filter(item => item.type === 'commandExecution').map(item => item.command),
    final: items.filter(item => item.type === 'agentMessage' && item.phase === 'final_answer').map(item => item.text).join('\n'),
    tokenUsage: events.filter(event => event.method === 'thread/tokenUsage/updated').at(-1)?.params.tokenUsage,
    independentChecksPassed: verify.status === 0, projectTestsPassed: tests.status === 0, failures, passed: failures.length === 0 };
  results.scenarios.push(record);
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${label}: ${name} ${record.passed ? 'PASS' : 'FAIL'} ${JSON.stringify(failures)}`);
}

try {
  mkdirSync(configHome, { recursive: true });
  writeFileSync(join(configHome, 'config.toml'), `model = "${model}"\nmodel_reasoning_effort = "${effort}"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[features]\nmulti_agent = false\n`);
  // Reuse existing sign-in only inside the disposable profile, never print it.
  copyFileSync(join(originalConfigHome, 'auth.json'), join(configHome, 'auth.json'));
  const installed = await installRelease(join(root, 'artifacts/release/chatgpt-app'), [], { env, installHome: join(profile, 'installations'), log: () => {} });
  await seed(join(installed.target, 'plugins/mellos-mapping'));
  active = new Host(project); await active.init();
  let threadId = await active.start(project);
  if (mode === 'proactive') {
    await scenario('proactive', active, threadId, '报名表保存的姓名两端会保留空白，修复一下并验证。无需打开窗口。', "assert.equal(register('  Ada  ').name, 'Ada');");
  } else {
  await scenario('fresh', active, threadId, '继续完善报名表：姓名两端空白也应该被去掉。请完成修改和验证，并同步开发进度。无需打开任何窗口。', "assert.equal(register('  Ada  ').name, 'Ada');");
  console.log(`${label}: compacting via completion events`);
  await active.compact(threadId);
  await scenario('after-compaction', active, threadId, '姓名最多允许 40 个字符，超出时只保留前 40 个字符。请补上修改和验证，并同步开发进度。无需打开窗口。', "assert.equal(register('  Ada  ').name, 'Ada'); assert.equal(register('x'.repeat(50)).name, 'x'.repeat(40));");
  await active.close(); active = undefined;
  active = new Host(join(project, 'src')); await active.init();
  threadId = await active.start(join(project, 'src'));
  await scenario('new-process-subdirectory', active, threadId, '继续完善报名表：姓名为空或全是空白时，使用“匿名”。请完成修改和验证，并同步开发进度。无需打开窗口。', "assert.equal(register('  Ada  ').name, 'Ada'); assert.equal(register('x'.repeat(50)).name, 'x'.repeat(40)); assert.equal(register('   ').name, '匿名'); assert.equal(register('').name, '匿名');");
  }
  cpSync(join(project, 'src'), join(output, 'final-source'), { recursive: true });
  cpSync(join(project, 'test'), join(output, 'final-tests'), { recursive: true });
  results.passed = results.scenarios.every(scenario => scenario.passed);
} catch (error) {
  results.error = String(error.stack ?? error); results.passed = false;
  console.error(`${label}: ${error.message}`);
} finally {
  if (active) await active.close();
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  assert.equal(dirname(temporary), realpathSync(tmpdir()));
  assert.ok(basename(temporary).startsWith('mellos-dialogue-'));
  rmSync(temporary, { recursive: true, force: true });
}
console.log(`${label}: result ${results.passed ? 'PASS' : 'FAIL'}; ${join(output, 'results.json')}`);
if (!results.passed) process.exitCode = 1;
