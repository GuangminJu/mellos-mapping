#!/usr/bin/env node
/** Build a Codex distribution from the shared runtime and skill sources. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchedAsEntry } from './codex-cli.mjs';
import { NATIVE_LOCK_FILES } from './native-lock-assets.mjs';

/** Explicit allowlist: never copy project maps, dependencies or Claude hooks. */
export const CODEX_FILES = [
  '.codex-plugin/plugin.json',
  'skills/mellos-mapping/SKILL.md',
  'dist/server.mjs',
  'dist/watch.mjs',
  'dist/preview.mjs',
  'dist/web.mjs',
  'dist/web/app.js',
  'dist/web/app.css',
  'dist/web/index.html',
  'dist/terminal-worker.mjs',
  'dist/web/terminal.js',
  'dist/web/terminal.html',
  'dist/web/terminal.css',
  'dist/web/xterm.css',
  'dist/web/TERMINAL-LICENSES.txt',
  'dist/mmap.mjs',
  'dist/store-paths.mjs',
  ...NATIVE_LOCK_FILES,
  'scripts/codex-cli.mjs',
  'scripts/codex-register.mjs',
  'scripts/install-mmap-command.mjs',
  'scripts/mmap.mjs',
  'scripts/open-pane.mjs',
  'scripts/pane-core.mjs',
  'scripts/terminal-session.mjs',
  'scripts/tmux-session.mjs',
  'scripts/watcher-command.mjs',
  'docs/codex.md',
  'docs/map-api.md',
  'docs/locking.md',
  'LICENSE',
];

export const codexSource = file => file === 'skills/mellos-mapping/SKILL.md'
  ? `integrations/codex/${file}` : file;

export function packageCodex(sourceRoot) {
  const root = realpathSync(sourceRoot);
  // Check every input before replacing any previous successful package.
  for (const file of CODEX_FILES) {
    if (!existsSync(join(root, codexSource(file))) || !statSync(join(root, codexSource(file))).isFile()) {
      throw new Error(`Codex package input missing: ${file}. Run npm run build first.`);
    }
  }
  const output = resolve(root, 'artifacts', 'codex', 'mellos-mapping');
  // A junction in an output ancestor must not turn cleanup into a write
  // outside this checkout, or back into the source tree itself.
  for (const directory of [join(root, 'artifacts'), join(root, 'artifacts', 'codex'), output]) {
    if (existsSync(directory) && realpathSync(directory) !== directory) {
      throw new Error(`Refusing redirected Codex output directory: ${directory}`);
    }
  }
  const owned = relative(root, output);
  if (owned !== ['artifacts', 'codex', 'mellos-mapping'].join(sep)) throw new Error('Invalid Codex output path.');
  rmSync(output, { recursive: true, force: true });
  for (const file of CODEX_FILES) {
    const target = join(output, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, codexSource(file)), target);
  }
  const manifestPath = join(output, '.codex-plugin/plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.skills = './skills/';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return output;
}

if (launchedAsEntry(import.meta.url)) {
  try {
    console.log(`Codex package ready: ${packageCodex(dirname(dirname(fileURLToPath(import.meta.url))))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
