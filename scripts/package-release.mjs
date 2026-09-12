#!/usr/bin/env node
/** Build both clone-installable editions. No Git or host configuration changes. */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageEdition, EDITIONS } from './release-layout.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const edition of EDITIONS) console.log(`${edition}: ${packageEdition(root, edition)}`);
