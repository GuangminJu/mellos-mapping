/**
 * Pure page-set view model over mmap read results: keep-last-good page
 * merging, background-change (fresh) marking, sibling-tab selection, the
 * most-recently-written default, and breadcrumb derivation. Page-set RULES
 * (a submap page takes no tab, a dive origin is derivable by scan, the
 * default page is the last one written) come from the mellos-mapping
 * semantics library; this module binds them to the wire's page keys.
 */
import type { MmapReadResult } from 'mellos-mapping-dsh/types';
import type { MellosMap, NodeStatus } from 'mellos-mapping/domain/types';
/** The default page's client-side key (its wire form is `page: null`). */
export declare const DEFAULT_PAGE_KEY = "";
/** One page as the view holds it across reads. */
export interface PageEntry {
    /** Page slug; {@link DEFAULT_PAGE_KEY} for the default page. */
    readonly key: string;
    /** Last good map value; survives a torn read so the picture never blanks. */
    readonly map: MellosMap | undefined;
    /** Load failure of the CURRENT read, `null` when it parsed. */
    readonly error: string | null;
    readonly mtimeMs: number | null;
    /** Changed while it was not the active page — its tab lights up. */
    readonly fresh: boolean;
}
/**
 * Fold one read result into the held page set: a page that fails to parse
 * keeps its last good map (`error` still reported), and a background page
 * whose file moved becomes fresh until viewed. The startup read marks
 * nothing fresh — existing state is not news.
 * @param prev - pages as currently held (empty on the first read).
 * @param result - the incoming whole-store read.
 * @param activeKey - the page currently on screen (never marked fresh).
 * @returns the next held page set, in store order.
 */
export declare function mergePages(prev: readonly PageEntry[], result: MmapReadResult, activeKey: string | undefined): PageEntry[];
/** Mark one page viewed: its fresh light goes out. */
export declare function markViewed(pages: readonly PageEntry[], key: string): PageEntry[];
/**
 * Keys whose files moved between two held sets — auto-follow's candidates.
 * The first read reports nothing: existing state is not news to follow.
 * @param prev - pages as held before the read (empty on the first).
 * @param next - pages as held after the read.
 * @returns changed keys in store order.
 */
export declare function changedKeys(prev: readonly PageEntry[], next: readonly PageEntry[]): string[];
/**
 * Keys that deserve a sibling tab: pages NO node of any page dives into.
 * The default page is never hidden.
 * @param pages - the held page set.
 * @returns top-level keys in store order.
 */
export declare function topLevelKeys(pages: readonly PageEntry[]): string[];
/**
 * The page to show: the current choice while it still exists, else the most
 * recently written top-level page (the effort under way), else the first.
 * @param pages - the held page set.
 * @param currentKey - the page currently chosen, if any.
 * @returns the resolved active key, or undefined for an empty store.
 */
export declare function resolveActiveKey(pages: readonly PageEntry[], currentKey: string | undefined): string | undefined;
/** One sibling tab's view model. */
export interface PageTabView {
    readonly key: string;
    /** The map's own title; the component supplies the default-page fallback. */
    readonly title: string | undefined;
    readonly status: NodeStatus;
    readonly active: boolean;
    readonly fresh: boolean;
    readonly neutral: boolean;
}
/**
 * Sibling tabs over the top-level pages, in store order.
 * @param pages - the held page set.
 * @param activeKey - the page on screen.
 * @returns tab view models.
 */
export declare function pageTabs(pages: readonly PageEntry[], activeKey: string | undefined): PageTabView[];
/**
 * The breadcrumb of a dived-into page: the linking parent and node label,
 * derived by scan so it survives any remount with an empty dive stack.
 * @param pages - the held page set.
 * @param activeKey - the page on screen.
 * @returns the origin, or undefined while a top-level page is active.
 */
export declare function breadcrumbOf(pages: readonly PageEntry[], activeKey: string): {
    parentKey: string;
    parentTitle: string | undefined;
    label: string;
} | undefined;
//# sourceMappingURL=pages.d.ts.map