/** Filesystem adapter for derived previews. Never writes back into map JSON. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EMPTY_MAP, ID_RULE, type Result, err, ok } from '../domain/types.js';
import { type PageId, describeStoreError, listPageFiles, loadMapFile, pageIdOfFile, writeFileAtomic } from '../store/store.js';
import { renderMapMarkdown, renderPreviewIndex, type PreviewPage } from './markdown.js';
import { documentName } from './presentation.js';
import { renderMapSvg } from './svg.js';

export const PREVIEW_DIR_NAME = 'previews';
const ENABLED = '.enabled';
const PUBLISH_LOCK = '.publish-lock';

export interface PublishedPreview {
  readonly path: string;
  readonly index: string;
  readonly pages: number;
}

export function previewDirectory(defaultFile: string): string {
  return join(dirname(defaultFile), PREVIEW_DIR_NAME);
}

export function previewFile(defaultFile: string, page?: PageId): string {
  if (page !== undefined && !ID_RULE.test(page)) throw new Error('Invalid preview page id.');
  return join(previewDirectory(defaultFile), documentName(page));
}

function save(path: string, contents: string): void {
  try { if (readFileSync(path, 'utf8') === contents) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = writeFileAtomic(path, contents);
  if (!result.ok) throw new Error(describeStoreError(result.error));
}

/** Output directories cannot redirect generated writes through a junction. */
function ownedDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
  const expected = join(realpathSync(dirname(path)), path.slice(dirname(path).length + 1));
  const actual = realpathSync(path);
  if ((process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) {
    throw new Error(`Preview directory redirects outside its parent: ${path}`);
  }
}

/**
 * Serialize project-wide projections across processes. Source saves stay
 * independent; the next waiting publisher reads them AFTER taking this lock,
 * so an older project snapshot cannot overwrite a later page's preview.
 * A killed exporter leaves a visible failure, never a silently stale success.
 */
function acquireLock(directory: string): () => void {
  const path = join(directory, PUBLISH_LOCK);
  const deadline = Date.now() + 2_000;
  while (true) {
    try { mkdirSync(path); return () => rmdirSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Preview export is busy or was interrupted. Retry; if no exporter is running, remove the stale lock directory: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/**
 * Activation is project-local and survives MCP restarts. Each publisher reads
 * it again, so concurrent clients cooperate without a shared server process.
 * SVG names are content-addressed: a document always points at a complete
 * image and file-preview caches cannot reuse the previous state's picture.
 * Old images stay available to open documents; the preview directory is a
 * disposable cache, never source history.
 */
export function createPreviewPublisher(defaultFile: string) {
  const directory = previewDirectory(defaultFile);
  const enabledFile = join(directory, ENABLED);
  const enabled = (): boolean => existsSync(enabledFile);

  const refresh = (page?: PageId): Result<PublishedPreview, string> => {
    try {
      const path = previewFile(defaultFile, page);
      ownedDirectory(directory);
      const release = acquireLock(directory);
      try {
        const pages: PreviewPage[] = [];
        for (const source of listPageFiles(defaultFile)) {
          const slug = pageIdOfFile(defaultFile, source);
          if (slug !== undefined && !ID_RULE.test(slug)) throw new Error(`Invalid map page filename: ${source}`);
          const loaded = loadMapFile(source);
          if (!loaded.ok) throw new Error(describeStoreError(loaded.error));
          pages.push({ page: slug, map: loaded.value });
        }
        // An unopened project can show a standby default map. A misspelled named
        // page must not manufacture a plausible empty diagram.
        if (page !== undefined && !pages.some(p => p.page === page)) return err(`No map page named "${page}".`);
        if (page === undefined && !pages.some(p => p.page === undefined)) pages.unshift({ page: undefined, map: EMPTY_MAP });
        const images = join(directory, 'images');
        ownedDirectory(images);
        const present = new Set<string>();
        for (const item of pages) {
          const svg = renderMapSvg(item.map);
          const digest = createHash('sha256').update(svg).digest('hex');
          const image = `images/${digest}.svg`;
          save(join(images, `${digest}.svg`), svg);
          const filename = documentName(item.page);
          save(join(directory, filename), renderMapMarkdown(item.map, image, pages));
          present.add(filename);
        }
        // An already-open deleted page must stop presenting its old state.
        for (const filename of readdirSync(directory)) {
          if (/^(map|page-[a-z0-9][a-z0-9-]{0,63})\.md$/.test(filename) && !present.has(filename)) {
            save(join(directory, filename), '# 地图已删除\n\n此页面已不在项目地图中。\n\n[返回地图目录](index.md)\n');
          }
        }
        const index = join(directory, 'index.md');
        save(index, renderPreviewIndex(pages));
        return ok({ path: resolve(path), index: resolve(index), pages: pages.length });
      } finally {
        release();
      }
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  };

  const activate = (page?: PageId): Result<PublishedPreview, string> => {
    const published = refresh(page);
    if (!published.ok) return published;
    try { save(enabledFile, 'Markdown preview updates are enabled for this project.\n'); }
    catch (error) { return err(error instanceof Error ? error.message : String(error)); }
    return published;
  };
  return { enabled, refresh, activate };
}
