/** Pure vector view. Reuses terminal layout/routing, without ANSI or browser I/O. */
import type { MellosMap } from '../domain/types.js';
import { flipForSequence, isNeutralKind } from '../semantics/semantics.js';
import { layoutColumns, layoutRows } from '../render/layout.js';
import { edgePolyline, routeEdges } from '../render/routing.js';
import { displayWidth, fitWidth } from '../render/width.js';
import { zoomGeometry } from '../render/zoom-geometry.js';
import { isVerified, statusText } from './presentation.js';
import { xml } from './text.js';

const X = 8;
const Y = 26;
const TOP = 20;
const PALETTES = {
  planned: ['#f5f7fa', '#98a3b2', '#566477'],
  'in-progress': ['#fff4d9', '#c48c24', '#805910'],
  done: ['#e9f5ee', '#67a883', '#286247'],
  regressed: ['#fdecec', '#cc7575', '#923d3d'],
  unverified: ['#fff6e8', '#b49a77', '#785e3e'],
  neutral: ['#f2f5f9', '#a1adbc', '#364558'],
} as const;

export function renderMapSvg(map: MellosMap): string {
  const neutral = isNeutralKind(map);
  const originals = new Map(map.nodes.map(n => [n.id, n]));
  const oriented = flipForSequence(map);
  // Reserve enough room for the second status line, cap long labels; full text
  // remains in the document and each SVG node's accessible title.
  const shaped: MellosMap = { ...oriented, nodes: oriented.nodes.map(n => {
    const label = fitWidth(n.label, 32);
    return { ...n, label: label + ' '.repeat(Math.max(0, 20 - displayWidth(label))) };
  }) };
  const geo = { ...zoomGeometry(0), boxGap: 6 };
  const columns = layoutColumns(shaped, geo, true, neutral);
  const routing = routeEdges(shaped, columns);
  const rows = layoutRows(columns, geo, routing.gapRowCount, false, map.lanes.length > 0);
  const width = Math.max(440, (columns.contentWidth + 4 + routing.fallbackCount * 2) * X);
  const height = Math.max(100, TOP + rows.legendY * Y);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc">`,
    `<title id="map-title">${xml(map.title ?? '梅勒斯地图')}</title>`,
    `<desc id="map-desc">${map.nodes.length} 个节点，${map.edges.length} 条依赖。完整说明与验证记录在地图文档中。</desc>`,
    '<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="#8995a5"/></marker></defs>',
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    '<g font-family="Segoe UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif">',
  ];
  if (map.nodes.length === 0) parts.push('<text x="20" y="52" font-size="14" fill="#657286">尚未声明模块，等待地图更新。</text>');
  columns.bands.forEach((band, i) => {
    const top = TOP + rows.barY[i]! * Y;
    const boxes = rows.bandBoxes[i]!;
    const bottom = boxes.reduce((max, b) => Math.max(max, TOP + (b.y + b.h - 1) * Y), top + 60);
    parts.push(`<rect x="8" y="${top - 10}" width="${width - 16}" height="${bottom - top + 26}" rx="5" fill="#fafbfc"/>`);
    parts.push(`<text x="16" y="${top + 5}" font-size="12" fill="#6a7687">${xml(fitWidth(band.name, Math.floor((width - 40) / X)))}</text>`);
  });
  if (rows.laneHeaderY !== undefined) map.lanes.forEach((lane, i) => {
    const region = columns.lanes[i]!;
    parts.push(`<text x="${(region.x + region.w / 2) * X}" y="${TOP + rows.laneHeaderY! * Y + 5}" text-anchor="middle" font-size="12" fill="#566477">${xml(fitWidth(lane.label, region.w))}</text>`);
  });
  for (const edge of routing.edges) {
    const points = edgePolyline(edge, rows).map(([x,y]) => `${x * X},${TOP + y * Y}`).join(' ');
    parts.push(`<polyline points="${points}" fill="none" stroke="#8995a5" stroke-width="1.4" marker-end="url(#arrow)"/>`);
  }
  for (const box of rows.boxOf.values()) {
    const node = originals.get(box.node.id)!;
    const palette = neutral ? PALETTES.neutral : node.status === 'done' && !isVerified(node) ? PALETTES.unverified : PALETTES[node.status];
    const x = box.x * X, y = TOP + box.y * Y, w = (box.w - 1) * X, h = (box.h - 1) * Y;
    const dash = !neutral && node.status === 'planned' ? ' stroke-dasharray="5 4"' : '';
    parts.push(`<g data-node="${xml(node.id)}"><title>${xml(node.label)}${neutral ? '' : ` · ${xml(statusText(node))}`}</title>`);
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${palette[0]}" stroke="${palette[1]}" stroke-width="1.5"${dash}/>`);
    parts.push(`<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-size="14" fill="${palette[2]}">${xml(box.label.trim())}</text>`);
    const secondary = neutral ? node.kind ?? node.id : statusText(node);
    parts.push(`<text x="${x + w / 2}" y="${y + 40}" text-anchor="middle" font-size="11" fill="${palette[2]}">${xml(fitWidth(secondary, box.w - 4))}</text></g>`);
  }
  parts.push('</g></svg>');
  return parts.join('\n');
}
