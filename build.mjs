/**
 * Bundle the two entry points into self-contained ESM files under dist/.
 *
 * dist/ is committed on purpose: Claude Code installs plugins by cloning the
 * repo without any build or npm-install step, so everything the plugin runs
 * (including the MCP SDK) must ship pre-bundled and dependency-free.
 */

import { build } from 'esbuild';

const shared = {
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
      "export { STATE_FILE_RELATIVE_PATH, PAGES_DIR_NAME, FOCUS_FILE_NAME, focusFilePath } from './src/store/store.js';",
      "export { ID_RULE } from './src/domain/types.js';",
    ].join('\n'),
    resolveDir: '.',
    sourcefile: 'store-paths.ts',
    loader: 'ts',
  },
  outfile: 'dist/store-paths.mjs',
});

console.log('bundled: dist/server.mjs, dist/watch.mjs, dist/store-paths.mjs');
