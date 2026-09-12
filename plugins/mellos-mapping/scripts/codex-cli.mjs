/** Codex process adapter. Arguments never pass through a command shell. */
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** Resolve native Codex or the official npm shim's JS entry on Windows. */
export function resolveCodexInvocation({
  platform = process.platform, env = process.env, nodePath = process.execPath, fileExists = isFile,
} = {}) {
  if (platform !== 'win32') return { command: 'codex', args: [] };
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const raw of path.split(';')) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir) continue;
    const executable = join(dir, 'codex.exe');
    if (fileExists(executable)) return { command: executable, args: [] };
    const entry = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fileExists(entry) && (fileExists(join(dir, 'codex.cmd')) || fileExists(join(dir, 'codex.ps1')))) {
      return { command: nodePath, args: [entry] };
    }
  }
  throw new Error('codex CLI not found on PATH — install Codex first (native executable or official npm package).');
}

export function runCodex(args) {
  const cli = resolveCodexInvocation();
  // Keep diagnostics as bytes; JSON callers decode their own structured output.
  return spawnSync(cli.command, [...cli.args, ...args], {
    stdio: 'pipe', windowsHide: true, timeout: 30_000,
  });
}

export function launchedAsEntry(moduleUrl) {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch { return false; }
}
