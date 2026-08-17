import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './MmapView.module.css';
/**
 * Draw one computed layout as a layered SVG: lane headers, band rules with
 * names (and far-zoom member counts), status-skinned node boxes with their
 * unfolded detail lines and ⊞ submap badges, and downward orthogonal wires
 * routed with the terminal pane's preference — straight drops, packed track
 * runs, threaded descents — labels riding the primary run. The skins port the terminal
 * pane's border weights: the heavy square ┏━┓ of done/regressed becomes a
 * sharp 2px corner, the dashed rounded ╭╌╮ of planned stays soft.
 * The focused node's box and every wire touching it render bright. Pure
 * function of props — selection and hover live with the caller.
 */
export function MapSvg({ layout, scale, focus, selected, onHover, onSelect, onDive }) {
    return (_jsxs("svg", { className: css.map, viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width * scale, height: layout.height * scale, role: "img", onClick: () => { onSelect(null); }, children: [layout.lanes.map(lane => (_jsxs("g", { className: css.lane, children: [_jsx("text", { x: lane.x + lane.w / 2, y: 14, textAnchor: "middle", children: lane.label }), _jsx("line", { x1: lane.x + lane.w / 2, y1: 20, x2: lane.x + lane.w / 2, y2: layout.height })] }, `lane:${lane.x}`))), layout.bands.map(band => (_jsxs("g", { className: css.band, children: [_jsx("line", { x1: 0, y1: band.y, x2: layout.width, y2: band.y }), _jsx("text", { x: 8, y: band.y - 5, children: band.counts !== undefined ? `${band.name} ${band.counts}` : band.name })] }, `${band.name}:${band.y}`))), _jsx("defs", { children: _jsx("marker", { id: "mmap-arrow", viewBox: "0 0 8 8", refX: "6.5", refY: "4", markerWidth: "6.5", markerHeight: "6.5", orient: "auto-start-reverse", children: _jsx("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: "context-stroke", stroke: "none" }) }) }), layout.edges.map(edge => (_jsxs("g", { className: css.edge, "data-active": focus === edge.from || focus === edge.to ? 'true' : undefined, children: [_jsx("path", { d: edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' '), markerEnd: "url(#mmap-arrow)" }), edge.label !== undefined ? (_jsx("text", { x: edge.labelX, y: edge.labelY, children: edge.label })) : null] }, `${edge.from}->${edge.to}`))), layout.boxes.map(box => (_jsxs("g", { className: css.node, transform: `translate(${box.x} ${box.y})`, "data-status": layout.neutral ? 'neutral' : box.node.status, "data-selected": selected === box.node.id ? 'true' : undefined, "data-focused": focus === box.node.id ? 'true' : undefined, onPointerEnter: () => { onHover(box.node.id); }, onPointerLeave: () => { onHover(null); }, onClick: (event) => {
                    event.stopPropagation();
                    onSelect(box.node.id);
                }, onDoubleClick: (event) => {
                    event.stopPropagation();
                    onDive(box.node.id);
                }, children: [_jsx("rect", { x: 0, y: 0, width: box.w, height: box.h, rx: !layout.neutral && (box.node.status === 'done' || box.node.status === 'regressed') ? 0 : 6 }), box.lines.map((line, index) => (_jsx("text", { className: css.boxLine, "data-role": line.role, x: line.role === 'label' ? box.w / 2 : 10, y: 12 + index * 17 + (line.role === 'label' ? 3 : 2), textAnchor: line.role === 'label' ? 'middle' : 'start', children: line.text }, `${line.role}:${index}`))), box.node.submap !== undefined ? (_jsx("text", { className: css.submapBadge, x: box.w - 10, y: 13, children: "\u229E" })) : null] }, box.node.id)))] }));
}
//# sourceMappingURL=MapSvg.js.map