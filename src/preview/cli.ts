#!/usr/bin/env node
/** Headless entry point: enables and regenerates local MD/SVG previews. */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makePageId } from '../store/format.js';
import { STATE_FILE_RELATIVE_PATH } from '../store/store.js';
import { createPreviewPublisher } from './publisher.js';

export function runPreview(args: readonly string[]): void {
  const usage = 'usage: mellos-mapping-preview <project-directory> [--page <slug>]';
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (!(args.length === 1 || (args.length === 3 && args[1] === '--page')) || args[0]!.startsWith('--')) throw new Error(usage);
  const project = resolve(args[0]!);
  if (!existsSync(project) || !statSync(project).isDirectory()) throw new Error(`Project directory does not exist: ${project}`);
  const parsed = args[2] === undefined ? undefined : makePageId(args[2]);
  if (parsed !== undefined && !parsed.ok) throw new Error(`Invalid page slug: ${args[2]}`);
  const result = createPreviewPublisher(join(project, STATE_FILE_RELATIVE_PATH)).activate(parsed?.value);
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify({ surface: 'markdown', ...result.value, visibility: 'unconfirmed' }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runPreview(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
