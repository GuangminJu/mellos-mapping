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
      terminal: { html: readFileSync(join(assets, 'terminal.html'), 'utf8'), javascript: readFileSync(join(assets, 'terminal.js'), 'utf8'), css: readFileSync(join(assets, 'terminal.css'), 'utf8'), xtermCss: readFileSync(join(assets, 'xterm.css'), 'utf8') },
    }, { terminalWorker: join(dirname(entry), 'terminal-worker.mjs'), onClose: () => {
      try { if (JSON.parse(readFileSync(webRuntimeFile(file), 'utf8')).token === service.token) rmSync(webRuntimeFile(file)); } catch { /* Already removed. */ }
    } });
    const saved = writeFileAtomic(webRuntimeFile(file), JSON.stringify({ port: service.port, token: service.token, pid: process.pid }));
    if (!saved.ok) { await service.close(); throw new Error(describeStoreError(saved.error)); }
    process.once('SIGINT', () => { void service.close(); });
    process.once('SIGTERM', () => { void service.close(); });
    return;
  }
  const usage = 'usage: mellos-mapping-web <project-directory> [--terminal] [--page <slug>] | <project-directory> --stop';
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (!args[0] || args[0].startsWith('--')) throw new Error(usage);
  let terminal = false, page: string | undefined, stop = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--terminal' && !terminal) terminal = true;
    else if (args[i] === '--page' && page === undefined && args[i + 1] && !args[i + 1]!.startsWith('--')) page = args[++i];
    else if (args[i] === '--stop' && args.length === 2) stop = true;
    else throw new Error(usage);
  }
  const project = resolve(args[0]);
  if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`Project directory does not exist: ${project}`);
  const file = join(project, STATE_FILE_RELATIVE_PATH);
  if (stop) {
    const url = await runningWebUrl(file);
    if (url) await fetch(`${url}api/stop`, { method: 'POST', signal: AbortSignal.timeout(2_000) });
    console.log(JSON.stringify({ stopped: true })); return;
  }
  console.log(JSON.stringify({ surface: terminal ? 'web-terminal' : 'web', url: await openWebPreview(file, entry, page, terminal), visibility: 'unconfirmed' }));
}
// Node resolves the module path through symlinks, but leaves argv[1] as supplied
// (notably /var vs /private/var on macOS). Compare the same canonical path.
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runWeb(process.argv.slice(2)).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
