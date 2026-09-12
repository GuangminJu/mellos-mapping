/** Pure pixel geometry. Shares semantic aggregation and time direction with the TUI. */
import type { MapNode, MellosMap } from '../domain/types.js';
import { aggregateMap, flipForSequence, isNeutralKind } from '../semantics/semantics.js';
import { displayWidth } from '../render/width.js';

export interface SceneNode { readonly node: MapNode; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface SceneEdge { readonly from: string; readonly to: string; readonly label: string; readonly path: string; readonly x: number; readonly y: number }
export interface SceneBand { readonly id: string; readonly name: string; readonly rank: number; readonly y: number; readonly count: number }
export interface WebScene {
  readonly width: number; readonly height: number; readonly neutral: boolean;
  readonly nodes: readonly SceneNode[]; readonly edges: readonly SceneEdge[]; readonly bands: readonly SceneBand[];
  readonly lanes: readonly { label: string; x: number; width: number }[];
}
const CARD_W = 248, CARD_H = 94, GAP = 36, ROW = 160, MARGIN = 32;

export function layoutWebScene(source: MellosMap, overview = false): WebScene {
  const map = overview ? aggregateMap(source) ?? source : source;
  const oriented = flipForSequence(map);
  const layers = [...oriented.layers].sort((a, b) => b.rank - a.rank);
  const rows = layers.map(layer => map.nodes.filter(node => node.layer === layer.id));
  const laneKeys = map.lanes.length ? [...map.lanes.map(lane => lane.id as string), ''] : [];
  const laneWidths = laneKeys.map(id => Math.max(1, ...rows.map(row => row.filter(n => (n.lane ?? '') === id).length)) * (CARD_W + GAP));
  if (laneKeys.length && !map.nodes.some(n => n.lane === undefined)) { laneKeys.pop(); laneWidths.pop(); }
  const contentWidth = Math.max(568, laneKeys.length ? laneWidths.reduce((sum, w) => sum + w, 0) - GAP : Math.max(0, ...rows.map(row => row.length)) * (CARD_W + GAP) - GAP);
  const header = map.lanes.length ? 46 : 0;
  const nodes: SceneNode[] = [];
  rows.forEach((row, index) => {
    if (!laneKeys.length) {
      const start = MARGIN + (contentWidth - (row.length * (CARD_W + GAP) - GAP)) / 2;
      row.forEach((node, i) => nodes.push({ node, x: start + i * (CARD_W + GAP), y: header + index * ROW + 48, w: CARD_W, h: CARD_H }));
    } else {
      let x = MARGIN;
      laneKeys.forEach((lane, i) => {
        row.filter(n => (n.lane ?? '') === lane).forEach((node, j) => nodes.push({ node, x: x + j * (CARD_W + GAP), y: header + index * ROW + 48, w: CARD_W, h: CARD_H }));
        x += laneWidths[i]!;
      });
    }
  });
  const nodeOf = new Map(nodes.map(node => [node.node.id as string, node]));
  const bandOf = new Map(layers.map((layer, i) => [layer.id, i]));
  let skipCount = 0;
  const routed = oriented.edges.map(edge => {
    const from = nodeOf.get(edge.from)!, to = nodeOf.get(edge.to)!;
    const exits = oriented.edges.filter(e => e.from === edge.from);
    const entries = oriented.edges.filter(e => e.to === edge.to);
    const x1 = from.x + from.w * (exits.indexOf(edge) + 1) / (exits.length + 1);
    const x2 = to.x + to.w * (entries.indexOf(edge) + 1) / (entries.length + 1);
    const y1 = from.y + from.h, y2 = to.y, mid = (y1 + y2) / 2;
    if (bandOf.get(to.node.layer)! - bandOf.get(from.node.layer)! > 1) {
      const side = MARGIN + contentWidth + 24 + skipCount++ * 18;
      return { from: edge.from, to: edge.to, label: edge.label ?? '', x: side, y: mid,
        path: `M ${x1} ${y1} V ${y1 + 18} Q ${x1} ${y1 + 26} ${x1 + 8} ${y1 + 26} H ${side - 8} Q ${side} ${y1 + 26} ${side} ${y1 + 34} V ${y2 - 28} Q ${side} ${y2 - 20} ${side - 8} ${y2 - 20} H ${x2 + 8} Q ${x2} ${y2 - 20} ${x2} ${y2 - 12} V ${y2}` };
    }
    return { from: edge.from, to: edge.to, label: edge.label ?? '', x: (x1 + x2) / 2, y: mid,
      path: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}` };
  });
  // Parallel connections can share a gap but must not share a label baseline.
  const occupied: { x: number; y: number; half: number }[] = [];
  const edges = routed.map(edge => {
    if (!edge.label) return edge;
    const half = displayWidth(edge.label) * 2.8 + 6;
    const offset = [0, 14, -14, 28, -28].find(offset => !occupied.some(label => Math.abs(label.y - edge.y - offset) < 12 && Math.abs(label.x - edge.x) < label.half + half)) ?? 0;
    const positioned = { ...edge, y: edge.y + offset };
    occupied.push({ x: edge.x, y: positioned.y, half });
    return positioned;
  });
  let laneX = MARGIN;
  const lanes = map.lanes.map((lane, i) => { const value = { label: lane.label, x: laneX, width: laneWidths[i]! - GAP }; laneX += laneWidths[i]!; return value; });
  return { width: contentWidth + MARGIN * 2 + (skipCount ? 24 + skipCount * 18 : 0), height: Math.max(220, header + layers.length * ROW), nodes, edges, lanes,
    neutral: isNeutralKind(source), bands: layers.map((layer, i) => ({ id: layer.id, name: layer.name, rank: source.layers.find(l => l.id === layer.id)!.rank, y: header + i * ROW, count: rows[i]!.length })) };
}
