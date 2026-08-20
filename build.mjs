/**
 * Clean the build outputs, then bundle the two entry points into
 * self-contained ESM files under dist/.
 *
 * dist/ is committed on purpose: Claude Code installs plugins by cloning the
 * repo without any build or npm-install step, so everything the plugin runs
 * (including the MCP SDK) must ship pre-bundled and dependency-free.
 *
 * lib/ is emitted right after this script by `tsc -p tsconfig.lib.json` — the
 * npm/library surface the package's `exports` map points at.
 */

import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Anchor every path at this file, so the build does not depend on the caller's cwd. */
const root = dirname(fileURLToPath(import.meta.url));

/**
 * Output directories this build owns end to end, wiped before every run.
 *
 * Neither emitter deletes: esbuild and tsc only overwrite the files they
 * produce this run, so a module removed from src/ leaves its stale .js and
 * .d.ts behind forever. `files` packs lib/ and dist/ wholesale, so that stale
 * output ships in the tarball and keeps answering imports that should have
 * stopped resolving. Deleting first is the only way the tree can shrink.
 *
 * `lib/` also has to be BUILT before a pack, not just cleaned: it is
 * gitignored, so a fresh clone has none, and npm-packlist drops missing
 * `files` entries silently — the `prepack` script in package.json runs this.
 */
const OUTPUT_DIRS = ['dist', 'lib'];

for (const dir of OUTPUT_DIRS) {
  await rm(join(root, dir), { recursive: true, force: true });
}

const shared = {
  // Resolve entry points and outfiles against the repo root, not the cwd.
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  legalComments: 'none',
  banner: {
    // Shebang first so npm bin shims can exec the bundles directly on POSIX;
    // then the createRequire shim: some deps resolve optional requires at runtime.
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ['src/server/server.ts'], outfile: 'dist/server.mjs' });
await build({ ...shared, entryPoints: ['src/watch/watch.ts'], outfile: 'dist/watch.mjs' });

/**
 * The human's `mmap` toggle, as one file.
 *
 * It is already plain JavaScript, so this bundle exists for two other reasons:
 * `bin` targets must live under a packed directory (dist/ is; scripts/ is
 * packed file-by-file), and the plugin's PATH shim wants a single self-
 * contained file to point at rather than a script plus its sibling module.
 * The bundle inlines scripts/pane-core.mjs and keeps the ONE runtime import —
 * dist/store-paths.mjs, resolved from `import.meta.url` — dynamic, so the
 * store's vocabulary still has exactly one definition.
 *
 * No banner: the entry point is already a runnable script and esbuild carries
 * its shebang through, so the shared banner would prepend a SECOND one — and a
 * `#!` on line 2 is a syntax error, not a comment. Nothing in this bundle
 * resolves a require at runtime either, so the createRequire shim would be
 * dead weight even where it parsed.
 */
await build({ ...shared, banner: {}, entryPoints: ['scripts/mmap.mjs'], outfile: 'dist/mmap.mjs' });

/**
 * The SessionStart hook. hooks/hooks.json names this exact path under
 * ${CLAUDE_PLUGIN_ROOT}, so the two move together; tests/plugin.test.ts holds
 * them to it.
 */
await build({ ...shared, entryPoints: ['src/hook/session-start.ts'], outfile: 'dist/hook-session-start.mjs' });

/**
 * The store's own path vocabulary, for the plain-node launcher scripts.
 *
 * scripts/open-pane.mjs runs on bare node and cannot import the TypeScript
 * sources; lib/ only exists after a tsc build and never ships to plugin
 * installs (Claude Code clones the repo unbuilt). So the constants are
 * re-exported from the real modules into one tiny bundle the scripts import.
 * The alternative — a second copy of each filename in the script — is exactly
 * how the focus request came to be written to a name no watcher ever read.
 *
 * No shebang: this artifact is imported, never executed.
 */
await build({
  ...shared,
  banner: {},
  stdin: {
    contents: [
      'export {',
      '  STATE_FILE_RELATIVE_PATH,',
      '  PAGES_DIR_NAME,',
      '  FOCUS_FILE_NAME,',
      '  focusFilePath,',
      '  QUIT_FILE_NAME,',
      '  quitFilePath,',
      "} from './src/store/store.js';",
      "export { ID_RULE } from './src/domain/types.js';",
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'store-paths.ts',
    loader: 'ts',
  },
  outfile: 'dist/store-paths.mjs',
});

console.log(`cleaned: ${OUTPUT_DIRS.join(', ')}`);
console.log(
  'bundled: dist/server.mjs, dist/watch.mjs, dist/mmap.mjs, dist/hook-session-start.mjs, dist/store-paths.mjs',
);
