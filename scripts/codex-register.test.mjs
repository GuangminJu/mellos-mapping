import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveCodexInvocation } from './codex-cli.mjs';
import { COMMAND_NOT_FOUND_EXIT_CODE, describeFailure, registerServer } from './codex-register.mjs';

describe('Codex process adapter', () => {
  it('resolves an npm installation without sending paths to a shell', () => {
    const dir = 'C:/Users/地图 & tools/npm';
    const entry = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const files = new Set([entry, join(dir, 'codex.cmd')]);
    expect(resolveCodexInvocation({ platform: 'win32', env: { Path: `"${dir}"` }, nodePath: 'node.exe',
      fileExists: (file) => files.has(file) })).toEqual({ command: 'node.exe', args: [entry] });
  });

  it('supports native Windows and POSIX installations', () => {
    const exe = join('C:/tools', 'codex.exe');
    expect(resolveCodexInvocation({ platform: 'win32', env: { PATH: 'C:/tools' },
      fileExists: (file) => file === exe })).toEqual({ command: exe, args: [] });
    expect(resolveCodexInvocation({ platform: 'linux' })).toEqual({ command: 'codex', args: [] });
  });

  it('names a missing CLI clearly', () => {
    expect(() => resolveCodexInvocation({ platform: 'win32', env: {}, fileExists: () => false })).toThrow('codex CLI not found');
    expect(describeFailure(COMMAND_NOT_FOUND_EXIT_CODE)).toContain('codex CLI not found');
    expect(describeFailure(null)).toContain('codex CLI not found');
  });
});

describe('Codex registration', () => {
  it('upserts once with intact arguments and no preceding removal', () => {
    const run = vi.fn(() => ({ status: 0 }));
    const root = 'C:/地图 & %TEMP%/plugin';
    registerServer(root, { run, nodePath: 'C:/Node JS/node.exe', fileExists: () => true });
    expect(run.mock.calls).toEqual([[['mcp', 'add', 'mellos-mapping', '--', 'C:/Node JS/node.exe', join(root, 'dist', 'server.mjs')]]]);
  });

  it('refuses a missing build without touching configuration', () => {
    const run = vi.fn();
    expect(() => registerServer('missing', { run, fileExists: () => false })).toThrow('Bundled MCP server is missing');
    expect(run).not.toHaveBeenCalled();
  });

  it('reports failures without trying to remove the previous registration', () => {
    const run = vi.fn(() => ({ status: 1, stderr: Buffer.from('configuration is read-only') }));
    expect(() => registerServer('plugin', { run, fileExists: () => true })).toThrow('configuration is read-only');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
