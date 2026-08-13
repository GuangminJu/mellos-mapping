#!/usr/bin/env node
/**
 * Bump the plugin version everywhere it lives, then run the full verify.
 *
 *   node scripts/release.mjs 0.12.0
 *
 * The version is deliberately duplicated across the two plugin manifests
 * (Claude, Codex), the npm package, and the server banner — each consumer
 * reads its own file and none of them can read another's. This script is the
 * single place that knows the full list, so a release cannot bump four spots
 * and forget the fifth. Commit, merge and tag remain manual on purpose.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/release.mjs <semver>   e.g. 0.12.0');
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Replace exactly `count` occurrences of a semver-shaped pattern, or refuse. */
function bump(relPath, pattern, replacement, count) {
  const path = join(root, relPath);
  const text = readFileSync(path, 'utf8');
  const matches = text.match(pattern);
  if ((matches?.length ?? 0) !== count) {
    console.error(`${relPath}: expected ${count} version site(s), found ${matches?.length ?? 0} — refusing.`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(pattern, replacement));
  console.log(`bumped ${relPath}`);
}

const jsonVersion = /"version": "\d+\.\d+\.\d+"/g;
bump('.claude-plugin/plugin.json', jsonVersion, `"version": "${version}"`, 1);
bump('.claude-plugin/marketplace.json', jsonVersion, `"version": "${version}"`, 1);
bump('.codex-plugin/plugin.json', jsonVersion, `"version": "${version}"`, 1);
bump('package.json', jsonVersion, `"version": "${version}"`, 1);
bump('src/server/server.ts', /SERVER_VERSION = '\d+\.\d+\.\d+'/g, `SERVER_VERSION = '${version}'`, 1);

// package-lock.json mirrors the root version in two spots that a regex can't
// safely target among hundreds of dependency versions — let npm resync it.
// (npm ci refuses to install when the lock disagrees with package.json.)
// Single command strings throughout: an args array alongside shell:true is
// deprecated (DEP0190) because the pieces would be concatenated unescaped.
const lock = spawnSync('npm install --package-lock-only', { cwd: root, stdio: 'inherit', shell: true });
if (lock.status !== 0) {
  console.error('package-lock resync failed.');
  process.exit(1);
}
console.log('bumped package-lock.json');

const verify = spawnSync('npm run verify', { cwd: root, stdio: 'inherit', shell: true });
if (verify.status !== 0) {
  console.error('verify failed — versions are bumped but NOT release-ready; fix before committing.');
  process.exit(1);
}
console.log(`\nrelease ${version} verified. Next: commit on a branch, merge to master, tag v${version}, push.`);
