// @ts-check
/** Dependency-free MCP handshake used by a fresh clone's installer. */
import { spawn } from 'node:child_process';
export const TOOL_NAMES = ['mmap_batch', 'mmap_declare', 'mmap_open', 'mmap_read', 'mmap_remove', 'mmap_setup', 'mmap_update', 'mmap_view'];

/** @param {string} server @param {string} cwd @param {NodeJS.ProcessEnv} [env] @returns {Promise<string[]>} */
export function verifyRuntime(server, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let buffer = '', errors = '', complete = false;
    /** @param {unknown} error @param {string[]} [value] */
    const finish = (error, value = []) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      child.once('close', () => error ? reject(error) : resolve(value));
      child.kill();
    };
    const timer = setTimeout(() => finish(new Error(`MCP handshake timed out. ${errors.slice(-500)}`)), 15_000);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('exit', code => { if (!complete) finish(new Error(`MCP exited (${code}). ${errors.slice(-500)}`)); });
    child.stderr.on('data', data => { errors = (errors + data).slice(-2000); });
    /** @param {unknown} value */
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.on('data', data => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.error) return finish(new Error(JSON.stringify(message.error)));
          if (message.id === 1) {
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          } else if (message.id === 2) {
            const names = message.result.tools.map(/** @param {{name: string}} tool */ tool => tool.name).sort();
            if (JSON.stringify(names) !== JSON.stringify(TOOL_NAMES)) return finish(new Error('Installed MCP tool set is incomplete.'));
            finish(null, names);
          }
        } catch (error) { finish(error); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mellos-installer', version: '1' },
    } });
  });
}
