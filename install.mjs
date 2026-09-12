#!/usr/bin/env node
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRelease } from './scripts/install-release.mjs';

try {
  await installRelease(dirname(fileURLToPath(import.meta.url)), process.argv.slice(2));
} catch (error) {
  console.error(`Installation failed: ${error.message}`);
  process.exitCode = 1;
}
