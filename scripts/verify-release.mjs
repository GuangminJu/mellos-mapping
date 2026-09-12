#!/usr/bin/env node
/** Standalone release check; no host CLI, npm packages or user config required. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRelease } from './install-release.mjs';
import { verifyRuntime } from './verify-runtime.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = validateRelease(root);
const temporary = mkdtempSync(join(tmpdir(), 'mellos-verify-release-'));
const env = { ...process.env };
delete env.MELLOS_MAPPING_CWD; delete env.CLAUDE_PROJECT_DIR;
try {
  const prefix = manifest.edition === 'chatgpt-app' ? 'plugins/mellos-mapping' : '';
  await verifyRuntime(join(root, prefix, 'dist/server.mjs'), temporary, env);
  console.log(`${manifest.edition} ${manifest.version}: file integrity and all six MCP tools verified.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
