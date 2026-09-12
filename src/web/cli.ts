#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATE_FILE_RELATIVE_PATH, writeFileAtomic, describeStoreError } from '../store/store.js';
import { openWebPreview, runningWebUrl, webRuntimeFile } from './launcher.js';
import { startWebService } from './service.js';

export async function runWeb(args: readonly string[]): Promise<void> {
  const entry = fileURLToPath(import.meta.url);
  if (args[0] === '--serve' && args.length === 2) {
    const file = resolve(args[1]!);
    // Simultaneous launchers can reuse the winner. A rare second service exits
    // when it has no requests; neither shares mutable viewer state.
    if (await runningWebUrl(file)) return;
    const directory = dirname(webRuntimeFile(file));
    mkdirSync(directory, { recursive: true });
    if (realpathSync(directory).toLowerCase() !== join(realpathSync(dirname(directory)), 'web').toLowerCase()) throw new Error('Redirected web runtime directory');
    const assets = join(dirname(entry), 'web');
    let service: Awaited<ReturnType<typeof startWebService>>;
    service = await startWebService(file, {
      html: readFileSync(join(assets, 'index.html'), 'utf8'), javascript: readFileSync(join(assets, 'app.js'), 'utf8'), css: readFileSync(join(assets, 'app.css'), 'utf8'),
    }, { onClose: () => {
      try { if (JSON.parse(readFileSync(webRuntimeFile(file), 'utf8')).token === service.token) rmSync(webRuntimeFile(file)); } catch { /* Already removed. */ }
    } });
    const saved = writeFileAtomic(webRuntimeFile(file), JSON.stringify({ port: service.port, token: service.token, pid: process.pid }));
    if (!saved.ok) { await service.close(); throw new Error(describeStoreError(saved.error)); }
    process.once('SIGINT', () => { void service.close(); });
    process.once('SIGTERM', () => { void service.close(); });
    return;
  }
  const usage = 'usage: mellos-mapping-web <project-directory> [--page <slug> | --stop]';
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (!args[0] || args[0].startsWith('--') || !(args.length === 1 || (args.length === 2 && args[1] === '--stop') || (args.length === 3 && args[1] === '--page'))) throw new Error(usage);
  const project = resolve(args[0]);
  if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`Project directory does not exist: ${project}`);
  const file = join(project, STATE_FILE_RELATIVE_PATH);
  if (args[1] === '--stop') {
    const url = await runningWebUrl(file);
    if (url) await fetch(`${url}api/stop`, { method: 'POST', signal: AbortSignal.timeout(2_000) });
    console.log(JSON.stringify({ stopped: true })); return;
  }
  console.log(JSON.stringify({ surface: 'web', url: await openWebPreview(file, entry, args[2]), visibility: 'unconfirmed' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWeb(process.argv.slice(2)).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
