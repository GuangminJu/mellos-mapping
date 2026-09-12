#!/usr/bin/env node
/** Prepare local release refs without checking out, staging or pushing user work. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, EDITIONS, packageEdition } from './release-layout.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const branches = ['main', ...EDITIONS];
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true,
    maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `git ${args[0]} failed`);
  return result.stdout.trim();
}

// Checked-out refs must never move behind their worktrees. Existing release
// refs can advance only from a previous generated release, preserving history.
const checkedOut = new Set(git(['worktree', 'list', '--porcelain']).split('\n')
  .filter(line => line.startsWith('branch ')).map(line => line.slice(7)));
const parents = {};
for (const branch of branches) {
  const ref = `refs/heads/${branch}`;
  if (checkedOut.has(ref)) throw new Error(`${branch} is checked out. Run from your release-preparation branch instead.`);
  const found = spawnSync('git', ['rev-parse', '--verify', ref], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (found.status === 0) {
    const subject = git(['log', '-1', '--format=%s', ref]);
    if (!/^Release \d+\.\d+\.\d+: (main|claude|chatgpt-app)$/.test(subject)) {
      throw new Error(`${branch} contains non-generated work. Preserve it and reconcile before preparing this release.`);
    }
    parents[branch] = found.stdout.trim();
  }
}
const head = git(['rev-parse', 'HEAD']);
git(['var', 'GIT_AUTHOR_IDENT']); // Require the user's configured identity; never invent one.
const gitDir = git(['rev-parse', '--absolute-git-dir']);
const temporary = mkdtempSync(join(tmpdir(), 'mellos-release-branches-'));
try {
  const main = join(temporary, 'main');
  mkdirSync(main);
  const roots = new Set(['.claude-plugin', '.codex-plugin', '.github', 'commands', 'dist', 'docs', 'hooks',
    'integrations', 'scripts', 'skills', 'src', 'tests']);
  const topFiles = new Set(['.gitattributes', '.gitignore', '.mcp.json', 'build.mjs', 'CHANGELOG.md',
    'CONTRIBUTING.md', 'install.mjs', 'LICENSE', 'package.json', 'package-lock.json', 'README.md',
    'README.zh-CN.md', 'SECURITY.md', 'server.json', 'tsconfig.json', 'tsconfig.lib.json', 'vitest.config.ts']);
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const file of new Set(paths)) {
    if (!(topFiles.has(file) || roots.has(file.split('/')[0])) || !existsSync(join(root, file))) continue;
    // Do not let accidental credentials or local captures enter a public snapshot.
    if (/(^|\/)(\.env(?:\..*)?|auth\.json|credentials[^/]*|codex-clipboard[^/]*)$|\.(pem|key|pfx)$/i.test(file)) {
      throw new Error(`Review non-release file before packaging: ${file}`);
    }
    copyFile(join(root, file), join(main, file));
  }
  const outputs = { main, ...Object.fromEntries(EDITIONS.map(edition => [edition, packageEdition(root, edition)])) };
  const commits = {};
  for (const branch of branches) {
    const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: outputs[branch], GIT_INDEX_FILE: join(temporary, `index-${branch}`) };
    git(['read-tree', '--empty'], { env });
    git(['add', '--force', '--all', '.'], { cwd: outputs[branch], env });
    // Prebuilt executable entrypoints must remain usable on POSIX clones.
    const files = git(['ls-files', '-z'], { env }).split('\0').filter(Boolean);
    const executable = files.filter(file => readFileSync(join(outputs[branch], file), 'utf8').startsWith('#!'));
    if (executable.length) git(['update-index', '--chmod=+x', '--', ...executable], { env });
    const tree = git(['write-tree'], { env });
    const parent = parents[branch] ?? (branch === 'main' ? head : commits.main);
    commits[branch] = git(['commit-tree', tree, '-p', parent], { input: `Release ${version}: ${branch}\n` });
  }
  // One ref transaction; if anything moved concurrently, none of the refs move.
  const updates = branches.map(branch => `update refs/heads/${branch} ${commits[branch]} ${parents[branch] ?? '0'.repeat(40)}`);
  git(['update-ref', '--stdin'], { input: `start\n${updates.join('\n')}\nprepare\ncommit\n` });
  const output = join(root, 'artifacts/release');
  for (const branch of branches) git(['archive', '--format=zip', `--output=${join(output, `mellos-mapping-${version}-${branch}.zip`)}`, `refs/heads/${branch}`]);
  const bundle = join(output, `mellos-mapping-${version}.bundle`);
  git(['bundle', 'create', bundle, ...branches.map(branch => `refs/heads/${branch}`)]);
  git(['bundle', 'verify', bundle]);
  writeFileSync(join(output, 'branches.json'), JSON.stringify({ version, commits, bundle }, null, 2) + '\n');
  console.log(JSON.stringify({ version, commits, bundle, pushed: false }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
