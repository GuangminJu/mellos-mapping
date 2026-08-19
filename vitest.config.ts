/**
 * Test surface of the repo: the library's own specs, the repo-level packaging
 * specs, and as much of the dsh plugin packages' spec set as can run here.
 *
 * `packages/dsh` and `packages/dsh-client` are the publishing copies of two
 * packages developed inside a dsh workspace (scripts/sync-dsh-plugin.mjs).
 * Their specs come across with the sources, but their framework
 * (`@deepseek-ai/*`) is supplied by the dsh loader at runtime and is NOT a
 * dependency here — so a spec that reaches the framework, or a DOM, cannot
 * run in this repo. Rather than pretend otherwise, EXCLUDED_PACKAGE_SPECS
 * names each one and why. What is left is the pure logic, which is most of
 * the interesting code: layout routing and the scale Schmitt trigger, the
 * page-set model, and the wheel-to-scale curve.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

interface Manifest {
  exports: Record<string, string | { default: string }>;
}

const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as Manifest;

/**
 * Subpaths whose export target is not a library module the specs may import:
 * the manifest itself, and the MCP server entry (a spawn target, see
 * packages/dsh/cordis.patch.yml).
 */
const NON_LIBRARY_SUBPATHS = ['./package.json', './server'];

/**
 * `mellos-mapping/<subpath>` → this repo's own source.
 *
 * The dsh packages import the published package by name; here that name must
 * resolve to the tree under review, not to a stale `lib/` or an installed
 * copy — otherwise the specs would keep passing while the library they are
 * written against changed underneath them. Derived from the `exports` map so
 * the alias list cannot drift from the published surface.
 */
const libraryAliases = Object.entries(manifest.exports)
  .filter(([subpath]) => !NON_LIBRARY_SUBPATHS.includes(subpath))
  .map(([subpath, target]) => {
    const file = typeof target === 'string' ? target : target.default;
    return {
      find: new RegExp(`^mellos-mapping/${subpath.slice(2).replace(/\//g, '\\/')}$`),
      replacement: `${root}${file.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts')}`,
    };
  });

/**
 * Specs that cannot run in this repo, each with the dependency it needs.
 * A spec is excluded because something real is missing, never to make the
 * suite green — dropping one of these is a task for whoever makes the
 * dependency available, not a cleanup.
 */
const EXCLUDED_PACKAGE_SPECS = [
  // Constructs a cordis Context and mounts the host plugin: needs
  // @deepseek-ai/cordis, @deepseek-ai/schemastery and the typert protocol,
  // which the dsh loader supplies and this repo deliberately does not depend
  // on (see packages/dsh/README.md).
  'packages/dsh/tests/mmap-host.spec.ts',
  // @vitest-environment jsdom, and the module under test imports
  // @deepseek-ai/dsh-client-runtime/client. Neither jsdom nor the runtime is
  // installed here.
  'packages/dsh-client/tests/store.client.spec.ts',
];

export default defineConfig({
  resolve: {
    alias: [
      ...libraryAliases,
      // The dsh client package self-references by its published name.
      { find: /^mellos-mapping-dsh-client\//, replacement: `${root}packages/dsh-client/` },
      // `mellos-mapping-dsh/types` needs no alias: every import of it is
      // `import type`, which esbuild erases before resolution.
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'packages/*/tests/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, ...EXCLUDED_PACKAGE_SPECS],
  },
});
