import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { focusInfo, isNeutralKind } from 'mellos-mapping/semantics';
import css from './MmapView.module.css';
/** One neighbour chip: status-colored dot, label, and what flows on the edge. */
function NeighborChip({ neighbor }) {
    return (_jsxs("span", { className: css.chip, "data-status": neighbor.status, children: [neighbor.label, neighbor.edgeLabel !== undefined ? _jsxs("em", { children: ["(", neighbor.edgeLabel, ")"] }) : null] }));
}
/** A `word → chips` wire-direction row. */
function WireRow({ word, refs, t }) {
    return (_jsxs("p", { className: css.wireRow, children: [_jsx("span", { className: css.detailKey, children: word }), refs.length === 0 ? t('none') : refs.map(r => _jsx(NeighborChip, { neighbor: r }, r.id))] }));
}
/**
 * The resident three-state panel the terminal pane keeps below the map:
 * a focused node (status header, evidence, both wire directions, notes), a
 * focused group (members plus outside-the-group wires), or — with nothing
 * focused — the map dashboard. Never floats over the map.
 */
export function DetailPanel({ map, focus, pinned, t }) {
    const info = focus === null ? undefined : focusInfo(map, focus);
    const neutral = isNeutralKind(map);
    const [usesWord, usedByWord] = map.kind === 'sequence' ? [t('after'), t('before')] : [t('uses'), t('usedBy')];
    if (info === undefined) {
        const count = (status) => map.nodes.filter(n => n.status === status).length;
        const parts = [
            `${map.layers.length} ${t('unit.layers')}`,
            `${map.nodes.length} ${t('unit.nodes')}`,
            `${map.edges.length} ${t('unit.edges')}`,
            ...(map.lanes.length > 0 ? [`${map.lanes.length} ${t('unit.lanes')}`] : []),
        ];
        return (_jsxs("div", { className: css.panelBody, children: [_jsx("p", { className: css.panelTitle, children: map.title ?? 'mellos map' }), _jsx("p", { className: css.panelMeta, children: parts.join(' · ') }), neutral ? (_jsx("p", { className: css.panelMeta, children: map.kind })) : (_jsx("p", { className: css.statusCounts, children: ['done', 'in-progress', 'planned', 'regressed']
                        .filter(status => count(status) > 0)
                        .map(status => (_jsxs("span", { "data-status": status, children: [count(status), " ", t(`status.${status}`)] }, status))) })), _jsx("p", { className: css.panelHint, children: t('dashboardHint') })] }));
    }
    if (info.kind === 'group') {
        return (_jsxs("div", { className: css.panelBody, children: [_jsxs("p", { className: css.panelHeader, "data-status": info.status, children: [info.group.label, " ", _jsxs("code", { children: ["[", info.group.id, "]"] }), " \u00B7 ", info.layerName, " \u00B7 ", t(`status.${info.status}`), ' ', "\u00B7 ", info.members.length, " ", t('unit.members'), pinned ? _jsx("span", { className: css.pinMark, children: t('pinned') }) : null] }), _jsxs("p", { className: css.wireRow, children: [_jsx("span", { className: css.detailKey, children: t('members') }), info.members.map(member => (_jsx("span", { className: css.chip, "data-status": member.status, children: member.label }, member.id)))] }), _jsx(WireRow, { word: usesWord, refs: info.uses, t: t }), _jsx(WireRow, { word: usedByWord, refs: info.usedBy, t: t })] }));
    }
    const { node } = info;
    const headParts = [
        info.layerName,
        ...(info.laneLabel !== undefined ? [info.laneLabel] : []),
        ...(node.kind !== undefined ? [node.kind] : []),
        ...(neutral ? [] : [t(`status.${node.status}`)]),
        ...(node.submap !== undefined ? [`⊞ ${node.submap}`] : []),
    ];
    return (_jsxs("div", { className: css.panelBody, children: [_jsxs("p", { className: css.panelHeader, "data-status": neutral ? 'neutral' : node.status, children: [node.label, " ", _jsxs("code", { children: ["[", node.id, "]"] }), " \u00B7 ", headParts.join(' · '), pinned ? _jsx("span", { className: css.pinMark, children: t('pinned') }) : null] }), neutral ? null : (_jsx("p", { className: css.panelMeta, children: node.evidence !== undefined ? `${t('evidence')}: ${node.evidence}` : t('noEvidence') })), _jsx(WireRow, { word: usesWord, refs: info.uses, t: t }), _jsx(WireRow, { word: usedByWord, refs: info.usedBy, t: t }), _jsx("p", { className: css.panelNotes, children: node.detail ?? t('noNotes') })] }));
}
//# sourceMappingURL=DetailPanel.js.map