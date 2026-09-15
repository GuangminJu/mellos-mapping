/// <reference lib="dom" />
/** Browser composition root. xterm owns keyboard/mouse and cell rendering. */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalInput, TerminalOutput } from './terminal-protocol.js';
import { createStarNotice } from './star-reminder.js';

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const container = element('terminal'), status = element('connection'), restart = element<HTMLButtonElement>('restart');
const font = element<HTMLSelectElement>('font-size'), graphic = element<HTMLAnchorElement>('graphic');
const base = new URL('.', location.href);
const starNotice = createStarNotice(base);
let page = new URL(location.href).searchParams.get('page') ?? undefined;
let socket: WebSocket | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined, retries = 0, disposed = false;
try { const saved = localStorage.getItem('mellos-terminal-font'); if (Array.from(font.options).some(o => o.value === saved)) font.value = saved!; } catch { /* Storage may be disabled. */ }
const terminal = new Terminal({
  fontSize: Number(font.value), fontFamily: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
  lineHeight: 1.15, cursorBlink: false, scrollback: 0, convertEol: false,
  allowProposedApi: false, allowTransparency: false,
  theme: { background: '#10151c', foreground: '#d9e2ed', brightBlack: '#bec8d8', cursor: '#81dbae', selectionBackground: '#3c5670' },
});
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container);
function setStatus(text: string, state: string): void { status.textContent = text; status.dataset.state = state; }
function syncPage(): void {
  const url = new URL(location.href), link = new URL(base);
  if (page && page !== '_default') { url.searchParams.set('page', page); link.searchParams.set('page', page); }
  else url.searchParams.delete('page');
  url.searchParams.set('view', 'terminal'); history.replaceState(null, '', url); graphic.href = link.href;
}
function dimensions(): { cols: number; rows: number } {
  const proposed = fit.proposeDimensions();
  return { cols: Math.max(20, Math.min(500, proposed?.cols ?? 80)), rows: Math.max(8, Math.min(200, proposed?.rows ?? 24)) };
}
function send(message: TerminalInput): void { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function resize(): void {
  const size = dimensions();
  if (size.cols === terminal.cols && size.rows === terminal.rows) return;
  terminal.resize(size.cols, size.rows); send({ type: 'resize', ...size });
}
let resizeFrame = 0;
const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); });
observer.observe(container);
terminal.onData(data => {
  // Keep every message under the transport limit, including pasted text.
  for (let i = 0; i < data.length; i += 1024) send({ type: 'input', data: data.slice(i, i + 1024) });
});
// Buttons keep keyboard input directed at the map after the action completes.
font.addEventListener('change', () => {
  terminal.options.fontSize = Number(font.value);
  try { localStorage.setItem('mellos-terminal-font', font.value); } catch { /* Optional preference. */ }
  resize(); terminal.focus();
});
const help = element<HTMLDialogElement>('help-dialog');
element('help').addEventListener('click', () => help.showModal());
help.addEventListener('close', () => terminal.focus());
terminal.attachCustomKeyEventHandler(event => {
  if (event.key === '?') { if (event.type === 'keydown' && !help.open) help.showModal(); return false; }
  return true;
});
restart.addEventListener('click', () => { retries = 0; connect(); });
function connect(): void {
  if (disposed) return;
  clearTimeout(retryTimer); socket?.close();
  terminal.reset(); resize(); restart.hidden = true; setStatus('正在连接…', 'connecting');
  const url = new URL('api/terminal', base); url.protocol = 'ws:';
  if (page && page !== '_default') url.searchParams.set('page', page);
  const connection = new WebSocket(url); socket = connection;
  connection.addEventListener('open', () => {
    if (socket !== connection) return;
    connection.send(JSON.stringify({ type: 'start', ...dimensions() }));
    setStatus('已连接 · 终端地图', 'connected'); terminal.focus();
  });
  connection.addEventListener('message', event => {
    if (socket !== connection) return;
    let message: TerminalOutput;
    try { message = JSON.parse(String(event.data)) as TerminalOutput; } catch { connection.close(1002, 'Invalid output'); return; }
    if (message.type === 'data') {
      retries = 0;
      terminal.write(message.data, () => { if (connection.readyState === WebSocket.OPEN) connection.send('{"type":"ack"}'); });
    } else if (message.type === 'view') { page = message.page; syncPage(); starNotice(page); }
    else if (message.type === 'error') setStatus(message.message, 'error');
  });
  connection.addEventListener('close', event => {
    if (socket !== connection || disposed) return;
    restart.hidden = false;
    if (status.dataset.state !== 'error') setStatus(event.code === 1000 ? '地图已关闭' : '连接中断', event.code === 1000 ? 'closed' : 'error');
    // User exit (q) stays closed. Network interruptions get a bounded retry.
    if (event.code !== 1000 && retries < 3) retryTimer = setTimeout(connect, 1000 * 2 ** retries++);
    else if (event.code !== 1000 && status.textContent === '连接中断') setStatus('服务未连接，请让 AI 重新打开地图', 'error');
  });
}
window.addEventListener('pagehide', event => {
  disposed = true; clearTimeout(retryTimer); cancelAnimationFrame(resizeFrame); observer.disconnect(); socket?.close();
  if (!event.persisted) terminal.dispose();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { disposed = false; observer.observe(container); connect(); }
});
syncPage(); connect();
