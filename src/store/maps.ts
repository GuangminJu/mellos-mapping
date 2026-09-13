import { readFileSync } from 'node:fs';
import { type MellosMap, type Result, err } from '../domain/types.js';
import { mapTextError } from '../domain/text.js';
import { type StoreError, parseMap, serializeMap } from './format.js';
import { writeFileAtomic } from './atomic.js';
import { stripBom } from './json-text.js';

/** Load and validate the map file at `path`. */
export function loadMapFile(path: string): Result<MellosMap, StoreError> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return err({ kind: 'not-found', path });
    throw e; // unexpected I/O fault: fail fast, nothing meaningful to recover here
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    // Expected at this boundary: hand-edited files, or a reader racing a
    // non-atomic writer from a foreign tool.
    return err({ kind: 'malformed-json', path, detail: (e as Error).message });
  }

  return parseMap(raw, path);
}

/**
 * Write the map to `path` atomically (P2): serialize to a private sibling
 * temp file, then rename it over the target, retrying a rename the OS
 * refuses transiently. Creates the parent directory if missing.
 * @returns ok when the file holds the new map; save-failed when it does not,
 *   in which case the previous content is intact and the call may be retried.
 */
export function saveMapFile(path: string, map: MellosMap): Result<void, StoreError> {
  const textError = mapTextError(map);
  if (textError) return err({ kind: 'save-failed', path, detail: textError });
  return writeFileAtomic(path, serializeMap(map));
}
