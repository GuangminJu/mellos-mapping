/// <reference lib="dom" />
/** Browser composition root: all mutable viewer state stays here. */
import type { MellosMap } from '../domain/types.js';
import { isVerified } from '../preview/presentation.js';
import { renderMapSvg } from '../preview/svg.js';
import { xml } from '../preview/text.js';
import { focusInfo, mostRecentKey } from '../semantics/semantics.js';
import type { VersionedSnapshot, WebPage, WebSnapshot } from './protocol.js';
import { layoutWebScene, type WebScene } from './scene.js';
import { renderInspector, renderStage, stateOf } from './view.js';
import { fitViewport, svgViewBox, type Viewport } from './viewport.js';
import { showsOverview, zoomScene } from './zoom.js';

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const viewport = element('viewport'), stage = element('stage'), inspector = element('inspector');
const pages = element<HTMLSelectElement>('pages'), search = element<HTMLInputElement>('search');
const dialog = element<HTMLDialogElement>('dialog');
const base = new URL('.', window.location.href);
const kinds: Record<string, string> = { dev: '开发地图', architecture: '架构地图', dataflow: '数据流', 'behavior-tree': '行为树', sequence: '时序地图' };
interface PageView { viewport: Viewport; selected: string | undefined; overview: boolean; fitted: boolean }
let snapshot: WebSnapshot = { project: '', pages: [] }, revision = '', etag = '';
let currentId = new URLSearchParams(location.search).get('page') ?? '';
let follow = true, hover: string | undefined, statusFilter = 'all', scene: WebScene | undefined, renderedOverview = false;
let parents: string[] = [], toastTimer: ReturnType<typeof setTimeout> | undefined;
let deletion: { page: WebPage; revision: string } | undefined;
const views = new Map<string, PageView>();
function view(): PageView {
  let value = views.get(currentId);
  if (!value) { value = { viewport: { x: 0, y: 0, scale: 1 }, selected: undefined, overview: false, fitted: false }; views.set(currentId, value); }
  return value;
}
const current = (): WebPage | undefined => snapshot.pages.find(page => page.id === currentId);
function toast(message: string): void {
  element('toast').textContent = message; element('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element('toast').hidden = true; }, 4500);
}
function setFollow(enabled: boolean): void {
  follow = enabled;
  element('follow').classList.toggle('active', enabled);
  element('follow').setAttribute('aria-pressed', String(enabled));
  element('follow').textContent = enabled ? '● 自动跟随' : '⌖ 当前页已固定';
}
function switchPage(id: string, manual = true, dive = false): void {
  if (!snapshot.pages.some(page => page.id === id)) { toast('这张子地图尚未创建，或已被删除。'); return; }
  if (manual) setFollow(false);
  if (dive) parents.push(currentId); else parents = [];
  currentId = id; hover = undefined; search.value = ''; statusFilter = 'all';
  const url = new URL(location.href); url.searchParams.set('page', id); history.replaceState(null, '', url);
  render();
}
function goBack(): void {
  const parent = parents.pop();
  if (parent === undefined) return;
  if (!snapshot.pages.some(page => page.id === parent)) { toast('父地图已被删除。'); return; }
  const stack = [...parents]; switchPage(parent); parents = stack; renderHeading();
}
function renderHeading(): void {
  const page = current(), map = page?.map;
  const terminalUrl = new URL(base); terminalUrl.searchParams.set('view', 'terminal');
  if (currentId && currentId !== '_default') terminalUrl.searchParams.set('page', currentId);
  element<HTMLAnchorElement>('terminal-mode').href = terminalUrl.href;
  element('project').textContent = snapshot.project;
  element('title').textContent = page?.title ?? '地图已不存在';
  document.title = `${page?.title ?? '地图'} · Mellos`;
  element('kind').textContent = kinds[map?.kind ?? 'dev']!;
  pages.innerHTML = snapshot.pages.map(p => `<option value="${xml(p.id)}">${xml(p.title)}</option>`).join('');
  pages.value = currentId;
  const neutral = !!map?.kind && map.kind !== 'dev', verified = map?.nodes.filter(isVerified).length ?? 0, total = map?.nodes.length ?? 0;
  element('summary').innerHTML = neutral ? `<b>${total}</b> 个模块 · <b>${map?.edges.length ?? 0}</b> 条关系` : `<b>${verified} / ${total}</b> 已验证 · <b>${map?.nodes.filter(n => n.status === 'in-progress').length ?? 0}</b> 进行中`;
  element('progress').hidden = neutral;
  (element('progress').firstElementChild as HTMLElement).style.width = `${total ? verified / total * 100 : 0}%`;
  element('filters').hidden = neutral;
  element('breadcrumbs').innerHTML = parents.map((id, i) => `<button data-parent="${i}">← ${xml(snapshot.pages.find(p => p.id === id)?.title ?? id)}</button><span>›</span>`).join('') + (parents.length ? `<span>${xml(page?.title ?? '')}</span>` : '');
  element<HTMLButtonElement>('export').disabled = !map;
  element<HTMLButtonElement>('delete').disabled = !page || (!page.modified && !page.error);
}
function render(): void {
  renderHeading();
  const page = current(), map = page?.map;
  scene = undefined; stage.innerHTML = '';
  const empty = element('empty'); empty.hidden = !!map?.nodes.length;
  empty.textContent = page?.error ? `地图读取失败\n${page.error}\n修复源文件后会自动恢复。` : !page ? '当前地图已被删除。\n从右上角选择其他地图。' : '地图已连接\n声明模块后，它们会出现在这里。';
  if (!map) { inspector.innerHTML = '<p class="quiet">此页面暂无可显示的地图数据。</p>'; element('minimap').innerHTML = ''; return; }
  const state = view();
  if (state.selected && !focusInfo(map, state.selected)) state.selected = undefined;
  if (hover && !focusInfo(map, hover)) hover = undefined;
  renderedOverview = showsOverview(state, map.groups.length > 0);
  scene = layoutWebScene(map, renderedOverview);
  stage.innerHTML = renderStage(map, scene);
  if (!state.fitted) {
    const fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
    // Start at a readable size. Fit-all is a separate explicit action for
    // large maps; initial page opening must not shrink labels into pixels.
    state.viewport = fitted.scale >= .85 ? fitted : { scale: .85, x: (viewport.clientWidth - scene.width * .85) / 2, y: 18 };
    state.fitted = true;
  }
  element('overview').setAttribute('aria-pressed', String(renderedOverview));
  element<HTMLButtonElement>('overview').disabled = map.groups.length === 0;
  element('overview').title = map.groups.length ? '将同组模块聚合显示' : '这张地图尚未声明分组';
  transform(); updateFocus();
}
function transform(): void {
  const v = view().viewport;
  stage.querySelector<SVGSVGElement>('.map-scene')?.setAttribute('viewBox', svgViewBox(v, viewport.clientWidth, viewport.clientHeight));
  element('zoom-label').textContent = `${Math.round(v.scale * 100)}%`;
  viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
  viewport.style.backgroundSize = `${20 * v.scale}px ${20 * v.scale}px`;
  if (scene) element('minimap').innerHTML = `<svg viewBox="0 0 ${scene.width} ${scene.height}" aria-label="地图缩略图">${scene.nodes.map(n => `<rect class="mini-node" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"/>`).join('')}<rect class="mini-window" x="${-v.x / v.scale}" y="${-v.y / v.scale}" width="${viewport.clientWidth / v.scale}" height="${viewport.clientHeight / v.scale}"/></svg>`;
}
function updateFocus(): void {
  const map = current()?.map;
  if (!map) return;
  const focus = view().selected ?? hover, query = search.value.trim().toLocaleLowerCase();
  const related = new Set<string>(focus ? [focus] : []);
  for (const edge of scene?.edges ?? []) { if (edge.from === focus) related.add(edge.to); if (edge.to === focus) related.add(edge.from); }
  const visible = new Set<string>();
  for (const item of scene?.nodes ?? []) {
    const n = item.node;
    const matchesQuery = !query || [n.label, n.id, n.detail, n.evidence].some(text => text?.toLocaleLowerCase().includes(query)) || map.nodes.some(member => member.group as string === n.id as string && [member.label, member.detail].some(t => t?.toLocaleLowerCase().includes(query)));
    if (matchesQuery && (statusFilter === 'all' || stateOf(n, map) === statusFilter)) visible.add(n.id);
  }
  stage.querySelectorAll<SVGGElement>('[data-node]').forEach(button => {
    const id = button.dataset.node!;
    button.classList.toggle('focus', id === focus);
    button.classList.toggle('muted-node', !visible.has(id) || (!!focus && !related.has(id)));
    button.setAttribute('aria-pressed', String(id === view().selected));
  });
  stage.querySelectorAll<SVGGElement>('.edge').forEach(edge => {
    const from = edge.dataset.from!, to = edge.dataset.to!;
    const focused = from === focus || to === focus;
    edge.classList.toggle('focus', focused);
    edge.classList.toggle('muted-edge', !visible.has(from) || !visible.has(to) || (!!focus && !focused));
  });
  element('filters').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('active', b.dataset.status === statusFilter));
  element('match-count').textContent = query || statusFilter !== 'all' ? `${visible.size} 个匹配模块` : '';
  const content = renderInspector(map, focus);
  if (inspector.innerHTML !== content) inspector.innerHTML = content;
}
function select(id: string | undefined): void {
  view().selected = id; hover = undefined;
  if (id && scene && !scene.nodes.some(n => n.node.id === id)) {
    view().overview = false; view().viewport = { ...view().viewport, scale: Math.max(.65, view().viewport.scale) }; render();
  }
  const box = id ? scene?.nodes.find(n => n.node.id === id) : undefined;
  if (box) {
    const v = view().viewport, x = box.x * v.scale + v.x, y = box.y * v.scale + v.y;
    if (x < 0 || y < 0 || x + box.w * v.scale > viewport.clientWidth || y + box.h * v.scale > viewport.clientHeight) {
      view().viewport = { ...v, x: viewport.clientWidth / 2 - (box.x + box.w / 2) * v.scale, y: viewport.clientHeight / 2 - (box.y + box.h / 2) * v.scale }; transform();
    }
  }
  updateFocus();
}
function fit(): void {
  if (!scene) return;
  let fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
  if (fitted.scale < .55 && !renderedOverview && current()?.map?.groups.length) {
    view().overview = true; render();
    fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
  }
  view().viewport = fitted; transform();
}
function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void {
  Object.assign(view(), zoomScene(view(), factor, x, y));
  if (showsOverview(view(), !!current()?.map?.groups.length) !== renderedOverview) render(); else transform();
}
pages.addEventListener('change', () => switchPage(pages.value));
element('follow').addEventListener('click', () => setFollow(!follow));
element('theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
search.addEventListener('input', () => { view().selected = undefined; updateFocus(); });
search.addEventListener('keydown', event => { if (event.key === 'Enter') { const first = stage.querySelector<SVGGElement>('.node:not(.muted-node)'); if (first?.dataset.node) select(first.dataset.node); } });
element('filters').addEventListener('click', event => { const button = (event.target as Element).closest<HTMLElement>('[data-status]'); if (button) { statusFilter = button.dataset.status!; view().selected = undefined; updateFocus(); } });
element('overview').addEventListener('click', () => { view().overview = !renderedOverview; if (!view().overview) view().viewport = { ...view().viewport, scale: Math.max(.65, view().viewport.scale) }; render(); if (view().overview) fit(); });
element('fit').addEventListener('click', fit);
element('zoom-in').addEventListener('click', () => zoom(1.2));
element('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
stage.addEventListener('click', event => { const node = (event.target as Element).closest<SVGGElement>('[data-node]'); if (node) select(view().selected === node.dataset.node ? undefined : node.dataset.node); });
// SVG groups retain the keyboard activation that HTML buttons previously supplied.
stage.addEventListener('keydown', event => {
  const node = (event.target as Element).closest<SVGGElement>('[data-node]');
  if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(view().selected === node.dataset.node ? undefined : node.dataset.node); }
});
stage.addEventListener('dblclick', event => {
  const node = (event.target as Element).closest<SVGGElement>('[data-node]');
  const target = current()?.map?.nodes.find(n => n.id === node?.dataset.node)?.submap;
  if (target) switchPage(target, true, true);
});
stage.addEventListener('pointerover', event => { const node = (event.target as Element).closest<SVGGElement>('[data-node]'); if (node && hover !== node.dataset.node) { hover = node.dataset.node; updateFocus(); } });
stage.addEventListener('pointerout', event => { if (!(event.relatedTarget as Element | null)?.closest?.('[data-node]')) { hover = undefined; updateFocus(); } });
inspector.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('button');
  if (target?.hasAttribute('data-clear')) select(undefined);
  if (target?.dataset.select) select(target.dataset.select);
  if (target?.dataset.dive) switchPage(target.dataset.dive, true, true);
});
element('breadcrumbs').addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('[data-parent]');
  if (!target) return;
  const index = Number(target.dataset.parent), id = parents[index], stack = parents.slice(0, index);
  if (id !== undefined) { switchPage(id); parents = stack; renderHeading(); }
});
viewport.addEventListener('wheel', event => {
  event.preventDefault(); const bounds = viewport.getBoundingClientRect();
  zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });
