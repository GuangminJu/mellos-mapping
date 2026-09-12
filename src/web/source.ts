import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { EMPTY_MAP, ID_RULE } from '../domain/types.js';
import { describeStoreError, listPageFiles, loadMapFile, pageIdOfFile } from '../store/store.js';
import type { VersionedSnapshot, WebPage } from './protocol.js';

/** Isolate corrupt pages instead of replacing them with a plausible empty map. */
export function readWebSnapshot(defaultFile: string): VersionedSnapshot {
  const pages: WebPage[] = listPageFiles(defaultFile).map(file => {
    const id = pageIdOfFile(defaultFile, file) ?? '';
    const title = id || '默认地图';
    try {
      if (id !== '' && !ID_RULE.test(id)) throw new Error('Invalid page filename');
      const modified = statSync(file).mtimeMs;
      const result = loadMapFile(file);
      return result.ok
        ? { id, title: result.value.title ?? title, modified, map: result.value }
        : { id, title, modified, error: describeStoreError(result.error) };
    } catch (error) {
      return { id, title, modified: 0, error: String(error) };
    }
  });
  if (pages.length === 0) pages.push({ id: '', title: '等待第一张地图', modified: 0, map: EMPTY_MAP });
  const value = { project: basename(dirname(dirname(defaultFile))), pages };
  return { revision: createHash('sha256').update(JSON.stringify(value)).digest('hex'), value };
}
