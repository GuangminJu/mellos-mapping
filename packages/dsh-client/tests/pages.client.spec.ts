import { describe, expect, it } from 'vitest'
import type { MmapReadResult } from 'mellos-mapping-dsh/types'
import {
  DEFAULT_PAGE_KEY, breadcrumbOf, changedKeys, markViewed, mergePages, pageTabs, resolveActiveKey, topLevelKeys,
  type PageEntry,
} from 'mellos-mapping-dsh-client/src/client/pages.ts'

function mapValue(title: string, extra?: { submap?: string; status?: string }): unknown {
  return {
    title,
    layers: [{ id: 'base', name: 'b', rank: 0 }],
    groups: [],
    lanes: [],
    nodes: [{
      id: 'n', label: 'N', layer: 'base', status: extra?.status ?? 'planned',
      ...(extra?.submap !== undefined ? { submap: extra.submap } : {}),
    }],
    edges: [],
  }
}

function result(pages: Array<{ page: string | null; map?: unknown; error?: string; mtimeMs?: number }>): MmapReadResult {
  return {
    cwd: 'C:/work',
    pages: pages.map(p => ({
      page: p.page,
      map: (p.map ?? null) as MmapReadResult['pages'][number]['map'],
      error: p.error ?? null,
      mtimeMs: p.mtimeMs ?? null,
    })),
  }
}

describe('mergePages', () => {
  it('marks nothing fresh on the first read — existing state is not news', () => {
    const pages = mergePages([], result([
      { page: null, map: mapValue('main'), mtimeMs: 10 },
      { page: 'side', map: mapValue('side'), mtimeMs: 20 },
    ]), DEFAULT_PAGE_KEY)
    expect(pages.map(p => p.fresh)).toEqual([false, false])
  })

  it('lights a background page that moved and keeps the active page dark', () => {
    const first = mergePages([], result([
      { page: null, map: mapValue('main'), mtimeMs: 10 },
      { page: 'side', map: mapValue('side'), mtimeMs: 20 },
    ]), DEFAULT_PAGE_KEY)
    const second = mergePages(first, result([
      { page: null, map: mapValue('main2'), mtimeMs: 11 },
      { page: 'side', map: mapValue('side2'), mtimeMs: 21 },
    ]), DEFAULT_PAGE_KEY)
    expect(second.find(p => p.key === DEFAULT_PAGE_KEY)?.fresh).toBe(false)
    expect(second.find(p => p.key === 'side')?.fresh).toBe(true)
    expect(markViewed(second, 'side').find(p => p.key === 'side')?.fresh).toBe(false)
  })

  it('reports moved pages as auto-follow candidates, never on the first read', () => {
    const first = mergePages([], result([
      { page: null, map: mapValue('main'), mtimeMs: 10 },
      { page: 'side', map: mapValue('side'), mtimeMs: 20 },
    ]), undefined)
    expect(changedKeys([], first)).toEqual([])
    const second = mergePages(first, result([
      { page: null, map: mapValue('main'), mtimeMs: 10 },
      { page: 'side', map: mapValue('side2'), mtimeMs: 21 },
      { page: 'born', map: mapValue('born'), mtimeMs: 30 },
    ]), DEFAULT_PAGE_KEY)
    expect(changedKeys(first, second)).toEqual(['side', 'born'])
    expect(changedKeys(second, second)).toEqual([])
  })

  it('keeps the last good map through a torn read, error still reported', () => {
    const first = mergePages([], result([{ page: null, map: mapValue('good'), mtimeMs: 10 }]), undefined)
    const second = mergePages(first, result([{ page: null, error: 'not valid JSON', mtimeMs: 11 }]), DEFAULT_PAGE_KEY)
    expect(second[0]?.map).toMatchObject({ title: 'good' })
    expect(second[0]?.error).toBe('not valid JSON')
  })
})

describe('page-set selection', () => {
  const held: PageEntry[] = mergePages([], result([
    { page: null, map: mapValue('main', { submap: 'inner' }), mtimeMs: 10 },
    { page: 'inner', map: mapValue('inner detail'), mtimeMs: 99 },
    { page: 'other', map: mapValue('other', { status: 'done' }), mtimeMs: 50 },
  ]), undefined)

  it('a submap page takes no sibling tab; the default page never hides', () => {
    expect(topLevelKeys(held)).toEqual([DEFAULT_PAGE_KEY, 'other'])
    expect(pageTabs(held, 'other').map(t => [t.key, t.active, t.status])).toEqual([
      [DEFAULT_PAGE_KEY, false, 'planned'],
      ['other', true, 'done'],
    ])
  })

  it('defaults to the most recently written top-level page, keeps a live choice', () => {
    // inner is newest but interior; other (50) beats main (10).
    expect(resolveActiveKey(held, undefined)).toBe('other')
    expect(resolveActiveKey(held, DEFAULT_PAGE_KEY)).toBe(DEFAULT_PAGE_KEY)
    expect(resolveActiveKey(held, 'gone')).toBe('other')
  })

  it('derives the breadcrumb of a dived page by scan', () => {
    expect(breadcrumbOf(held, 'inner')).toEqual({ parentKey: DEFAULT_PAGE_KEY, parentTitle: 'main', label: 'N' })
    expect(breadcrumbOf(held, 'other')).toBeUndefined()
  })
})
