/** Prepare reviewable edition branches from a committed source tree. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EDITIONS, packageEdition } from './release-layout.mjs';

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable release version, received: ${version}`);
  }
  return version.split('.').map(BigInt);
}

function isNewer(version, previous) {
  const next = versionParts(version), before = versionParts(previous);
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== before[i]) return next[i] > before[i];
  }
  return false;
}

export function prepareBranches(directory) {
  const root = realpathSync(directory);
  function git(args, options = {}) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true,
      maxBuffer: 16 * 1024 * 1024, ...options });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `git ${args[0]} failed`);
    return result.stdout.trim();
  }
  function refExists(ref) {
    return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: root, windowsHide: true }).status === 0;
  }
  if (git(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('Commit or separately preserve working changes before preparing release branches.');
  }
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const version = JSON.parse(git(['show', `${sourceCommit}:package.json`])).version;
  versionParts(version);
  git(['var', 'GIT_AUTHOR_IDENT']);
  const targets = EDITIONS.map(edition => {
    const branch = `release/${version}/${edition}`;
    const ref = `refs/heads/${branch}`;
    if (refExists(ref)) throw new Error(`Candidate ${branch} already exists; preserve or archive it before retrying.`);
    const baseRef = [`refs/remotes/origin/${edition}`, `refs/heads/${edition}`].find(refExists);
    if (!baseRef) throw new Error(`Missing ${edition} base. Fetch the edition branches from origin first.`);
    const parent = git(['rev-parse', baseRef]);
    const previous = JSON.parse(git(['show', `${parent}:release.json`])).version;
    if (!isNewer(version, previous)) {
      throw new Error(`${edition} is already ${previous}; bump the source version above it before releasing ${version}.`);
    }
    return { edition, branch, ref, baseRef, parent };
  });

  // Pin all inputs to the source commit and use independent temporary indexes.
  const temporary = mkdtempSync(join(tmpdir(), 'mellos-release-branches-'));
  try {
    const source = join(temporary, 'source');
    mkdirSync(source);
    const gitDir = git(['rev-parse', '--absolute-git-dir']);
    const sourceEnv = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: source,
      GIT_INDEX_FILE: join(temporary, 'index-source') };
    git(['read-tree', sourceCommit], { env: sourceEnv });
    git(['checkout-index', '--all', `--prefix=${source.replaceAll('\\', '/')}/`], { env: sourceEnv });
    const commits = {}, branches = {};
    for (const target of targets) {
      const output = packageEdition(source, target.edition);
      const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: output,
        GIT_INDEX_FILE: join(temporary, `index-${target.edition}`) };
      git(['read-tree', '--empty'], { env });
      git(['add', '--force', '--all', '.'], { cwd: output, env });
      const files = git(['ls-files', '-z'], { env }).split('\0').filter(Boolean);
      const executable = files.filter(file => readFileSync(join(output, file), 'utf8').startsWith('#!'));
      if (executable.length) git(['update-index', '--chmod=+x', '--', ...executable], { env });
      const tree = git(['write-tree'], { env });
      commits[target.edition] = git(['commit-tree', tree, '-p', target.parent], {
        input: `Release ${version}: ${target.edition}\n\nSource: ${sourceCommit}\n`,
      });
      branches[target.edition] = target.branch;
    }

    const output = resolve(root, 'artifacts/release/candidates', version);
    for (const path of [join(root, 'artifacts'), join(root, 'artifacts/release'), dirname(output), output]) {
      if (existsSync(path) && realpathSync(path) !== path) throw new Error(`Refusing redirected output: ${path}`);
    }
    if (existsSync(output)) throw new Error(`Candidate artifacts already exist: ${output}. Preserve or archive them before retrying.`);
    mkdirSync(output, { recursive: true });
    for (const [edition, commit] of Object.entries({ main: sourceCommit, ...commits })) {
      git(['archive', '--format=zip', `--output=${join(output, `mellos-mapping-${version}-${edition}.zip`)}`, commit]);
    }
    // Create both candidates atomically; reject concurrent source/base changes.
    const updates = targets.flatMap(target => [
      `verify ${target.baseRef} ${target.parent}`,
      `create ${target.ref} ${commits[target.edition]}`,
    ]);
    git(['update-ref', '--stdin'], { input: `start\nverify HEAD ${sourceCommit}\n${updates.join('\n')}\nprepare\ncommit\n` });
    const bundle = join(output, `mellos-mapping-${version}.bundle`);
    git(['bundle', 'create', bundle, 'HEAD', ...targets.map(target => target.ref)]);
    git(['bundle', 'verify', bundle]);
    const result = { version, sourceCommit, branches, commits,
      bases: Object.fromEntries(targets.map(target => [target.edition, target.parent])), bundle, pushed: false };
    writeFileSync(join(output, 'branches.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
