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
 * `src/`, `lib/` and `tests/` of both packages and rewrites the dsh-internal
 * package names to the published ones in every copied text file — including
 * the client bundle's baked module id, which the dsh web loader must see equal
 * to the installed package name. Manifests, patch layer, and READMEs are owned
 * by this repo and never touched.
 *
 * `tests/` comes across for the same reason `src/` does: the specs ARE the
 * spec of ~1.8k lines of pure logic (layout routing, the page-set model, the
 * scale Schmitt trigger, store-path validation). Leaving them upstream meant
 * the published copy could drift from its own contract with nothing here to
 * notice. Not every spec can run in this repo — the ones that need the
 * @deepseek-ai framework or a DOM cannot — so vitest.config.ts selects, and
 * names, the ones that can.
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

/** Directories copied verbatim from each workspace package. */
const PARTS = ['src', 'lib', 'tests'];

// Validate → prepare → commit: resolve and check EVERY source before deleting
// anything. The previous shape deleted each target immediately before copying
// it, so a workspace missing one part (an unbuilt `lib/`, a package whose
// specs had moved) exited with some targets already wiped and others intact —
// a half-applied sync that git then had to undo by hand.
const transfers = PACKAGES.flatMap(({ from, to }) =>
  PARTS.map((part) => ({
    source: join(dshRoot, from, part),
    target: join(root, to, part),
  })),
);

const absent = transfers.filter(({ source }) => !existsSync(source)).map(({ source }) => source);
if (absent.length > 0) {
  console.error('missing in the dsh workspace — build it first (npm run build:lib) and re-run:');
  for (const source of absent) console.error(`  ${source}`);
  process.exit(1);
}

const copied = [];
for (const { source, target } of transfers) {
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  copied.push(target);
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
