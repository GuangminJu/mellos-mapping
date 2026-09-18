#!/usr/bin/env node
/** Bundle the upstream lock API and copy every supported prebuilt addon. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchedAsEntry } from './codex-cli.mjs';
import { NATIVE_LOCK_PLATFORMS } from './native-lock-assets.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const nativeEntry = require.resolve('fs-native-extensions');
const nativeRoot = dirname(nativeEntry);

export async function buildNativeLock(outputDirectory = join(root, 'dist')) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['scripts/native-lock.cjs'],
    outfile: join(outputDirectory, 'native-lock.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18.17',
    legalComments: 'none',
    write: false,
    metafile: true,
    plugins: [{
      name: 'packaged-native-lock',
      setup(build_) {
        build_.onResolve({ filter: /^\.\/binding$/ }, args => {
          if (resolve(args.importer) === nativeEntry) {
            return { path: join(root, 'scripts/native-lock-binding.cjs') };
          }
        });
      },
    }],
  });
  if (Object.keys(result.metafile.inputs).some(path => path.includes('require-addon'))) {
    throw new Error('Native lock build unexpectedly retained upstream addon discovery.');
  }

  await mkdir(join(outputDirectory, 'native'), { recursive: true });
  await writeFile(join(outputDirectory, 'native-lock.cjs'), result.outputFiles[0].contents);
  for (const platform of NATIVE_LOCK_PLATFORMS) {
    const directory = join(outputDirectory, 'native', platform);
    await mkdir(directory, { recursive: true });
    await copyFile(join(nativeRoot, 'prebuilds', platform, 'fs-native-extensions.node'),
      join(directory, 'fs-native-extensions.node'));
  }

  // The npm tarballs omit upstream NOTICE files; retain the checked-in copies
  // alongside each dependency's complete license. Never fetch during a build.
  const whichRoot = dirname(createRequire(nativeEntry).resolve('which-runtime/package.json'));
  const licenses = await Promise.all([nativeRoot, whichRoot].map(async directory => {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    return `${manifest.name}@${manifest.version}\n\n${await readFile(join(directory, 'LICENSE'), 'utf8')}`;
  }));
  const notices = await readFile(join(root, 'scripts/native-lock-notices.txt'), 'utf8');
  await writeFile(join(outputDirectory, 'native/LICENSES.txt'),
    [...licenses, notices].join('\n\n').replaceAll('\r\n', '\n'));
}

if (launchedAsEntry(import.meta.url)) {
  await buildNativeLock();
  console.log('Native locking: bundled API, six platform addons, and licenses ready.');
}
