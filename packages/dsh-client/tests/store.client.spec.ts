// @vitest-environment jsdom
/**
 * Per-session viewpoint store spec: init shape, the write set (clamp inside
 * setPanelH), and per-session persistence isolation — the scope key suffixes
 * the storage key, so two conversations' viewpoints never cross-pollute and
 * a re-created instance (conversation re-entered, page reloaded) rehydrates.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createMmapViewStore, PANEL_DEFAULT_H } from 'mellos-mapping-dsh-client/src/client/store.ts'

beforeEach(() => { localStorage.clear() })

describe('createMmapViewStore', () => {
  it('initializes with no page choice, follow armed, and the default panel height', () => {
    const { store } = createMmapViewStore().create('s1')
    expect(store.getSnapshot()).toEqual({ chosenKey: undefined, follow: true, panelH: PANEL_DEFAULT_H, views: {} })
  })

  it('clamps the divider height inside the drag range', () => {
    const { store, actions } = createMmapViewStore().create('s1')
    actions.setPanelH(10)
    expect(store.getSnapshot().panelH).toBe(64)
    actions.setPanelH(9999)
    expect(store.getSnapshot().panelH).toBe(480)
  })

  it('parks and overwrites per-page views by key', () => {
    const { store, actions } = createMmapViewStore().create('s1')
    actions.parkView('p', { scale: 1.3, selected: 'n', scrollX: 3, scrollY: 4 })
    actions.parkView('p', { scale: 0.7, selected: null, scrollX: 0, scrollY: 0 })
    expect(store.getSnapshot().views['p']).toEqual({ scale: 0.7, selected: null, scrollX: 0, scrollY: 0 })
  })

  it('persists per session: two conversations hold independent viewpoints', () => {
    const one = createMmapViewStore().create('s1')
    one.actions.choosePage('effort-x')
    one.actions.setFollow(false)
    const two = createMmapViewStore().create('s2')
    expect(two.store.getSnapshot()).toMatchObject({ chosenKey: undefined, follow: true })

    // Re-entering conversation s1 (a fresh instance) restores ITS viewpoint.
    const again = createMmapViewStore().create('s1')
    expect(again.store.getSnapshot()).toMatchObject({ chosenKey: 'effort-x', follow: false })
    expect(localStorage.getItem('dsh.mmap.view.s1')).not.toBeNull()
    expect(localStorage.getItem('dsh.mmap.view.s2')).toBeNull()
  })
})
