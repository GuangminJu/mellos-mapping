#!/usr/bin/env node
/**
 * Prove the published tarball actually contains the surface package.json
 * promises — every `exports` target, every `bin` target — and nothing else.
 *
 *   node scripts/check-package-surface.mjs
 *
 * Why this needs its own check: npm-packlist drops a missing `files` entry
 * SILENTLY. `lib/` is gitignored (only npm consumers need it), so before the
 * `prepack` script existed, `git clone && npm ci && npm publish` shipped a
 * tarball whose six subpath exports all pointed at files that were never
 * packed — every `import 'mellos-mapping/store'` in that release failed at
 * resolution, and nothing in the publish said a word. A test cannot state
 * this invariant, because `npm run test` runs before `npm run build` and lib/
 * does not exist yet; this runs after the build, as the last verify step.
 *
 * `npm pack --dry-run` runs the real `prepack` lifecycle, so what is measured
 * here is what `npm publish` would upload, not what happens to be on disk.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * Paths npm always packs regardless of `files`, so they are legitimate
 * members of the tarball without being declared.
 * See https://docs.npmjs.com/cli/configuring-npm/package-json#files
 */
const ALWAYS_PACKED = ['package.json', 'README.md', 'README', 'LICENSE', 'LICENCE', 'CHANGELOG.md'];

/** Collect every `./…` file path an exports map points at, at any nesting depth. */
function exportTargets(node, found = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push(node.slice(2));
    return found;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) exportTargets(value, found);
  }
  return found;
}

// Single command string: an args array alongside shell:true is deprecated
// (DEP0190) because the pieces would be concatenated unescaped.
const packed = spawnSync('npm pack --dry-run --json', {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});
if (packed.status !== 0) {
  console.error(packed.stderr ?? '');
  console.error('npm pack --dry-run failed — cannot verify the package surface.');
  process.exit(1);
}

// `npm pack` runs the real prepack lifecycle and forwards that script's own
// stdout, so the JSON document is the TAIL of the stream, not all of it. npm
// pretty-prints it, which puts the opening bracket alone on its own line —
// the first such line is where the document starts.
const lines = packed.stdout.split(/\r?\n/);
const documentStart = lines.indexOf('[');
if (documentStart < 0) {
  console.error(packed.stdout);
  console.error('npm pack --dry-run --json printed no JSON document.');
  process.exit(1);
}

const [tarball] = JSON.parse(lines.slice(documentStart).join('\n'));
const files = new Set(tarball.files.map((entry) => entry.path));

const promised = [...new Set([...exportTargets(manifest.exports), ...Object.values(manifest.bin)])];
const missing = promised.filter((path) => !files.has(path));

/** A packed path is declared when it is a `files` entry or lives under one. */
const declaredRoots = manifest.files;
const undeclared = [...files].filter(
  (path) =>
    !ALWAYS_PACKED.includes(path) &&
    !declaredRoots.some((root_) => path === root_ || path.startsWith(`${root_}/`)),
);

if (missing.length > 0) {
  console.error(`${tarball.filename}: package.json promises paths the tarball does not contain:`);
  for (const path of missing) console.error(`  ${path}`);
}
if (undeclared.length > 0) {
  console.error(`${tarball.filename}: tarball contains paths no "files" entry declares:`);
  for (const path of undeclared) console.error(`  ${path}`);
}
if (missing.length > 0 || undeclared.length > 0) process.exit(1);

console.log(
  `${tarball.filename}: ${files.size} files, all ${promised.length} exports/bin targets present, nothing undeclared.`,
);
