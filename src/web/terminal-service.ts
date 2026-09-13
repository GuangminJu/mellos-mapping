import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ID_RULE } from '../domain/types.js';
import { readWebSnapshot } from './source.js';
import { parseTerminalInput, type TerminalOutput } from './terminal-protocol.js';

/** One isolated mmap worker per connection. No shell or client-selected executable. */
export function attachTerminalService(server: Server, options: {
  readonly file: string; readonly worker: string; readonly prefix: string;
  readonly origin: () => string; readonly touch: () => void;
}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const workers = new Set<ChildProcess>();
  let closing = false;
  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', options.origin()); }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    if (closing || request.headers.host !== new URL(options.origin()).host || request.headers.origin !== options.origin() ||
        url.pathname !== `${options.prefix}api/terminal`) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const page = url.searchParams.get('page') || undefined;
    if (sockets.clients.size >= 8 || (page && (!ID_RULE.test(page) || !readWebSnapshot(options.file).value.pages.some(p => p.id === page)))) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      options.touch();
      let child: ChildProcess | undefined, awaitingAck = false, pendingInput = 0;
      let deadline = setTimeout(() => ws.close(1008, 'Terminal did not start'), 10000);
      const stop = (): void => { clearTimeout(deadline); child?.kill(); };
      const send = (message: TerminalOutput): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1008, 'Terminal output overflow'); return; }
        ws.send(JSON.stringify(message));
      };
      ws.on('close', stop); ws.on('error', stop);
      ws.on('message', raw => {
        const message = parseTerminalInput(raw.toString());
        if (!message) { ws.close(1008, 'Invalid terminal message'); return; }
        options.touch();
        if (message.type === 'start') {
          if (child) { ws.close(1008, 'Terminal already started'); return; }
          child = spawn(process.execPath, [options.worker, '--file', options.file, ...(page ? ['--page', page] : [])], {
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
          });
          workers.add(child);
          let errors = '';
          child.stderr?.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
          child.on('error', error => { send({ type: 'error', message: error.message }); ws.close(1011, 'Cannot start map'); });
          child.on('close', code => {
            workers.delete(child!); clearTimeout(deadline);
            if (code && errors) send({ type: 'error', message: errors });
            ws.close(code ? 1011 : 1000, code ? 'Map stopped' : 'Map closed');
          });
          child.on('message', rawOutput => {
            const output = rawOutput as TerminalOutput;
            if (output.type === 'data') {
              awaitingAck = true;
              clearTimeout(deadline);
              deadline = setTimeout(() => ws.close(1008, 'Terminal acknowledgement timed out'), 30000);
            }
            send(output);
          });
        } else if (!child) { ws.close(1008, 'Start terminal first'); return; }
        if (message.type === 'ack') {
          if (!awaitingAck) return;
          awaitingAck = false; clearTimeout(deadline);
        }
        if (child?.connected) {
          if (pendingInput >= 64) { ws.close(1008, 'Terminal input overflow'); return; }
          pendingInput++;
          child.send(message, error => { pendingInput--; if (error) ws.close(1011, 'Map connection lost'); });
        }
      });
    });
  });
  return {
    async close(): Promise<void> {
      closing = true;
      for (const ws of sockets.clients) ws.terminate();
      await Promise.all([...workers].map(child => new Promise<void>(resolve => {
        child.once('close', () => resolve()); child.kill();
      })));
      await new Promise<void>(resolve => sockets.close(() => resolve()));
    },
  };
}
