/**
 * The lockfile is a distribution artifact, not a local scratch file.
 *
 * `npm ci` installs exactly the `resolved` URLs written here — on CI, on a
 * contributor's first clone, and inside every plugin install that runs one.
 * A lockfile regenerated behind a registry mirror bakes that mirror's host
 * into all of them, and npm never rewrites it back: `replace-registry-host`
 * defaults to `npmjs`, which only rewrites npmjs-owned hosts. The mirror then
 * silently becomes the supply chain for everyone who clones this repo.
 *
 * So the host is an invariant of the checked-in file, and this spec is where
 * it is stated. `scripts/release.mjs` passes the same registry explicitly
 * when it resyncs the lock, so a release cannot re-bake a developer's mirror.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The one registry `resolved` may point at — see the module header. */
const REQUIRED_REGISTRY_PREFIX = 'https://registry.npmjs.org/';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

interface LockfileEntry {
  resolved?: string;
  integrity?: string;
  link?: boolean;
}

interface Lockfile {
  packages: Record<string, LockfileEntry>;
}

const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as Lockfile;

/** Every entry that names a downloadable tarball; the root and links have none. */
const resolvedEntries = Object.entries(lockfile.packages).filter(
  ([, entry]) => entry.resolved !== undefined,
);

describe('package-lock.json registry hosts', () => {
  it('records tarballs for every installed package', () => {
    // A lockfile regenerated with node_modules present but its hidden lock
    // removed drops `resolved`/`integrity` from entries npm infers off disk;
    // `npm ci` then installs unverified trees. Guard the shape, not a count.
    const withoutResolved = Object.entries(lockfile.packages)
      .filter(([path, entry]) => path !== '' && entry.link !== true && entry.resolved === undefined)
      .map(([path]) => path);
    expect(withoutResolved).toEqual([]);
    expect(resolvedEntries.length).toBeGreaterThan(0);
  });

  it('resolves every package from the official npm registry', () => {
    const offRegistry = resolvedEntries
      .filter(([, entry]) => !entry.resolved?.startsWith(REQUIRED_REGISTRY_PREFIX))
      .map(([path, entry]) => `${path} -> ${entry.resolved}`);
    expect(offRegistry).toEqual([]);
  });

  it('carries an integrity hash beside every tarball URL', () => {
    const withoutIntegrity = resolvedEntries
      .filter(([, entry]) => entry.integrity === undefined)
      .map(([path]) => path);
    expect(withoutIntegrity).toEqual([]);
  });
});
