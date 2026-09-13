/** Dependency-free release probe: shipped web assets and real mmap worker IO. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

async function run(executable, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`Web CLI failed (${code}): ${err}`)); });
  });
}
export async function verifyWebTerminal(server, cwd, env = process.env) {
  const runtime = dirname(server), cli = join(runtime, 'web.mjs');
  let base, servicePid;
  try {
    const result = JSON.parse(await run(process.execPath, [cli, cwd, '--terminal'], cwd, env));
    assert.equal(result.surface, 'web-terminal');
    base = new URL('.', result.url);
    const get = async path => { const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(4000) }); assert.equal(response.status, 200); return response; };
    assert.ok((await (await get('?view=terminal')).text()).includes('id="terminal"'));
    for (const asset of ['terminal.js', 'terminal.css', 'xterm.css']) assert.ok((await (await get(asset)).text()).length > 100);
    const health = await (await get('api/health')).json(); servicePid = health.pid;
    assert.ok(health.surfaces.includes('web-terminal'));
    await new Promise((resolve, reject) => {
      const worker = spawn(process.execPath, [join(runtime, 'terminal-worker.mjs'), '--file', join(cwd, '.mellos/map.json')], { cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let output = '', error, quitting = false;
      const timer = setTimeout(() => { error = new Error('Terminal worker input/output timed out'); worker.kill(); }, 10000);
      worker.on('error', value => { error = value; });
      worker.stderr.on('data', value => { error = new Error(String(value)); });
      worker.on('message', message => {
        if (message.type !== 'data') return;
        output += message.data;
        if (worker.connected) worker.send({ type: 'ack' }, () => {});
        if (!quitting && output.includes('q quit') && output.includes('\x1b[?1006h')) {
          quitting = true; worker.send({ type: 'input', data: 'q' }, () => {});
        }
      });
      worker.on('close', code => { clearTimeout(timer); if (error || code !== 0 || !quitting) reject(error ?? new Error(`Terminal worker failed (${code})`)); else resolve(); });
      worker.send({ type: 'start', cols: 120, rows: 32 }, () => {});
    });
  } finally {
    if (base) await fetch(new URL('api/stop', base), { method: 'POST', signal: AbortSignal.timeout(4000) });
    if (servicePid) {
      const deadline = Date.now() + 5000;
      for (;;) {
        try { process.kill(servicePid, 0); } catch { break; }
        if (Date.now() > deadline) throw new Error('Web service did not exit after stop');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
  }
}
