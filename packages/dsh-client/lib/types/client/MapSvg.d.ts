import type { ReactNode } from 'react';
import type { MapLayout } from './layout.ts';
/** Owner props of the pure SVG map picture. */
export interface MapSvgProps {
    /** Computed picture for the active map at the current content step. */
    readonly layout: MapLayout;
    /** Continuous display scale the geometry is multiplied by. */
    readonly scale: number;
    /** Spotlit node id (hover wins over the pinned selection), if any. */
    readonly focus: string | null;
    /** Pinned node id, ring-marked. */
    readonly selected: string | null;
    /** Pointer entered / left a node. */
    readonly onHover: (id: string | null) => void;
    /** Select or unselect (null on empty-space click) a node. */
    readonly onSelect: (id: string | null) => void;
    /** Double-click on a node (dives into its submap when it links one). */
    readonly onDive: (id: string) => void;
}
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
export declare function MapSvg({ layout, scale, focus, selected, onHover, onSelect, onDive }: MapSvgProps): ReactNode;
//# sourceMappingURL=MapSvg.d.ts.map