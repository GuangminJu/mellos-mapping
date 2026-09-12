import type { MapNode, MellosMap } from '../domain/types.js';
import { focusInfo, kindGlyph } from '../semantics/semantics.js';
import { xml } from '../preview/text.js';
import { isVerified } from '../preview/presentation.js';
import { fitWidth } from '../render/width.js';
import type { WebScene } from './scene.js';

export const STATUS_NAMES = { planned: '待开发', 'in-progress': '进行中', done: '已验证', regressed: '有回归', unverified: '待验证', neutral: '模块' } as const;
export function stateOf(node: MapNode, map: MellosMap): keyof typeof STATUS_NAMES {
  if (map.kind && map.kind !== 'dev') return 'neutral';
  const group = map.groups.find(g => g.id as string === node.id as string);
  const verified = group ? map.nodes.filter(n => n.group === group.id).every(isVerified) : isVerified(node);
  return node.status === 'done' && !verified ? 'unverified' : node.status;
}
export function renderStage(map: MellosMap, scene: WebScene): string {
  // All graph content belongs to ONE SVG viewport, including text and cards.
  // No foreignObject, HTML overlay, image, filter buffer or CSS scale layer.
  return `<svg class="map-scene" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 ${scene.width} ${scene.height}" role="group" aria-label="矢量依赖地图"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>` +
    scene.bands.map(band => `<g class="band" transform="translate(0 ${band.y})"><line x2="${scene.width}"/><rect class="band-rank-box" x="0" y="10" width="29" height="18" rx="3"/><text class="band-rank" x="14.5" y="23" text-anchor="middle">L${band.rank}</text><text x="40" y="24">${xml(band.name)}</text><text class="band-count" x="${scene.width}" y="24" text-anchor="end">${band.count} 个模块</text></g>`).join('') +
    scene.lanes.map(lane => `<text class="lane-label" x="${lane.x + lane.width / 2}" y="16" text-anchor="middle">${xml(lane.label)}</text>`).join('') +
    '<g class="wires" aria-hidden="true">' + scene.edges.map(edge => `<g class="edge" data-from="${xml(edge.from)}" data-to="${xml(edge.to)}"><path d="${edge.path}" marker-end="url(#arrow)"/>${edge.label ? `<text x="${edge.x}" y="${edge.y - 7}" text-anchor="middle">${xml(edge.label)}</text>` : ''}</g>`).join('') + '</g>' +
    scene.nodes.map(box => {
      const n = box.node, status = stateOf(n, map), group = map.groups.find(g => g.id as string === n.id as string);
      const caption = group ? `${map.nodes.filter(m => m.group === group.id).length} 个模块` : n.id;
      const badge = n.submap ? '子地图 ↗' : n.kind ? kindGlyph(n.kind, true) ?? '' : '';
      return `<g class="node ${status}" data-node="${xml(n.id)}" transform="translate(${box.x} ${box.y})" role="button" tabindex="0" aria-pressed="false" aria-label="${xml(n.label)} · ${STATUS_NAMES[status]}"><title>${xml(n.label)}${n.submap ? ' · 双击打开子地图' : ''}</title><rect class="node-card" width="${box.w}" height="${box.h}" rx="9"/><g class="node-head"><circle class="status-dot" cx="19" cy="19" r="3"/><text x="30" y="23">${STATUS_NAMES[status]}</text><text class="node-kind" x="${box.w - 15}" y="23" text-anchor="end">${xml(fitWidth(group ? '分组' : n.kind ?? '', 22))}</text></g><text class="node-title" x="15" y="51">${xml(fitWidth(n.label, Math.floor((box.w - 30) / 8.5)))}</text><text class="node-foot" x="15" y="78">${xml(fitWidth(caption, badge ? 28 : 40))}</text>${badge ? `<text class="submap-badge" x="${box.w - 15}" y="78" text-anchor="end">${xml(badge)}</text>` : ''}</g>`;
    }).join('') + '</svg>';
}

export function renderInspector(map: MellosMap, id?: string): string {
  const info = id ? focusInfo(map, id) : undefined;
  const neutral = map.kind !== undefined && map.kind !== 'dev';
  if (!info) {
    const verified = map.nodes.filter(isVerified).length;
    return `<div class="inspector-heading"><div><span class="eyebrow">${neutral ? 'MAP OVERVIEW' : 'BUILD OVERVIEW'}</span><h2>地图概览</h2></div><span class="quiet">点击节点固定详情</span></div><div class="overview-grid"><div><strong>${map.nodes.length}</strong><span>模块</span></div><div><strong>${map.edges.length}</strong><span>依赖关系</span></div><div><strong>${map.layers.length}</strong><span>层级</span></div><div><strong>${neutral ? map.groups.length : `${verified}/${map.nodes.length}`}</strong><span>${neutral ? '分组' : '已验证'}</span></div></div><p class="inspector-hint">${neutral ? '选择一个模块，查看它的职责与上下游关系。' : map.nodes.some(n => n.status === 'in-progress') ? `正在构建：${map.nodes.filter(n => n.status === 'in-progress').map(n => xml(n.label)).join('、')}` : '模块状态来自项目地图；验证记录会保留在节点详情中。'}</p>`;
  }
  const node = info.kind === 'node' ? info.node : undefined;
  const title = node?.label ?? (info.kind === 'group' ? info.group.label : '');
  const neighbors = (label: string, refs: typeof info.uses) => `<div class="relations"><span class="eyebrow">${label} · ${refs.length}</span><div>${refs.length ? refs.map(ref => `<button class="relation" data-select="${xml(ref.id)}">${xml(ref.label)}${ref.edgeLabel ? `<small>${xml(ref.edgeLabel)}</small>` : ''}<span>↗</span></button>`).join('') : '<span class="quiet">无</span>'}</div></div>`;
  return `<div class="inspector-heading"><div><span class="eyebrow">${xml(info.layerName)}${info.kind === 'node' && info.laneLabel ? ` / ${xml(info.laneLabel)}` : ''}</span><h2>${xml(title)}</h2></div><button class="icon-button" data-clear aria-label="取消选择">×</button></div>` +
    (node ? `<p class="node-description">${xml(node.detail ?? '尚未填写模块说明。')}</p>${node.evidence ? `<div class="evidence ${stateOf(node, map)}"><span>${node.status === 'regressed' ? '回归记录' : '验证记录'}</span><p>${xml(node.evidence)}</p></div>` : ''}${node.submap ? `<button class="dive-button" data-dive="${xml(node.submap)}">打开子地图 <span>↗</span></button>` : ''}` :
      `<div class="group-members">${info.kind === 'group' ? info.members.map(member => `<button class="relation" data-select="${xml(member.id)}">${xml(member.label)}<small>${STATUS_NAMES[stateOf(member, map)]}</small></button>`).join('') : ''}</div>`) +
    `<div class="neighbor-grid">${neighbors(map.kind === 'sequence' ? '此前事件' : '依赖于', info.uses)}${neighbors(map.kind === 'sequence' ? '后续事件' : '被依赖', info.usedBy)}</div>`;
}
