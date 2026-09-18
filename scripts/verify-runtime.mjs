// @ts-check
/** Dependency-free MCP and revision-checked write probe for installers. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const TOOL_NAMES = ['mmap_batch', 'mmap_declare', 'mmap_open', 'mmap_read', 'mmap_remove', 'mmap_setup', 'mmap_update', 'mmap_view'];

/** @param {string} server @param {string} cwd @param {NodeJS.ProcessEnv} [env] @returns {Promise<string[]>} */
export function verifyRuntime(server, cwd, env = process.env) {
  // Installation checks must never create locks or maps in a user's project,
  // including when a caller supplies inherited project environment variables.
  const project = mkdtempSync(join(tmpdir(), 'mellos-runtime-write-check-'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { cwd,
      env: { ...env, MELLOS_MAPPING_CWD: project, CLAUDE_PROJECT_DIR: project },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let buffer = '', errors = '', complete = false, originalRevision = '', updatedRevision = '';
    /** @type {string[]} */
    let names = [];
    const page = 'installation-check';
    /** @param {unknown} error @param {string[]} [value] */
    const finish = (error, value = []) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      child.once('close', () => {
        try { rmSync(project, { recursive: true, force: true }); }
        catch (cleanupError) { reject(cleanupError); return; }
        error ? reject(error) : resolve(value);
      });
      child.kill();
    };
    const timer = setTimeout(() => finish(new Error(`MCP handshake timed out. ${errors.slice(-500)}`)), 15_000);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('exit', code => { if (!complete) finish(new Error(`MCP exited (${code}). ${errors.slice(-500)}`)); });
    child.stderr.on('data', data => { errors = (errors + data).slice(-2000); });
    /** @param {unknown} value */
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    /** @param {number} id @param {string} name @param {Record<string, unknown>} args */
    const call = (id, name, args) => send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { page, ...args } } });
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
            names = message.result.tools.map(/** @param {{name: string}} tool */ tool => tool.name).sort();
            if (JSON.stringify(names) !== JSON.stringify(TOOL_NAMES)) return finish(new Error('Installed MCP tool set is incomplete.'));
            call(3, 'mmap_declare', { title: 'Installation write check', expectedRevision: 'absent' });
          } else if (message.id >= 3 && message.id <= 8) {
            const result = message.result;
            const data = result?.structuredContent;
            if (message.id === 6) {
              if (!result?.isError || data?.error?.code !== 'CONFLICT') throw new Error('Installed MCP accepted an obsolete revision instead of returning CONFLICT.');
              call(7, 'mmap_read', { resource: 'map' });
              continue;
            }
            if (result?.isError || !data) throw new Error(`Installed MCP write verification failed: ${JSON.stringify(data ?? result)}`);
            if (message.id === 3) {
              if (!/^[a-f0-9]{64}$/.test(data.revision)) throw new Error('Installed MCP did not return a saved page revision.');
              originalRevision = data.revision;
              call(4, 'mmap_read', { resource: 'map' });
            } else if (message.id === 4) {
              if (data.revision !== originalRevision || data.items?.[0]?.title !== 'Installation write check') throw new Error('Installed MCP could not read back its saved map.');
              call(5, 'mmap_update', { title: 'Installation write verified', expectedRevision: originalRevision });
            } else if (message.id === 5) {
              if (!/^[a-f0-9]{64}$/.test(data.revision) || data.revision === originalRevision) throw new Error('Installed MCP did not advance the revision after an update.');
              updatedRevision = data.revision;
              call(6, 'mmap_update', { title: 'Must not overwrite', expectedRevision: originalRevision });
            } else if (message.id === 7) {
              if (data.revision !== updatedRevision || data.items?.[0]?.title !== 'Installation write verified') throw new Error('A refused stale write changed the saved map.');
              call(8, 'mmap_remove', { deletePage: true, expectedRevision: updatedRevision });
            } else {
              if (data.deleted !== true || data.revision !== 'absent') throw new Error('Installed MCP did not confirm checked page deletion.');
              finish(null, names);
            }
          }
        } catch (error) { finish(error); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mellos-installer', version: '1' },
    } });
  });
}
