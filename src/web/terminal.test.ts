import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_MAP } from '../domain/types.js';
import { applyDeclare } from '../server/apply.js';
import { saveMapFile } from '../store/store.js';
import { startWebService } from './service.js';
import { parseTerminalInput, type TerminalInput, type TerminalOutput } from './terminal-protocol.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const temporary: string[] = [], services: Awaited<ReturnType<typeof startWebService>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'mellos-web-terminal-')); temporary.push(project);
  mkdirSync(join(project, '.mellos/pages'), { recursive: true });
  const file = join(project, '.mellos/map.json');
  for (const page of ['alpha', 'beta']) {
    const result = applyDeclare(EMPTY_MAP, { title: `Map ${page} 中文`, layers: [{ id: 'base', name: '基础', rank: 0 }], nodes: [{ id: 'module', layer: 'base', label: '模块', detail: 'Details for terminal verification' }] });
    if (!result.ok) throw new Error('Fixture failed');
    saveMapFile(join(project, `.mellos/pages/${page}.json`), result.value);
  }
  const service = await startWebService(file, { html: 'graph', javascript: '', css: '', terminal: { html: 'terminal', javascript: 'terminal-js', css: 'terminal-css', xtermCss: 'xterm-css' } }, { terminalWorker: join(root, 'dist/terminal-worker.mjs') });
  services.push(service);
  return { project, service };
}
async function connect(url: string, page = 'alpha', ack = true) {
  const target = new URL(`api/terminal?page=${page}`, url);
  const ws = new WebSocket(target.href.replace('http:', 'ws:'), { origin: target.origin });
  const messages: TerminalOutput[] = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString()) as TerminalOutput; messages.push(message);
    if (ack && message.type === 'data') ws.send('{"type":"ack"}');
  });
  await once(ws, 'open');
  const send = (value: TerminalInput) => ws.send(JSON.stringify(value));
  send({ type: 'start', cols: 100, rows: 35 });
  return { ws, messages, send, output: () => messages.filter(m => m.type === 'data').map(m => m.data).join('') };
}
async function until(test: () => boolean) { const end = Date.now() + 4000; while (!test()) { if (Date.now() > end) throw new Error('Timed out waiting for terminal'); await new Promise(resolve => setTimeout(resolve, 20)); } }

describe('web terminal transport', () => {
  it('starts the shipped web CLI through an aliased installation directory', () => {
    const project = mkdtempSync(join(tmpdir(), 'mellos-web-alias-')); temporary.push(project);
    const alias = join(project, 'runtime'); symlinkSync(join(root, 'dist'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = spawnSync(process.execPath, [join(alias, 'web.mjs'), '--help'], { encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(0); expect(result.stdout).toContain('--terminal');
  });
  it('strictly bounds sizes, input and messages', () => {
    for (const value of [{ type: 'start', cols: 19, rows: 20 }, { type: 'resize', cols: 100, rows: 201 }, { type: 'input', data: 'a'.repeat(4097) }, { type: 'start', cols: 80, rows: 24, command: 'anything' }, { type: 'exec', data: 'anything' }, null]) expect(parseTerminalInput(JSON.stringify(value))).toBeUndefined();
    expect(parseTerminalInput('{')).toBeUndefined();
    expect(parseTerminalInput('{"type":"input","data":"+"}')).toEqual({ type: 'input', data: '+' });
  });
  it('serves both modes and runs independent interactive mmap workers', async () => {
    const { service } = await fixture();
    expect(await (await fetch(service.url)).text()).toBe('graph');
    expect(await (await fetch(`${service.url}?view=terminal`)).text()).toBe('terminal');
    expect(await (await fetch(`${service.url}terminal.js`)).text()).toBe('terminal-js');
    expect((await (await fetch(`${service.url}api/health`)).json()).surfaces).toContain('web-terminal');
    const a = await connect(service.url), b = await connect(service.url, 'beta');
    await until(() => a.output().includes('Map alpha') && b.output().includes('Map beta'));
    expect(a.output()).toContain('\x1b[?1006h');
    const before = a.messages.length;
    a.send({ type: 'input', data: '+' });
    await until(() => a.messages.slice(before).some(m => m.type === 'data' && m.data.includes('detail')));
    const zoomed = a.messages.length;
    a.send({ type: 'input', data: '\x1b[<65;30;10M' });
    await until(() => a.messages.slice(zoomed).some(m => m.type === 'data' && m.data.includes('100%')));
    a.send({ type: 'resize', cols: 60, rows: 22 });
    a.send({ type: 'input', data: '2' });
    await until(() => a.messages.some(m => m.type === 'view' && m.page === 'beta' && !m.follow));
    expect(b.messages.filter(m => m.type === 'view').every(m => m.page === 'beta')).toBe(true);
    b.send({ type: 'input', data: '1' });
    await until(() => b.messages.some(m => m.type === 'view' && m.page === 'alpha' && !m.follow));
    expect(a.messages.filter(m => m.type === 'view').at(-1)?.page).toBe('beta');
    const closed = once(a.ws, 'close'); a.send({ type: 'input', data: 'q' });
    expect((await closed)[0]).toBe(1000);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });
  it('keeps one output chunk in flight until acknowledged and cleans workers on close', async () => {
    const { project, service } = await fixture();
    const a = await connect(service.url, 'alpha', false);
    await until(() => a.messages.some(m => m.type === 'data'));
    for (let i = 0; i < 20; i++) a.send({ type: 'input', data: '+' });
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(a.messages.filter(m => m.type === 'data')).toHaveLength(1);
    a.send({ type: 'ack' });
    await until(() => a.messages.filter(m => m.type === 'data').length === 2);
    const viewers = join(project, '.mellos/viewers');
    const pids = readdirSync(viewers).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(viewers, f), 'utf8')).pid as number);
    expect(pids.length).toBeGreaterThan(0);
    await service.close();
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  });
  it('refuses foreign origins, missing tokens, unknown pages and invalid input', async () => {
    const { service } = await fixture();
    for (const [url, origin, code] of [[`${service.url}api/terminal`, 'https://example.com', 403], [new URL('/api/terminal', service.url).href, new URL(service.url).origin, 403], [`${service.url}api/terminal?page=missing`, new URL(service.url).origin, 400]] as const) {
      const ws = new WebSocket(url.replace('http:', 'ws:'), { origin });
      const status = await new Promise<number>(resolve => { ws.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); ws.terminate(); }); ws.on('error', () => {}); });
      expect(status).toBe(code);
    }
    const a = await connect(service.url);
    const closed = once(a.ws, 'close'); a.ws.send('{"type":"exec","data":"echo nope"}');
    expect((await closed)[0]).toBe(1008);
  });
});
