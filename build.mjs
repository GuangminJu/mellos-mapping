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

import { rm, mkdir, copyFile, chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildNativeLock } from './scripts/build-native-lock.mjs';

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

await buildNativeLock();

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
    js: "#!/usr/bin/env node\nimport { createRequire as __mellosCreateRequire } from 'node:module'; const require = __mellosCreateRequire(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ['src/server/server.ts'], outfile: 'dist/server.mjs' });
await build({ ...shared, entryPoints: ['src/watch/cli.ts'], outfile: 'dist/watch.mjs' });
await build({ ...shared, banner: {}, entryPoints: ['src/preview/cli.ts'], outfile: 'dist/preview.mjs' });
await build({ ...shared, banner: { js: "import { createRequire as __mellosCreateRequire } from 'node:module'; const require = __mellosCreateRequire(import.meta.url);" }, entryPoints: ['src/web/cli.ts'], outfile: 'dist/web.mjs' });
await build({ ...shared, banner: {}, entryPoints: ['src/web/terminal-worker.ts'], outfile: 'dist/terminal-worker.mjs' });
await build({ absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  entryPoints: ['src/web/app.ts'], outfile: 'dist/web/app.js', legalComments: 'none' });
await mkdir(join(root, 'dist/web'), { recursive: true });
await build({ absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  entryPoints: ['src/web/terminal-app.ts'], outfile: 'dist/web/terminal.js', legalComments: 'none' });
await copyFile(join(root, 'node_modules/@xterm/xterm/css/xterm.css'), join(root, 'dist/web/xterm.css'));
await writeFile(join(root, 'dist/web/TERMINAL-LICENSES.txt'), (await Promise.all(['@xterm/xterm', '@xterm/addon-fit', 'ws'].map(async name => name + '\n\n' + await readFile(join(root, 'node_modules', name, 'LICENSE'), 'utf8')))).join('\n\n'));
for (const name of ['index.html', 'app.css', 'terminal.html', 'terminal.css']) await copyFile(join(root, 'src/web', name), join(root, 'dist/web', name));
// Both browser surfaces share the same support notice without another request.
const starStyles = await readFile(join(root, 'src/web/star-reminder.css'), 'utf8');
for (const name of ['app.css', 'terminal.css']) {
  const target = join(root, 'dist/web', name);
  await writeFile(target, (await readFile(target, 'utf8')) + '\n' + starStyles);
}

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
 * The omp host adapter. `package.json#omp.extensions` names this exact path,
 * and omp loads extension modules as IMPORTS — so no shebang (the banner is
 * dropped), and the entry must keep default-exporting the factory.
 */
await build({ ...shared, banner: {}, entryPoints: ['src/host/omp/extension.ts'], outfile: 'dist/omp-extension.mjs' });

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
      '  VIEWERS_DIR_NAME,',
      '  readLiveViewers,',
      "} from './src/store/store.js';",
      "export { ID_RULE } from './src/domain/types.js';",
      "export { resolveProjectDirectory } from './src/store/project.js';",
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'store-paths.ts',
    loader: 'ts',
  },
  outfile: 'dist/store-paths.mjs',
});

// Banner-supplied shebangs do not make esbuild chmod the output. Match the
// executable entries shipped by the release packager on POSIX too.
for (const file of ['server.mjs', 'watch.mjs', 'preview.mjs', 'web.mjs', 'mmap.mjs', 'hook-session-start.mjs']) {
  await chmod(join(root, 'dist', file), 0o755);
}

console.log(`cleaned: ${OUTPUT_DIRS.join(', ')}`);
console.log(
  'bundled: dist/server.mjs, dist/watch.mjs, dist/preview.mjs, dist/mmap.mjs, dist/hook-session-start.mjs, dist/omp-extension.mjs, dist/store-paths.mjs',
);
