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
    // createRequire shim: some deps resolve optional requires at runtime
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ['src/server/server.ts'], outfile: 'dist/server.mjs' });
await build({ ...shared, entryPoints: ['src/watch/watch.ts'], outfile: 'dist/watch.mjs' });

console.log('bundled: dist/server.mjs, dist/watch.mjs');
