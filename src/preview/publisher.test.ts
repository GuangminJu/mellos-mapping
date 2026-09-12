import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_MAP } from '../domain/types.js';
import { type PageId, pageFilePath, saveMapFile } from '../store/store.js';
import { createPreviewPublisher, previewDirectory, previewFile } from './publisher.js';

let directory: string;
let stateFile: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'mellos-preview-')); stateFile = join(directory, '.mellos', 'map.json'); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('derived preview publication', () => {
  it('publishes relative images, keeps sources untouched and survives publisher recreation', () => {
    saveMapFile(stateFile, { ...EMPTY_MAP, title: '默认' });
    const page = 'map' as PageId;
    saveMapFile(pageFilePath(stateFile, page), { ...EMPTY_MAP, title: '命名页' });
    const before = readFileSync(stateFile, 'utf8');
    const publisher = createPreviewPublisher(stateFile);
    expect(publisher.enabled()).toBe(false);
    const result = publisher.activate(page);
    expect(result.ok).toBe(true);
    expect(createPreviewPublisher(stateFile).enabled()).toBe(true);
    const md = readFileSync(previewFile(stateFile, page), 'utf8');
    const image = /!\[[^\]]*\]\((images\/[a-f0-9]+\.svg)\)/.exec(md)?.[1];
    expect(image).toBeDefined();
    expect(readFileSync(join(dirname(previewFile(stateFile, page)), image!), 'utf8')).toContain('<svg');
    expect(previewFile(stateFile)).not.toBe(previewFile(stateFile, page));
    expect(readFileSync(stateFile, 'utf8')).toBe(before);
    expect(publisher.refresh(page).ok).toBe(true);
    expect(readdirSync(join(previewDirectory(stateFile), 'images'))).toHaveLength(2);
  });

  it('tombstones removed pages and reports unknown names instead of inventing maps', () => {
    const page = 'child' as PageId;
    saveMapFile(pageFilePath(stateFile, page), EMPTY_MAP);
    const publisher = createPreviewPublisher(stateFile);
    expect(publisher.activate(page).ok).toBe(true);
    rmSync(pageFilePath(stateFile, page));
    expect(publisher.refresh().ok).toBe(true);
    expect(readFileSync(previewFile(stateFile, page), 'utf8')).toContain('地图已删除');
    expect(publisher.activate(page).ok).toBe(false);
    expect(existsSync(pageFilePath(stateFile, page))).toBe(false);
  });

  it('rejects unsafe paths and corrupt source files before replacing a valid preview', () => {
    saveMapFile(stateFile, { ...EMPTY_MAP, title: '保留' });
    const publisher = createPreviewPublisher(stateFile);
    expect(publisher.activate().ok).toBe(true);
    const previous = readFileSync(previewFile(stateFile), 'utf8');
    expect(publisher.refresh('../escape' as PageId).ok).toBe(false);
    writeFileSync(stateFile, '{ invalid');
    expect(publisher.refresh().ok).toBe(false);
    expect(readFileSync(previewFile(stateFile), 'utf8')).toBe(previous);
  });

  it('reports a busy publisher without overwriting its preview, then retries', () => {
    saveMapFile(stateFile, EMPTY_MAP);
    const publisher = createPreviewPublisher(stateFile);
    expect(publisher.activate().ok).toBe(true);
    const previous = readFileSync(previewFile(stateFile), 'utf8');
    const lock = join(previewDirectory(stateFile), '.publish-lock');
    mkdirSync(lock);
    const busy = publisher.refresh();
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.error).toContain('busy or was interrupted');
    expect(readFileSync(previewFile(stateFile), 'utf8')).toBe(previous);
    rmSync(lock, { recursive: true });
    expect(publisher.refresh().ok).toBe(true);
  });
});
