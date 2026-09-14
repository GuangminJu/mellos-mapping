import { randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { ID_RULE } from '../domain/types.js';
import { deletePageFile, describeStoreError, pageFilePath, type PageId } from '../store/store.js';
import { createPreviewPublisher } from '../preview/publisher.js';
import { readWebSnapshot } from './source.js';
import { attachTerminalService } from './terminal-service.js';
import { LedgerError, withStoreLock } from '../store/transaction.js';

export interface WebAssets {
  readonly html: string; readonly javascript: string; readonly css: string;
  readonly terminal?: { readonly html: string; readonly javascript: string; readonly css: string; readonly xtermCss: string };
}
export interface WebServiceOptions { readonly token?: string; readonly idleMs?: number; readonly onClose?: () => void; readonly terminalWorker?: string }

/** Local transport adapter. Exact routes only; no general filesystem server. */
export async function startWebService(defaultFile: string, assets: WebAssets, options: WebServiceOptions = {}) {
  const token = options.token ?? randomBytes(24).toString('hex');
  if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('Invalid web token');
  const prefix = `/${token}/`;
  let origin = '', lastRequest = Date.now(), closed = false;
  const send = (res: ServerResponse, code: number, body: string, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    res.end(body);
  };
  const server = createServer((req, res) => {
    // Host verification also prevents a public DNS name from rebinding to us.
    if (`http://${req.headers.host}` !== origin || (req.headers.origin !== undefined && req.headers.origin !== origin)) { send(res, 403, '{"error":"Origin refused"}'); return; }
    const path = (req.url ?? '').split('?')[0]!;
    if (!path.startsWith(prefix)) { send(res, 404, '{"error":"Not found"}'); return; }
    const route = path.slice(prefix.length);
    lastRequest = Date.now();
    try {
      if (req.method === 'GET' && route === '') {
        const terminal = new URL(req.url!, origin).searchParams.get('view') === 'terminal';
        if (terminal && !terminalService) { send(res, 503, '{"error":"Web terminal unavailable. Reinstall the plugin."}'); return; }
        send(res, 200, terminal ? assets.terminal!.html : assets.html, 'text/html; charset=utf-8'); return;
      }
      if (req.method === 'GET' && route === 'app.js') { send(res, 200, assets.javascript, 'text/javascript; charset=utf-8'); return; }
      if (req.method === 'GET' && route === 'app.css') { send(res, 200, assets.css, 'text/css; charset=utf-8'); return; }
      if (req.method === 'GET' && assets.terminal) {
        const asset = new Map<string, readonly [string, string]>([['terminal.js', [assets.terminal.javascript, 'text/javascript']], ['terminal.css', [assets.terminal.css, 'text/css']], ['xterm.css', [assets.terminal.xtermCss, 'text/css']]]).get(route);
        if (asset) { send(res, 200, asset[0], `${asset[1]}; charset=utf-8`); return; }
      }
      if (req.method === 'GET' && route === 'api/health') { send(res, 200, JSON.stringify({ file: defaultFile, pid: process.pid, formats: [1, 2], surfaces: terminalService ? ['web', 'web-terminal'] : ['web'] })); return; }
      if (req.method === 'GET' && route === 'api/state') {
        const snapshot = readWebSnapshot(defaultFile);
        const etag = `"${snapshot.revision}"`;
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) { send(res, 304, ''); return; }
        send(res, 200, JSON.stringify(snapshot)); return;
      }
      if (req.method === 'DELETE' && route.startsWith('api/pages/')) {
        withStoreLock(defaultFile, () => {
        const id = route.slice('api/pages/'.length);
        if (id !== '_default' && !ID_RULE.test(id)) { send(res, 400, '{"error":"Invalid page"}'); return; }
        // Require the version the user reviewed, so confirmation cannot delete
        // a page that changed while the confirmation dialog was open.
        if (req.headers['if-match'] !== `"${readWebSnapshot(defaultFile).revision}"`) { send(res, 409, '{"error":"地图已更新，请重新确认删除。"}'); return; }
        const result = deletePageFile(pageFilePath(defaultFile, id === '_default' ? undefined : id as PageId));
        if (!result.ok) { send(res, 500, JSON.stringify({ error: describeStoreError(result.error) })); return; }
        const previews = createPreviewPublisher(defaultFile);
        const refreshed = previews.enabled() ? previews.refresh() : undefined;
        send(res, 200, JSON.stringify({ deleted: true, ...(refreshed && !refreshed.ok ? { warning: `地图已删除，Markdown 预览待重新生成：${refreshed.error}` } : {}) })); return;
        }); return;
      }
      if (req.method === 'POST' && route === 'api/stop') { send(res, 200, '{"stopped":true}'); void close(); return; }
      send(res, 404, '{"error":"Not found"}');
    } catch (error) { send(res, error instanceof LedgerError && error.code === 'BUSY' ? 409 : 500, JSON.stringify({ error: String(error) })); }
  });
  const terminalService = assets.terminal && options.terminalWorker ? attachTerminalService(server, {
    file: defaultFile, worker: options.terminalWorker, prefix, origin: () => origin, touch: () => { lastRequest = Date.now(); },
  }) : undefined;
  const timer = setInterval(() => { if (Date.now() - lastRequest > (options.idleMs ?? 300_000)) void close(); }, 10_000);
  timer.unref();
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await terminalService?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    options.onClose?.();
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  } catch (error) { clearInterval(timer); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listening address');
  origin = `http://127.0.0.1:${address.port}`;
  return { url: `${origin}${prefix}`, token, port: address.port, close };
}
