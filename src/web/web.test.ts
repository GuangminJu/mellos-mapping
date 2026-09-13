import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_MAP, type MellosMap } from '../domain/types.js';
import { applyDeclare } from '../server/apply.js';
import { saveMapFile } from '../store/store.js';
import { createPreviewPublisher } from '../preview/publisher.js';
import { layoutWebScene } from './scene.js';
import { readWebSnapshot } from './source.js';
import { startWebService } from './service.js';
import { renderInspector, renderStage } from './view.js';
import { svgViewBox, zoomViewport } from './viewport.js';
import { showsOverview, zoomScene } from './zoom.js';

const roots: string[] = [];
const services: Awaited<ReturnType<typeof startWebService>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function project() { const root = mkdtempSync(join(tmpdir(), 'mellos-web-')); roots.push(root); mkdirSync(join(root, '.mellos', 'pages'), { recursive: true }); return { root, file: join(root, '.mellos', 'map.json') }; }
function map(): MellosMap {
  const result = applyDeclare(EMPTY_MAP, { title: '测试地图', layers: [{ id: 'bottom', name: '基础', rank: 0 }, { id: 'middle', name: '服务', rank: 1 }, { id: 'top', name: '应用', rank: 2 }],
    nodes: [{ id: 'a', label: '基础 A', layer: 'bottom' }, { id: 'b', label: '服务 B', layer: 'middle' }, { id: 'c', label: '应用 C', layer: 'top' }],
    edges: [{ from: 'c', to: 'b', label: '请求' }, { from: 'b', to: 'a' }, { from: 'c', to: 'a', label: '跨层' }] });
  if (!result.ok) throw new Error('Bad fixture');
  return result.value;
}
const assets = { html: '<!doctype html><title>map</title>', javascript: 'console.log("map")', css: 'body{margin:0}' };

