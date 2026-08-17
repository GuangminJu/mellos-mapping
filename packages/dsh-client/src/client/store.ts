/**
 * Per-conversation map viewpoint. The workspace's map STORE is shared by
 * every conversation in that workspace — what belongs to one conversation is
 * its point of view: which page it looks at, whether it follows the writer,
 * its divider height, and each page's parked zoom/pin/scroll. The aux slot
 * is session-scoped, so the framework keeps one instance per session and
 * suffixes the persist key with the session id — switching back to a
 * conversation (or reloading) restores ITS viewpoint, which is what keeps
 * conversations from all rendering one identical picture.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Divider-drag range of the resident detail panel, px. */
export const PANEL_DEFAULT_H = 168
const PANEL_MIN_H = 64
const PANEL_MAX_H = 480

/** Parked view of one page while another is active (or the session parked). */
export interface PageView {
  /** Continuous display scale (clampScale folds legacy ladder steps in). */
  scale: number
  selected: string | null
  scrollX: number
  scrollY: number
}

/** One conversation's map viewpoint. */
interface MmapViewState {
  /** Standing page choice; undefined until the first resolution adopts one. */
  chosenKey: string | undefined
  /** Auto-follow armed: the view tracks the page last written. */
  follow: boolean
  /** Resident detail panel height, px. */
  panelH: number
  /** Parked per-page views, by page key. */
  views: Record<string, PageView>
}

/** Annotation twin of the actions literal (the export needs a declared return type). */
type MmapViewActions = {
  choosePage: (draft: MmapViewState, key: string) => void
  setFollow: (draft: MmapViewState, on: boolean) => void
  setPanelH: (draft: MmapViewState, px: number) => void
  parkView: (draft: MmapViewState, key: string, view: PageView) => void
}

/**
 * Create the per-session viewpoint store handle.
 * @returns the store handle; the framework instantiates one per session.
 */
export function createMmapViewStore(): EngineStoreHandle<MmapViewState, MmapViewActions> {
  return defineStore({
    init: (): MmapViewState => ({ chosenKey: undefined, follow: true, panelH: PANEL_DEFAULT_H, views: {} }),
    persist: 'dsh.mmap.view',
    actions: {
      choosePage: (d, key: string) => { d.chosenKey = key },
      setFollow: (d, on: boolean) => { d.follow = on },
      setPanelH: (d, px: number) => { d.panelH = Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, px)) },
      parkView: (d, key: string, view: PageView) => { d.views[key] = view },
    },
  })
}
