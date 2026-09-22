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
 *
 * Publishing is a workflow, not a laptop step: `.github/workflows/publish-npm.yml`
 * publishes from the version tag through npm Trusted Publishing, authenticated
 * by GitHub Actions OIDC, with `--provenance` attached. `npm publish` from a
 * laptop cannot attach that attestation and is stopped by the account's 2FA,
 * so this script never publishes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { updateLockVersion } from './version-metadata.mjs';

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

// Tolerates prerelease suffixes (0.20.0-dev.0) so a dev line can be released
// without hand-normalizing first.
const jsonVersion = /"version": "\d+\.\d+\.\d+[^"]*"/g;
bump('.claude-plugin/plugin.json', jsonVersion, `"version": "${version}"`, 1);
bump('.claude-plugin/marketplace.json', jsonVersion, `"version": "${version}"`, 1);
bump('.codex-plugin/plugin.json', jsonVersion, `"version": "${version}"`, 1);
bump('package.json', jsonVersion, `"version": "${version}"`, 1);
bump('server.json', jsonVersion, `"version": "${version}"`, 2); // top-level + packages[0]
bump('src/support/version.ts', /VERSION = '\d+\.\d+\.\d+'/g, `VERSION = '${version}'`, 1);

// A version-only release keeps the resolved dependency graph intact on every OS.
const lockPath = join(root, 'package-lock.json');
writeFileSync(lockPath, updateLockVersion(readFileSync(lockPath, 'utf8'), version));

console.log('bumped package-lock.json');

const verify = spawnSync('npm run verify', { cwd: root, stdio: 'inherit', shell: true });
if (verify.status !== 0) {
  console.error('verify failed — versions are bumped but NOT release-ready; fix before committing.');
  process.exit(1);
}
console.log(`\nrelease ${version} verified. Next: commit on a branch, merge to main, tag v${version}, push.`);
