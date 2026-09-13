import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ID_RULE } from '../domain/types.js';
import { readWebSnapshot } from './source.js';

export const webRuntimeFile = (defaultFile: string): string => join(dirname(defaultFile), 'web', 'server.json');
interface Runtime { readonly port: number; readonly token: string }
export async function runningWebUrl(defaultFile: string): Promise<string | undefined> {
  try {
    const info = JSON.parse(readFileSync(webRuntimeFile(defaultFile), 'utf8')) as Runtime;
    if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || !/^[a-f0-9]{48}$/.test(info.token)) return undefined;
    const url = `http://127.0.0.1:${info.port}/${info.token}/`;
    const response = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(700) });
    if (response.ok && (await response.json() as { file: string }).file === defaultFile) return url;
  } catch { /* Missing, stale, or stopped runtime: start a new one. */ }
  return undefined;
}
export async function openWebPreview(defaultFile: string, entry: string, page?: string, terminal = false): Promise<string> {
  if (page !== undefined && (!ID_RULE.test(page) || !readWebSnapshot(defaultFile).value.pages.some(p => p.id === page))) throw new Error(`No map page named "${page}".`);
  let url = await runningWebUrl(defaultFile);
  if (url && terminal) {
    const health = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(2000) });
    const info = await health.json() as { surfaces?: string[] };
    if (!info.surfaces?.includes('web-terminal')) {
      // A verified same-project service from an older install cannot serve this mode.
      await fetch(`${url}api/stop`, { method: 'POST', signal: AbortSignal.timeout(2000) });
      const deadline = Date.now() + 3000;
      while (await runningWebUrl(defaultFile)) {
        if (Date.now() > deadline) throw new Error('Old web viewer is still stopping. Retry opening the terminal.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      url = undefined;
    }
  }
  if (!url) {
    if (!existsSync(entry)) throw new Error(`Web runtime missing: ${entry}. Run npm run build or reinstall the plugin.`);
    const child = spawn(process.execPath, [entry, '--serve', defaultFile], { detached: true, windowsHide: true, stdio: 'ignore' });
    let failure: Error | undefined;
    child.on('error', error => { failure = error; });
    child.unref();
    const deadline = Date.now() + 8_000;
    while (!url && Date.now() < deadline) {
      if (failure) throw failure;
      await new Promise(resolve => setTimeout(resolve, 100));
      url = await runningWebUrl(defaultFile);
    }
    if (!url) throw new Error('Web preview did not start. Run the web CLI directly to inspect the error.');
  }
  const query = new URLSearchParams();
  if (terminal) query.set('view', 'terminal');
  if (page !== undefined) query.set('page', page);
  return query.size ? `${url}?${query}` : url;
}