describe('web layout and presentation', () => {
  it('expands grouped members when moving closer after overview or fit', () => {
    const grouped = applyDeclare(map(), { groups: [{ id: 'storage', label: '存储组', layer: 'bottom' }],
      nodes: [{ id: 'd', label: '缓存', layer: 'bottom', group: 'storage' }, { id: 'e', label: '磁盘', layer: 'bottom', group: 'storage' }] });
    if (!grouped.ok) throw new Error('Bad group fixture');
    for (const scale of [.5, .75]) {
      const overview = { viewport: { scale, x: 0, y: 0 }, overview: true };
      const before = layoutWebScene(grouped.value, showsOverview(overview, true));
      expect(before.nodes.map(n => n.node.id)).toContain('storage');
      const closer = zoomScene(overview, 1.2, 300, 200);
      const after = layoutWebScene(grouped.value, showsOverview(closer, true));
      expect(after.nodes.map(n => n.node.id)).toEqual(expect.arrayContaining(['d', 'e']));
      expect(after.nodes.map(n => n.node.id)).not.toContain('storage');
      const farther = zoomScene(closer, .5, 300, 200);
      expect(showsOverview(farther, true)).toBe(true);
      expect(showsOverview(farther, false)).toBe(false);
    }
  });
  it('keeps every card separated, routes skip edges outside intermediate cards, and preserves edge labels', () => {
    const scene = layoutWebScene(map());
    expect(scene.nodes.map(n => n.node.id)).toEqual(['c', 'b', 'a']);
    const [top, middle, bottom] = scene.nodes;
    expect(top!.y + top!.h).toBeLessThan(middle!.y);
    expect(middle!.y + middle!.h).toBeLessThan(bottom!.y);
    const skip = scene.edges.find(e => e.label === '跨层')!;
    expect(skip.x).toBeGreaterThan(Math.max(...scene.nodes.map(n => n.x + n.w)));
    expect(scene.width).toBeGreaterThan(skip.x);
    expect(scene.edges.find(e => e.label === '请求')).toBeDefined();
  });
  it('uses shared sequence direction and keeps lanes aligned', () => {
    const original = map();
    const laned: MellosMap = { ...original, kind: 'sequence', lanes: [{ id: 'client' as never, label: '客户端' }, { id: 'server' as never, label: '服务器' }], nodes: original.nodes.map((node, i) => ({ ...node, lane: (i === 1 ? 'server' : 'client') as never })) };
    const scene = layoutWebScene(laned);
    const a = scene.nodes.find(n => n.node.id === 'a')!, b = scene.nodes.find(n => n.node.id === 'b')!, c = scene.nodes.find(n => n.node.id === 'c')!;
    expect(a.y).toBeLessThan(b.y); expect(b.y).toBeLessThan(c.y);
    expect(a.x).toBe(c.x); expect(b.x).toBeGreaterThan(a.x);
    expect(scene.neutral).toBe(true);
    expect(scene.edges.every(e => scene.nodes.find(n => n.node.id === e.from)!.y < scene.nodes.find(n => n.node.id === e.to)!.y)).toBe(true);
  });
  it('aggregates declared groups without losing ungrouped modules or implying verification', () => {
    const grouped = applyDeclare(map(), { groups: [{ id: 'storage', label: '存储组', layer: 'bottom' }],
      nodes: [{ id: 'd', label: '缓存', layer: 'bottom', group: 'storage', status: 'done' }, { id: 'e', label: '磁盘', layer: 'bottom', group: 'storage', status: 'done' }],
      edges: [{ from: 'b', to: 'd' }, { from: 'b', to: 'e' }] });
    if (!grouped.ok) throw new Error('Bad group fixture');
    const scene = layoutWebScene(grouped.value, true);
    expect(scene.nodes.map(n => n.node.id)).toContain('storage');
    expect(scene.nodes.map(n => n.node.id)).toContain('a');
    expect(scene.nodes.map(n => n.node.id)).not.toContain('d');
    expect(scene.edges.filter(e => e.to === 'storage')).toHaveLength(1);
    expect(renderStage(grouped.value, scene)).toContain('待验证');
    expect(renderInspector(grouped.value, 'storage')).toContain('缓存');
  });
  it('escapes user-authored labels/details and does not imply verification without evidence', () => {
    const original = map();
    const hostile = { ...original, nodes: original.nodes.map(node => ({ ...node, label: '<img src=x onerror=alert(1)>', detail: '</p><script>attack()</script>', status: 'done' as const })) };
    const html = renderStage(hostile, layoutWebScene(hostile)) + renderInspector(hostile, 'a');
    expect(html).not.toContain('<img'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('待验证'); expect(renderInspector(hostile)).toContain('0/3');
  });
  it('keeps the world point under the pointer fixed even at the zoom limit', () => {
    const view = { scale: 1, x: 40, y: 60 }, next = zoomViewport(view, 9, 100, 120);
    expect(next.scale).toBe(2.5);
    expect((100 - next.x) / next.scale).toBe((100 - view.x) / view.scale);
    expect((120 - next.y) / next.scale).toBe((120 - view.y) / view.scale);
  });
  it('projects zoom and pan into the SVG viewport while preserving the cursor anchor', () => {
    const original = { x: 50, y: -30, scale: 1 };
    const zoomed = zoomViewport(original, 2.5, 300, 200);
    const [x, y, width, height] = svgViewBox(zoomed, 900, 600).split(' ').map(Number);
    expect(width).toBe(360); expect(height).toBe(240);
    const worldX = (300 - original.x) / original.scale, worldY = (200 - original.y) / original.scale;
    expect((worldX - x!) * 900 / width!).toBeCloseTo(300);
    expect((worldY - y!) * 600 / height!).toBeCloseTo(200);
    const panned = svgViewBox({ ...zoomed, x: zoomed.x + 70, y: zoomed.y + 30 }, 900, 600).split(' ').map(Number);
    expect((worldX - panned[0]!) * 900 / panned[2]!).toBeCloseTo(370);
    expect((worldY - panned[1]!) * 600 / panned[3]!).toBeCloseTo(230);
  });
  it('keeps cards, text and connections vector-based without raster or HTML overlays', () => {
    const markup = renderStage(map(), layoutWebScene(map()));
    expect(markup).toMatch(/^<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(markup).not.toMatch(/<(?:foreignObject|image|canvas|button|div)\b/);
    expect([...markup.matchAll(/<g[^>]*role="button"[^>]*tabindex="0"/g)]).toHaveLength(3);
    expect([...markup.matchAll(/<text class="node-title"/g)]).toHaveLength(3);
  });
});
describe('project source and local web service', () => {
  it('changes revisions only when project state changes and isolates a corrupt page', () => {
    const { file, root } = project(); saveMapFile(file, map());
    const before = readWebSnapshot(file);
    expect(readWebSnapshot(file)).toEqual(before);
    writeFileSync(join(root, '.mellos', 'pages', 'broken.json'), '{broken');
    const after = readWebSnapshot(file);
    expect(after.revision).not.toBe(before.revision);
    expect(after.value.pages[0]!.map).toEqual(map());
    expect(after.value.pages[1]!.error).toBeTruthy();
  });
  it('serves local assets, tracks file updates, uses ETags and keeps two projects isolated', async () => {
    const one = project(), two = project(); saveMapFile(one.file, map());
    const a = await startWebService(one.file, assets), b = await startWebService(two.file, assets); services.push(a, b);
    expect(await (await fetch(a.url)).text()).toBe(assets.html);
    const response = await fetch(`${a.url}api/state`), before = await response.json();
    expect((await fetch(`${a.url}api/state`, { headers: { 'If-None-Match': response.headers.get('etag')! } })).status).toBe(304);
    saveMapFile(one.file, { ...map(), title: '已更新' });
    const after = await (await fetch(`${a.url}api/state`)).json();
    expect(after.revision).not.toBe(before.revision); expect(after.value.pages[0].title).toBe('已更新');
    expect((await (await fetch(`${b.url}api/state`)).json()).value.pages[0].map.nodes).toHaveLength(0);
  });
  it('rejects cross-origin requests, wrong capabilities, arbitrary paths and invalid deletion ids', async () => {
    const { file } = project(); const service = await startWebService(file, assets); services.push(service);
    expect((await fetch(`${service.url}api/state`, { headers: { Origin: 'https://example.org' } })).status).toBe(403);
    expect((await fetch(new URL('/api/state', service.url))).status).toBe(404);
    expect((await fetch(`${service.url}package.json`)).status).toBe(404);
    expect((await fetch(`${service.url}api/pages/%2e%2e%2foutside`, { method: 'DELETE' })).status).toBe(400);
  });
  it('requires the reviewed revision for deletion and refreshes existing Markdown previews', async () => {
    const { file, root } = project(); saveMapFile(file, map());
    saveMapFile(join(root, '.mellos', 'pages', 'child.json'), map());
    expect(createPreviewPublisher(file).activate().ok).toBe(true);
    const service = await startWebService(file, assets); services.push(service);
    const before = readWebSnapshot(file);
    saveMapFile(file, { ...map(), title: 'New update' });
    expect((await fetch(`${service.url}api/pages/child`, { method: 'DELETE', headers: { 'If-Match': `"${before.revision}"` } })).status).toBe(409);
    const current = readWebSnapshot(file);
    expect((await fetch(`${service.url}api/pages/child`, { method: 'DELETE', headers: { 'If-Match': `"${current.revision}"` } })).status).toBe(200);
    expect(readWebSnapshot(file).value.pages).toHaveLength(1);
    expect(readFileSync(join(root, '.mellos', 'previews', 'page-child.md'), 'utf8')).toContain('地图已删除');
  });
});
