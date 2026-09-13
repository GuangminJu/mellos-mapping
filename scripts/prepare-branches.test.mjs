import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_FILES, codexSource } from './package-codex.mjs';
import { CLAUDE_FILES, EDITIONS, INSTALLER_FILES } from './release-layout.mjs';
import { prepareBranches } from './release-branches.mjs';

let temporary, root, original;
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function write(file, contents) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'mellos-branch-spec-'));
  root = join(temporary, 'source with spaces');
  mkdirSync(root);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  write('.gitignore', 'artifacts/\n.mellos/\n');
  const files = new Set([...CODEX_FILES.map(codexSource), ...CLAUDE_FILES, ...INSTALLER_FILES,
    ...EDITIONS.flatMap(edition => [`docs/distributions/${edition}.md`, `docs/distributions/${edition}.zh-CN.md`])]);
  for (const file of files) write(file, file.endsWith('.json') ? '{}' : file.endsWith('.mjs') ? '#!/usr/bin/env node\n' : file);
  write('package.json', '{"version":"1.0.0"}');
  write('release.json', '{"version":"1.0.0"}');
  git('add', '.');
  git('commit', '-m', 'Previous edition');
  for (const edition of EDITIONS) {
    git('branch', edition);
    git('update-ref', `refs/remotes/origin/${edition}`, 'HEAD');
  }
  write('package.json', '{"version":"1.0.1"}');
  git('add', '.');
  git('commit', '-m', 'Reviewed source change');
  original = git('show-ref', '--heads');
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

describe('release candidate branches', () => {
  it('preserves checked-out main, edition worktrees and the user index; packages both editions from HEAD', () => {
    git('worktree', 'add', join(temporary, 'claude'), 'claude');
    write('.mellos/private.json', 'local map');
    const index = readFileSync(join(root, '.git/index'));
    const result = prepareBranches(root);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, '.git/index')).equals(index)).toBe(true);
    for (const line of original.split('\n')) {
      const [commit, ref] = line.split(' ');
      expect(git('rev-parse', ref)).toBe(commit);
    }
    expect(result.sourceCommit).toBe(git('rev-parse', 'HEAD'));
    for (const edition of EDITIONS) {
      const branch = result.branches[edition];
      expect(branch).toBe(`release/1.0.1/${edition}`);
      expect(git('rev-parse', `${branch}^`)).toBe(git('rev-parse', `origin/${edition}`));
      expect(JSON.parse(git('show', `${branch}:release.json`)).version).toBe('1.0.1');
      expect(git('ls-tree', '-r', '--name-only', branch)).not.toMatch(/\.mellos|node_modules/);
      expect(git('ls-tree', branch, 'install.mjs')).toMatch(/^100755 /);
      expect(git('show', '-s', '--format=%B', branch)).toContain(`Source: ${result.sourceCommit}`);
    }
    git('bundle', 'verify', result.bundle);
    expect(existsSync(join(dirname(result.bundle), 'mellos-mapping-1.0.1-main.zip'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dirname(result.bundle), 'branches.json'), 'utf8'))).toEqual(result);
    const clone = join(temporary, 'restored');
    git('clone', '-b', result.branches.claude, result.bundle, clone);
    expect(JSON.parse(readFileSync(join(clone, 'release.json'), 'utf8')).edition).toBe('claude');
  }, 30000);

  it.each(['tracked', 'staged', 'untracked'])('rejects %s changes before creating candidates', kind => {
    write(kind === 'untracked' ? 'private.txt' : 'package.json', 'uncommitted content');
    if (kind === 'staged') git('add', 'package.json');
    const status = git('status', '--porcelain');
    expect(() => prepareBranches(root)).toThrow('working changes');
    expect(git('show-ref', '--heads')).toBe(original);
    expect(git('status', '--porcelain')).toBe(status);
    expect(existsSync(join(root, 'artifacts'))).toBe(false);
  });

  it('also prepares from a linked worktree without changing its checkout or the main worktree', () => {
    const primary = root;
    const linked = join(temporary, 'linked');
    git('worktree', 'add', '-b', 'codex/release-preparation', linked, 'main');
    root = linked;
    const result = prepareBranches(root);
    expect(result.sourceCommit).toBe(git('rev-parse', 'HEAD'));
    expect(git('branch', '--show-current')).toBe('codex/release-preparation');
    expect(git('status', '--porcelain')).toBe('');
    root = primary;
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('status', '--porcelain')).toBe('');
  }, 30000);

  it.each(['1.0.0', '0.9.9'])('refuses non-increasing version %s against the remote edition', version => {
    write('package.json', JSON.stringify({ version }));
    git('add', '.');
    git('commit', '-m', 'Version candidate');
    const refs = git('show-ref', '--heads');
    expect(() => prepareBranches(root)).toThrow('bump the source version');
    expect(git('show-ref', '--heads')).toBe(refs);
  });

  it('preserves an existing candidate without partially creating the other one', () => {
    git('branch', 'release/1.0.1/chatgpt-app');
    const refs = git('show-ref', '--heads');
    expect(() => prepareBranches(root)).toThrow('already exists');
    expect(git('show-ref', '--heads')).toBe(refs);
  });

  it('refuses a redirected artifact directory without creating refs or writing outside', () => {
    const outside = join(temporary, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'unrelated');
    symlinkSync(outside, join(root, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => prepareBranches(root)).toThrow('Refusing redirected');
    expect(git('show-ref', '--heads')).toBe(original);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('unrelated');
    expect(existsSync(join(outside, 'release'))).toBe(false);
  }, 30000);
});
