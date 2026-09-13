import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkedPath, copyRelease, installRelease, validateRelease } from './install-release.mjs';
import { stageRelease } from './release-transaction.mjs';
import { verifyInstalledFiles } from './host-installation.mjs';
import { copyFileSync } from 'node:fs';

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
  let installed = false;
  return vi.fn(args => {
    const target = join(installHome, 'chatgpt-app');
    if (args[0] === 'plugin' && args[1] === 'add' && !args.includes('--help')) installed = true;
    return { status: 0, stdout: args.join(' ').startsWith('mcp get')
      ? JSON.stringify({ transport: { args: [join(target, 'plugins/mellos-mapping/dist/server.mjs')] } })
      : args[0] === '--version' ? 'codex 1' : JSON.stringify({ installed: installed ? [{
        pluginId: 'mellos-mapping@mellos-mapping-codex', name: 'mellos-mapping', enabled: true,
        version: validateRelease(target).version, source: { path: join(target, 'plugins/mellos-mapping') },
      }] : [] }) };
  });
}

function revise(version = '1.0.1') {
  const manifest = validateRelease(source);
  const file = 'plugins/mellos-mapping/dist/server.mjs';
  writeFileSync(join(source, file), 'new server');
  manifest.version = version;
  manifest.sha256[file] = createHash('sha256').update('new server').digest('hex');
  writeFileSync(join(source, 'release.json'), JSON.stringify(manifest));
  return manifest;
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
    expect(verify).toHaveBeenCalledTimes(4);
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

  it('a failed second copy leaves the complete previous version intact', () => {
    const previous = validateRelease(source);
    const target = join(installHome, 'chatgpt-app');
    copyRelease(source, target, previous);
    const next = revise();
    let copied = 0;
    expect(() => stageRelease(source, target, next, { copy: (from, to) => {
      if (++copied === 2) throw new Error('disk full');
      copyFileSync(from, to);
    } })).toThrow('disk full');
    expect(validateRelease(target)).toEqual(previous);
    expect(readFileSync(join(target, 'plugins/mellos-mapping/dist/server.mjs'), 'utf8')).toBe('server');
    expect(existsSync(`${target}.install-lock`)).toBe(false);
  });

  it('refuses concurrent installs and supports rollback after activation', () => {
    const previous = validateRelease(source);
    const target = join(installHome, 'chatgpt-app');
    copyRelease(source, target, previous);
    const next = revise();
    const transaction = stageRelease(source, target, next);
    expect(() => stageRelease(source, target, next)).toThrow('locked');
    transaction.activate();
    expect(validateRelease(target).version).toBe('1.0.1');
    transaction.rollback();
    expect(validateRelease(target)).toEqual(previous);
  });

  it('restores previous files and registration when installed runtime verification fails', async () => {
    const run = host();
    const verify = vi.fn(async () => []);
    const options = { installHome, makeRunner: () => run, verify, log: () => {} };
    const first = await installRelease(source, [], options);
    const previous = validateRelease(first.target);
    revise();
    verify.mockImplementationOnce(async () => []).mockRejectedValueOnce(new Error('installed runtime broken'));
    await expect(installRelease(source, [], options)).rejects.toThrow('installed runtime broken');
    expect(validateRelease(first.target)).toEqual(previous);
    expect(run.mock.calls.filter(([args]) => args[0] === 'mcp' && args[1] === 'add' && args[2] === 'mellos-mapping')).toHaveLength(3);
  });

  it('refuses same-version replacement before mutating the installation', async () => {
    const run = host();
    const options = { installHome, makeRunner: () => run, verify: async () => [], log: () => {} };
    const first = await installRelease(source, [], options);
    const previous = validateRelease(first.target);
    revise('1.0.0');
    run.mockClear();
    await expect(installRelease(source, [], options)).rejects.toThrow('Bump the release version');
    expect(validateRelease(first.target)).toEqual(previous);
    expect(run.mock.calls.some(([args]) => args[0] === 'plugin' && args[1] === 'add' && !args.includes('--help'))).toBe(false);
  });

  it('rejects stale host cache content even when its reported version is correct', () => {
    const manifest = validateRelease(source);
    const cached = join(temporary, 'host cache');
    copyRelease(source, cached, manifest);
    const next = revise();
    expect(() => verifyInstalledFiles(join(cached, 'plugins/mellos-mapping'), next)).toThrow('Host cache');
    expect(() => verifyInstalledFiles(join(source, 'plugins/mellos-mapping'), next)).not.toThrow();
  });

  it('leaves files unchanged when the named marketplace belongs to another clone', async () => {
    const run = host();
    const options = { installHome, makeRunner: () => run, verify: async () => [], log: () => {} };
    const first = await installRelease(source, [], options);
    const previous = validateRelease(first.target);
    revise();
    const foreign = vi.fn(args => args[0] === 'plugin' && args[1] === 'list'
      ? { status: 0, stdout: JSON.stringify({ installed: [{ pluginId: 'mellos-mapping@mellos-mapping-codex', source: { path: join(temporary, 'another clone') } }] }) }
      : run(args));
    await expect(installRelease(source, [], { ...options, makeRunner: () => foreign })).rejects.toThrow('another source');
    expect(validateRelease(first.target)).toEqual(previous);
    expect(existsSync(`${first.target}.install-lock`)).toBe(false);
  });
});
