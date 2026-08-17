/**
 * Pure page-set view model over mmap read results: keep-last-good page
 * merging, background-change (fresh) marking, sibling-tab selection, the
 * most-recently-written default, and breadcrumb derivation. Page-set RULES
 * (a submap page takes no tab, a dive origin is derivable by scan, the
 * default page is the last one written) come from the mellos-mapping
 * semantics library; this module binds them to the wire's page keys.
 */

import type { MmapReadResult } from 'mellos-mapping-dsh/types'
import type { MellosMap, NodeStatus } from 'mellos-mapping/domain/types'
import { mapStatus } from 'mellos-mapping/domain/ops'
import { diveParent, isNeutralKind, mostRecentKey, submapRefs } from 'mellos-mapping/semantics'

/** The default page's client-side key (its wire form is `page: null`). */
export const DEFAULT_PAGE_KEY = ''

/** One page as the view holds it across reads. */
export interface PageEntry {
  /** Page slug; {@link DEFAULT_PAGE_KEY} for the default page. */
  readonly key: string
  /** Last good map value; survives a torn read so the picture never blanks. */
  readonly map: MellosMap | undefined
  /** Load failure of the CURRENT read, `null` when it parsed. */
  readonly error: string | null
  readonly mtimeMs: number | null
  /** Changed while it was not the active page — its tab lights up. */
  readonly fresh: boolean
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
export function mergePages(
  prev: readonly PageEntry[],
  result: MmapReadResult,
  activeKey: string | undefined,
): PageEntry[] {
  const first = prev.length === 0
  return result.pages.map((page) => {
    const key = page.page ?? DEFAULT_PAGE_KEY
    const old = prev.find(entry => entry.key === key)
    const map = page.map != null ? (page.map as unknown as MellosMap) : old?.map
    const moved = old !== undefined && page.mtimeMs !== old.mtimeMs
    const fresh = !first && key !== activeKey && ((old?.fresh ?? false) || moved || old === undefined)
    return { key, map, error: page.error, mtimeMs: page.mtimeMs, fresh }
  })
}

/** Mark one page viewed: its fresh light goes out. */
export function markViewed(pages: readonly PageEntry[], key: string): PageEntry[] {
  return pages.map(page => (page.key === key && page.fresh ? { ...page, fresh: false } : page))
}

/**
 * Keys whose files moved between two held sets — auto-follow's candidates.
 * The first read reports nothing: existing state is not news to follow.
 * @param prev - pages as held before the read (empty on the first).
 * @param next - pages as held after the read.
 * @returns changed keys in store order.
 */
export function changedKeys(prev: readonly PageEntry[], next: readonly PageEntry[]): string[] {
  if (prev.length === 0) return []
  return next
    .filter((page) => {
      const old = prev.find(entry => entry.key === page.key)
      return old === undefined || old.mtimeMs !== page.mtimeMs
    })
    .map(page => page.key)
}

/**
 * Keys that deserve a sibling tab: pages NO node of any page dives into.
 * The default page is never hidden.
 * @param pages - the held page set.
 * @returns top-level keys in store order.
 */
export function topLevelKeys(pages: readonly PageEntry[]): string[] {
  const refs = submapRefs(pages.map(page => page.map))
  return pages.filter(page => page.key === DEFAULT_PAGE_KEY || !refs.has(page.key)).map(page => page.key)
}

/**
 * The page to show: the current choice while it still exists, else the most
 * recently written top-level page (the effort under way), else the first.
 * @param pages - the held page set.
 * @param currentKey - the page currently chosen, if any.
 * @returns the resolved active key, or undefined for an empty store.
 */
export function resolveActiveKey(pages: readonly PageEntry[], currentKey: string | undefined): string | undefined {
  if (currentKey !== undefined && pages.some(page => page.key === currentKey)) return currentKey
  const top = topLevelKeys(pages)
  return mostRecentKey(top, key => pages.find(page => page.key === key)?.mtimeMs ?? undefined)
}

/** One sibling tab's view model. */
export interface PageTabView {
  readonly key: string
  /** The map's own title; the component supplies the default-page fallback. */
  readonly title: string | undefined
  readonly status: NodeStatus
  readonly active: boolean
  readonly fresh: boolean
  readonly neutral: boolean
}

/**
 * Sibling tabs over the top-level pages, in store order.
 * @param pages - the held page set.
 * @param activeKey - the page on screen.
 * @returns tab view models.
 */
export function pageTabs(pages: readonly PageEntry[], activeKey: string | undefined): PageTabView[] {
  const refs = submapRefs(pages.map(page => page.map))
  return pages
    .filter(entry => entry.key === DEFAULT_PAGE_KEY || !refs.has(entry.key))
    .map(entry => ({
      key: entry.key,
      title: entry.map?.title,
      status: entry.map !== undefined ? mapStatus(entry.map) : 'planned',
      active: entry.key === activeKey,
      fresh: entry.fresh,
      neutral: entry.map !== undefined && isNeutralKind(entry.map),
    }))
}

/**
 * The breadcrumb of a dived-into page: the linking parent and node label,
 * derived by scan so it survives any remount with an empty dive stack.
 * @param pages - the held page set.
 * @param activeKey - the page on screen.
 * @returns the origin, or undefined while a top-level page is active.
 */
export function breadcrumbOf(
  pages: readonly PageEntry[],
  activeKey: string,
): { parentKey: string; parentTitle: string | undefined; label: string } | undefined {
  if (topLevelKeys(pages).includes(activeKey)) return undefined
  const entries = pages.filter(page => page.key !== activeKey).map(page => [page.key, page.map] as const)
  const origin = diveParent(entries, activeKey)
  if (origin === undefined) return undefined
  return {
    parentKey: origin.parent,
    parentTitle: pages.find(page => page.key === origin.parent)?.map?.title,
    label: origin.label,
  }
}
