/**
 * Pure geometry over a Mellos map value at one zoom step: bands stacked
 * top-down by descending rank (primitives at the bottom, matching the
 * terminal pane), boxes packed left-to-right per band — under lane columns
 * when the map declares lanes — and downward edges between box centers.
 *
 * Medium semantics (zoom-step meaning, far-zoom aggregation, sequence
 * orientation, neutral kinds) come from the mellos-mapping semantics library
 * so this view and the terminal pane can never disagree on what a map MEANS.
 * What zoom LOOKS like is owned here, in the medium's own strength: the view
 * scales geometry CONTINUOUSLY (SVG scales for free where a terminal must
 * compress whitespace) and this module maps the scale to a content step by
 * thresholds — the detail steps unfold evidence and notes inside
 * the boxes, and the overview step renders the aggregated map. A map without
 * groups has no aggregate and simply stays itself at the far step — the
 * terminal's glyph constellation is a character-grid necessity, not a
 * semantic obligation.
 */
import type { MapNode, MellosMap } from 'mellos-mapping/domain/types';
import { type ZoomStep } from 'mellos-mapping/semantics';
/** Continuous display-scale range; the view multiplies geometry by it. */
export declare const SCALE_MIN = 0.4;
export declare const SCALE_MAX = 2.4;
export declare const SCALE_DEFAULT = 1;
/**
 * Fold a value into the scale range. Non-finite input (a viewpoint persisted
 * by an older build carried ladder steps in this seat) lands on the default.
 * @param value - candidate scale.
 * @returns a usable scale inside the contract range.
 */
export declare function clampScale(value: number): number;
/**
 * The semantic step a continuous scale renders with: a magnified picture
 * unfolds detail inside the boxes, a small one carries counts on the band
 * bars, and the far end aggregates groups. Thresholds instead of discrete
 * stops — the wheel zooms geometrically and the content follows. With the
 * current step supplied, boundaries act as a Schmitt trigger: hovering at a
 * threshold cannot flap the layout open and shut on wheel jitter.
 * @param scale - continuous display scale.
 * @param current - step currently rendered, engages hysteresis when given.
 * @returns the content step to lay out with.
 */
export declare function stepForScale(scale: number, current?: ZoomStep): ZoomStep;
/** One text line inside a node box. */
export interface BoxLine {
    readonly text: string;
    readonly role: 'label' | 'evidence' | 'note';
}
/** One positioned node box with its unfolded content. */
export interface NodeBox {
    readonly node: MapNode;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly lines: readonly BoxLine[];
}
/** One band separator: the rule the band's name sits on. */
export interface BandRule {
    readonly name: string;
    readonly y: number;
    /** Members done/total, present when the step carries counts on the bars. */
    readonly counts?: string;
}
/** One lane column header. */
export interface LaneHeader {
    readonly label: string;
    readonly x: number;
    readonly w: number;
}
/** One routed edge with optional label, from the using box down into the used box. */
export interface EdgeLine {
    readonly from: string;
    readonly to: string;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    /** Y of the primary horizontal run (the packed track row below the source
     * box); a STRAIGHT edge has no run and carries its own midpoint here. */
    readonly midY: number;
    /** Full orthogonal polyline from the source seat to the target seat, the
     *  terminal renderer's routing preference: a STRAIGHT edge (adjacent bands,
     *  boxes vertically aligned) is one vertical line — two points; a dogleg
     *  drops onto a packed track row and re-drops — four points; a multi-band
     *  edge drops into the source gap, descends a THREAD column that passes
     *  between the intermediate bands' boxes (right-margin fallback only when
     *  no such corridor exists), and enters via the target gap — six points.
     *  No segment ever passes behind a box. */
    readonly points: ReadonlyArray<readonly [number, number]>;
    readonly label: string | undefined;
    /** Label baseline, over the primary horizontal run (always inside a gap). */
    readonly labelX: number;
    readonly labelY: number;
}
/** The whole computed picture. */
export interface MapLayout {
    readonly width: number;
    readonly height: number;
    readonly bands: readonly BandRule[];
    readonly boxes: readonly NodeBox[];
    readonly edges: readonly EdgeLine[];
    readonly lanes: readonly LaneHeader[];
    /** Documentation kinds render neutrally: no status skins or spinners. */
    readonly neutral: boolean;
    /** The far step drew the aggregated map: boxes are groups, not nodes. */
    readonly aggregated: boolean;
}
/**
 * Approximate rendered width of a label at the view's base font: CJK glyphs
 * occupy roughly double an ASCII glyph. An estimate is enough — boxes carry
 * padding, and exact text measurement would drag DOM layout into a pure
 * function.
 * @param text - label text.
 * @returns estimated pixel width.
 */
export declare function estimateTextWidth(text: string): number;
/** Hard word-wrap by character budget (CJK counts double), for in-box notes. */
export declare function wrapChars(text: string, budget: number): string[];
/**
 * Compute the full layered picture for one map value at one zoom step.
 * @param map - a validated Mellos map value.
 * @param zoom - position on the semantic zoom ladder.
 * @returns positioned bands, lanes, boxes, and edges with the content extent.
 */
export declare function computeLayout(map: MellosMap, zoom?: ZoomStep): MapLayout;
//# sourceMappingURL=layout.d.ts.map