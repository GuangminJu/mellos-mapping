import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHost } from './host-cli.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe.skipIf(process.platform !== 'win32')('Claude Windows npm installation discovery', () => {
  it('follows npm native and legacy package layouts without invoking a shell shim', () => {
    const prefix = mkdtempSync(join(tmpdir(), 'mellos-claude-host-')); roots.push(prefix);
    const packageRoot = join(prefix, 'node_modules/@anthropic-ai/claude-code');
    mkdirSync(join(packageRoot, 'bin'), { recursive: true });
    writeFileSync(join(prefix, 'claude.ps1'), '# npm launcher');
    const legacy = join(packageRoot, 'cli.js'); writeFileSync(legacy, '// legacy CLI');
    const env = { PATH: prefix };
    expect(resolveHost('claude', env)).toEqual({ command: process.execPath, args: [legacy] });
    const native = join(packageRoot, 'bin/claude.exe'); writeFileSync(native, 'native CLI fixture');
    expect(resolveHost('claude', env)).toEqual({ command: native, args: [] });
    rmSync(legacy);
    expect(resolveHost('claude', env)).toEqual({ command: native, args: [] });
  });
});
