// @ts-check
/** Shell-free invocation of the supported host CLIs. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isFile, resolveCodexInvocation } from './codex-cli.mjs';

/** @param {string} host @param {NodeJS.ProcessEnv} [env] */
export function resolveHost(host, env = process.env) {
  if (host === 'chatgpt-app') return resolveCodexInvocation({ env });
  if (process.platform !== 'win32') return { command: 'claude', args: [] };
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const raw of path.split(';')) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir) continue;
    if (isFile(join(dir, 'claude.exe'))) return { command: join(dir, 'claude.exe'), args: [] };
    if (isFile(join(dir, 'claude.cmd')) || isFile(join(dir, 'claude.ps1'))) {
      const packageRoot = join(dir, 'node_modules/@anthropic-ai/claude-code');
      const native = join(packageRoot, 'bin/claude.exe');
      if (isFile(native)) return { command: native, args: [] };
      const entry = join(packageRoot, 'cli.js');
      if (isFile(entry)) return { command: process.execPath, args: [entry] };
    }
  }
  throw new Error('Claude Code CLI not found on PATH. Install Claude Code, then rerun this command.');
}

/** @param {string} host @param {NodeJS.ProcessEnv} [env] @returns {import('./install-types.js').HostRunner} */
export function hostRunner(host, env = process.env) {
  const cli = resolveHost(host, env);
  return args => spawnSync(cli.command, [...cli.args, ...args], {
    env, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
}

/** @param {import('./install-types.js').HostResult} result @param {string} label */
export function requireSuccess(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}: ${result.error?.message ?? result.stderr?.toString().trim() ?? `exit ${result.status}`}`);
  }
  return result.stdout?.toString() ?? '';
}
