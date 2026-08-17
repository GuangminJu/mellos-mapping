#!/usr/bin/env node
/**
 * Sync the DeepSeek Harness plugin packages from a dsh workspace checkout.
 *
 *   node scripts/sync-dsh-plugin.mjs <path-to-deepseek-harness>
 *
 * The dsh surface (host read seam + browser map panel) is DEVELOPED inside a
 * dsh workspace checkout, where the framework's own toolchain builds it (tsc
 * project references, the tsdown client-bundle preset with its CSS pipeline
 * and purity gates). This repo is the PUBLISHING home: sources and built
 * artifacts are committed here — the same policy that commits `dist/` at the
 * root — under this repo's own package names.
 *
 * This script is the whole bridge, so a refresh cannot half-happen: it copies
 * `src/` and `lib/` of both packages and rewrites the dsh-internal package
 * names to the published ones in every copied text file — including the
 * client bundle's baked module id, which the dsh web loader must see equal to
 * the installed package name. Manifests, patch layer, and READMEs are owned
 * by this repo and never touched.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dshRoot = process.argv[2];
if (dshRoot === undefined || !existsSync(join(dshRoot, 'packages'))) {
  console.error('usage: node scripts/sync-dsh-plugin.mjs <path-to-deepseek-harness-checkout>');
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** dsh workspace path → published package directory here. */
const PACKAGES = [
  { from: 'packages/mmap/mmap-host', to: 'packages/dsh' },
  { from: 'packages/client/ui-mmap', to: 'packages/dsh-client' },
];

/** dsh-internal name → published name, applied to every copied text file. */
const RENAMES = [
  ['@deepseek-ai/dsh-client-ui-mmap', 'mellos-mapping-dsh-client'],
  ['@deepseek-ai/dsh-mmap-host', 'mellos-mapping-dsh'],
];

/** Workspace files that stay behind: dsh gate scaffolding and build state. */
const EXCLUDED = [/(^|[\\/])invariant\.(ts|js|d\.ts)(\.map)?$/, /tsbuildinfo$/];

const copied = [];
for (const { from, to } of PACKAGES) {
  for (const part of ['src', 'lib']) {
    const source = join(dshRoot, from, part);
    const target = join(root, to, part);
    if (!existsSync(source)) {
      console.error(`missing ${source} — build the dsh workspace first (npm run build:lib).`);
      process.exit(1);
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    copied.push(target);
  }
}

/** Recursively rewrite names in every copied text file. */
function rewrite(path) {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) {
      rewrite(child);
      continue;
    }
    if (EXCLUDED.some((pattern) => pattern.test(child))) {
      rmSync(child);
      continue;
    }
    const text = readFileSync(child, 'utf8');
    let next = text;
    for (const [fromName, toName] of RENAMES) next = next.split(fromName).join(toName);
    if (next !== text) writeFileSync(child, next);
  }
}
for (const target of copied) rewrite(target);

// The rename list above must leave no dsh-internal self-name behind; other
// @deepseek-ai/* specifiers are the framework the dsh loader supplies.
for (const [fromName] of RENAMES) {
  for (const target of copied) {
    const leftovers = [];
    const scan = (path) => {
      for (const entry of readdirSync(path)) {
        const child = join(path, entry);
        if (statSync(child).isDirectory()) scan(child);
        else if (readFileSync(child, 'utf8').includes(fromName)) leftovers.push(child);
      }
    };
    scan(target);
    if (leftovers.length > 0) {
      console.error(`rename left ${fromName} behind in:\n  ${leftovers.join('\n  ')}`);
      process.exit(1);
    }
  }
}

console.log(`synced ${PACKAGES.map((p) => p.to).join(', ')} from ${dshRoot}`);
