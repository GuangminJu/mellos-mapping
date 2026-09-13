#!/usr/bin/env node
/** CLI for preparing local, reviewable release candidates. */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBranches } from './release-branches.mjs';

try {
  console.log(JSON.stringify(prepareBranches(dirname(dirname(fileURLToPath(import.meta.url)))), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
