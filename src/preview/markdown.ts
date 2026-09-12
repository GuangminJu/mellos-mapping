/** Pure document projection. JSON remains the sole editable map source. */
import type { MellosMap } from '../domain/types.js';
import { isNeutralKind } from '../semantics/semantics.js';
import { documentName, isVerified, statusText } from './presentation.js';
import { cell, markdown as md } from './text.js';

export interface PreviewPage {
  readonly page: string | undefined;
  readonly map: MellosMap;
}

export function renderMapMarkdown(map: MellosMap, image: string, pages: readonly PreviewPage[]): string {
  const neutral = isNeutralKind(map);
  const rows = [`# ${md(map.title ?? '梅勒斯地图')}`, '', '[所有地图](index.md)', '',
    '> 自动生成的地图预览；修改地图数据后重新生成。', ''];
  if (!neutral) {
    const active = map.nodes.filter(n => n.status === 'in-progress');
    rows.push(`**当前：** ${active.length ? active.map(n => md(n.label)).join('、') : '暂无进行中的模块'}`, '',
      `已验证 **${map.nodes.filter(isVerified).length} / ${map.nodes.length}**　｜　回归 **${map.nodes.filter(n => n.status === 'regressed').length}**`, '');
  }
  rows.push('## 分层依赖', '', `![分层依赖地图](${image})`, '');
  if (!neutral) rows.push('· 待开发　⠿ 开发中　■ 已验证　✗ 出现回归　□ 完成但缺少证据', '');
  rows.push(map.kind === 'sequence' ? '时间从上向下推进；箭头保留地图中的依赖方向。' : '箭头由使用方指向它依赖的模块；基础层位于下方。', '', '## 模块详情', '');
  const nodes = new Map(map.nodes.map(n => [n.id, n]));
  const layers = [...map.layers].sort((a,b) => map.kind === 'sequence' ? a.rank - b.rank : b.rank - a.rank);
  for (const layer of layers) {
    rows.push(`### ${md(layer.name)}`, '');
    const members = map.nodes.filter(n => n.layer === layer.id);
    if (!members.length) rows.push('尚未声明模块。', '');
    for (const node of members) {
      rows.push(`#### ${md(node.label)}${neutral ? '' : `　${statusText(node)}`}`, '');
      if (node.detail !== undefined) rows.push(md(node.detail), '');
      const used = map.edges.filter(e => e.from === node.id);
      rows.push(`**依赖：** ${used.length ? used.map(e => `${md(nodes.get(e.to)!.label)}${e.label !== undefined ? `（${md(e.label)}）` : ''}`).join('、') : '无'}`, '');
      const meta = [node.group === undefined ? undefined : map.groups.find(g => g.id === node.group)?.label,
        node.lane === undefined ? undefined : map.lanes.find(l => l.id === node.lane)?.label,
        node.kind].filter((v): v is string => v !== undefined);
      if (meta.length) rows.push(`**归属 / 类型：** ${meta.map(md).join(' · ')}`, '');
      if (node.evidence !== undefined) rows.push(`**验证记录：** ${md(node.evidence)}`, '');
      if (node.submap !== undefined) rows.push(pages.some(p => p.page === node.submap)
        ? `[打开子图：${md(node.submap)}](${documentName(node.submap)})`
        : `子图尚未创建：${md(node.submap)}`, '');
    }
  }
  if (!neutral) {
    rows.push('## 验证记录', '', '| 模块 | 状态 | 最近证据 |', '| --- | --- | --- |');
    for (const node of map.nodes) rows.push(`| ${cell(node.label)} | ${statusText(node)} | ${node.evidence === undefined ? '尚未记录' : cell(node.evidence)} |`);
    rows.push('');
  }
  rows.push('---', '', '静态文档：更新时重新生成地图图片与文字。图中节点不支持拖拽、悬停展开或动画。', '');
  return rows.join('\n');
}

export function renderPreviewIndex(pages: readonly PreviewPage[]): string {
  return ['# 梅勒斯地图 · 页面目录', '', ...pages.map(p =>
    `- [${md(p.map.title ?? p.page ?? '默认地图')}](${documentName(p.page)})`), '',
    '地图预览由项目内的地图数据生成。', ''].join('\n');
}