let drag: { x: number; y: number; origin: Viewport; moved: boolean } | undefined;
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || (event.target as Element).closest('[data-node]')) return;
  drag = { x: event.clientX, y: event.clientY, origin: view().viewport, moved: false };
  viewport.setPointerCapture(event.pointerId); viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
  view().viewport = { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }; transform();
});
viewport.addEventListener('pointerup', () => { if (drag && !drag.moved) select(undefined); drag = undefined; viewport.classList.remove('dragging'); });
viewport.addEventListener('pointercancel', () => { drag = undefined; viewport.classList.remove('dragging'); });
element('minimap').addEventListener('click', event => {
  if (!scene) return;
  const svg = element('minimap').querySelector('svg')!, rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * scene.width, y = (event.clientY - rect.top) / rect.height * scene.height;
  view().viewport = { ...view().viewport, x: viewport.clientWidth / 2 - x * view().viewport.scale, y: viewport.clientHeight / 2 - y * view().viewport.scale }; transform();
});
let dividerDrag: { y: number; height: number } | undefined;
const divider = element('divider');
function resizeInspector(height: number): void { const value = Math.max(100, Math.min(innerHeight * .5, height)); document.documentElement.style.setProperty('--detail-height', `${value}px`); divider.setAttribute('aria-valuenow', String(Math.round(value))); }
divider.addEventListener('pointerdown', event => { dividerDrag = { y: event.clientY, height: inspector.clientHeight }; divider.setPointerCapture(event.pointerId); });
divider.addEventListener('pointermove', event => { if (dividerDrag) resizeInspector(dividerDrag.height + dividerDrag.y - event.clientY); });
divider.addEventListener('pointerup', () => { dividerDrag = undefined; });
divider.addEventListener('keydown', event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); resizeInspector(inspector.clientHeight + (event.key === 'ArrowUp' ? 20 : -20)); } });
new ResizeObserver(() => { if (scene) transform(); }).observe(viewport);
element('export').addEventListener('click', () => {
  const map = current()?.map; if (!map) return;
  const url = URL.createObjectURL(new Blob([renderMapSvg(map)], { type: 'image/svg+xml' }));
  const link = document.createElement('a'); link.href = url; link.download = `${currentId || 'mellos-map'}.svg`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element('help').addEventListener('click', () => {
  deletion = undefined; element('dialog-confirm').hidden = true; element('dialog-title').textContent = '使用地图';
  element('dialog-body').textContent = '滚轮 / + −：缩放，低于 55% 时聚合分组\n拖动画布：平移 · 0：适应窗口\n悬停：预览关系 · 点击：固定详情\n双击子地图节点：下潜 · Backspace：返回\n/：搜索 · F：开关自动跟随\n方向键：移动视口 · Esc：取消选择\n拖动详情上方的分隔条：调整面板高度\n\n地图变更会自动同步。手动切页会固定当前页；开启自动跟随后，会跟随下一次地图更新。'; dialog.showModal();
});
element('delete').addEventListener('click', () => {
  const page = current(); if (!page) return;
  deletion = { page, revision }; element('dialog-title').textContent = '删除这张地图？';
  element('dialog-body').textContent = `将删除「${page.title}」的地图文件。此操作无法撤销；其他地图中的子地图链接会保留。`;
  element('dialog-confirm').hidden = false; dialog.showModal();
});
element('dialog-cancel').addEventListener('click', () => dialog.close());
element('dialog-confirm').addEventListener('click', async () => {
  if (!deletion) return;
  const confirmed = deletion; deletion = undefined; dialog.close();
  try {
    const response = await fetch(new URL(`api/pages/${confirmed.page.id || '_default'}`, base), { method: 'DELETE', headers: { 'If-Match': `"${confirmed.revision}"` }, signal: AbortSignal.timeout(5000) });
    const result = await response.json() as { error?: string; warning?: string };
    if (!response.ok) throw new Error(result.error ?? '删除失败');
    toast(result.warning ?? '地图已删除。'); etag = '';
  } catch (error) { toast(String(error)); }
});
document.addEventListener('keydown', event => {
  if (dialog.open || (event.target as Element).matches('input,select,textarea')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); search.focus(); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
  else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
  else if (event.key === '0') fit();
  else if (event.key.toLowerCase() === 'f') setFollow(!follow);
  else if (event.key === 'Escape') { if (view().selected) select(undefined); else goBack(); }
  else if (event.key === 'Backspace') { event.preventDefault(); goBack(); }
  else if (event.key.startsWith('Arrow')) {
    event.preventDefault(); const v = view().viewport;
    view().viewport = { ...v, x: v.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: v.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }; transform();
  }
});
async function poll(): Promise<void> {
  try {
    const response = await fetch(new URL('api/state', base), { headers: etag ? { 'If-None-Match': etag } : {}, signal: AbortSignal.timeout(5000) });
    if (response.status !== 304 && !response.ok) throw new Error(`HTTP ${response.status}`);
    element('connection').classList.remove('offline'); element('connection').innerHTML = '<i></i>实时同步';
    if (response.status !== 304) {
      const result = await response.json() as VersionedSnapshot;
      etag = response.headers.get('ETag') ?? '';
      if (result.revision !== revision) {
        const initial = !revision, previous = snapshot, priorPage = current(), priorId = currentId;
        revision = result.revision; snapshot = result.value;
        if (initial && !new URLSearchParams(location.search).has('page')) currentId = mostRecentKey(snapshot.pages.map(p => p.id), id => snapshot.pages.find(p => p.id === id)?.modified) ?? '';
        const changed = snapshot.pages.filter(p => p.modified > (previous.pages.find(old => old.id === p.id)?.modified ?? 0));
        if (!initial && follow && !parents.length && changed.length) currentId = mostRecentKey(changed.map(p => p.id), id => changed.find(p => p.id === id)?.modified) ?? currentId;
        if (priorId !== currentId) {
          hover = undefined; search.value = ''; statusFilter = 'all';
          const url = new URL(location.href); url.searchParams.set('page', currentId); history.replaceState(null, '', url);
        }
        // No data change on this page: preserve DOM focus, hover and selection.
        if (initial || JSON.stringify(priorPage) !== JSON.stringify(current())) render(); else renderHeading();
        element('updated').textContent = `已同步 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      }
    }
  } catch {
    element('connection').classList.add('offline'); element('connection').innerHTML = '<i></i>连接已断开';
    element('updated').textContent = '正在重连 · 显示上次数据';
  } finally { setTimeout(() => { void poll(); }, 800); }
}
void poll();
