import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkedPath, copyRelease, installRelease, validateRelease } from './install-release.mjs';

let temporary, source, installHome;
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'mellos-install-spec-'));
  source = join(temporary, '源码 & clone'); installHome = join(temporary, 'home with spaces');
  const contents = { 'plugins/mellos-mapping/dist/server.mjs': 'server',
    'plugins/mellos-mapping/dist/watch.mjs': 'watch',
    'plugins/mellos-mapping/skills/mellos-mapping/SKILL.md': 'skill' };
  for (const [file, text] of Object.entries(contents)) {
    mkdirSync(dirname(join(source, file)), { recursive: true }); writeFileSync(join(source, file), text);
  }
  writeFileSync(join(source, 'release.json'), JSON.stringify({ edition: 'chatgpt-app', version: '1.0.0',
    sha256: Object.fromEntries(Object.entries(contents).map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')])) }));
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));
function host() {
  return vi.fn(args => ({ status: 0, stdout: args.join(' ').startsWith('mcp get')
    ? JSON.stringify({ transport: { args: [join(installHome, 'chatgpt-app/plugins/mellos-mapping/dist/server.mjs')] } })
    : args[0] === '--version' ? 'codex 1' : JSON.stringify({ installed: [{ name: 'mellos-mapping', enabled: true, version: '1.0.0' }] }) }));
}

describe('clone installer', () => {
  it('installs without shell interpolation and repeats without touching unrelated files', async () => {
    const run = host();
    const verify = vi.fn(async () => []);
    const options = { installHome, makeRunner: () => run, verify, log: () => {} };
    const first = await installRelease(source, [], options);
    writeFileSync(join(first.target, 'keep.txt'), 'unrelated');
    await installRelease(source, [], options);
    expect(readFileSync(join(first.target, 'keep.txt'), 'utf8')).toBe('unrelated');
    expect(run.mock.calls.find(([args]) => args[0] === 'mcp' && args[1] === 'add' && args[2] === 'mellos-mapping')[0]).toEqual([
      'mcp', 'add', 'mellos-mapping', '--', process.execPath, join(first.target, 'plugins/mellos-mapping/dist/server.mjs')]);
    expect(run.mock.calls.some(([args]) => args.includes('remove'))).toBe(false);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(existsSync(verify.mock.calls[0][1])).toBe(false);
  });

  it('check mode and missing prerequisites do not write an installation', async () => {
    const verify = vi.fn(async () => []);
    await installRelease(source, ['--check'], { installHome, verify, makeRunner: () => host(), log: () => {} });
    expect(existsSync(installHome)).toBe(false);
    await expect(installRelease(source, [], { installHome, verify,
      makeRunner: () => () => ({ status: 1, stderr: 'host missing' }) })).rejects.toThrow('host missing');
    expect(existsSync(installHome)).toBe(false);
  });

  it('refuses a corrupt download before invoking the host', async () => {
    writeFileSync(join(source, 'plugins/mellos-mapping/dist/watch.mjs'), 'truncated');
    const makeRunner = vi.fn();
    await expect(installRelease(source, [], { installHome, makeRunner })).rejects.toThrow('checksum');
    expect(makeRunner).not.toHaveBeenCalled();
  });

  it('refuses a wrong edition and escaping paths', async () => {
    await expect(installRelease(source, ['claude'], { installHome })).rejects.toThrow('chatgpt-app edition');
    for (const path of ['../other', '/root', 'C:\\root', 'a/../../other', 'a\\b']) {
      expect(() => checkedPath(installHome, path)).toThrow();
    }
    const manifest = validateRelease(source);
    copyRelease(source, installHome, manifest);
    expect(validateRelease(installHome)).toEqual(manifest);
  });
});
