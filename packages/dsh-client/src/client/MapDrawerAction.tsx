import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { MmapReadResult } from 'mellos-mapping-dsh/types'
import { MmapView, type MmapViewProps } from './MmapView.tsx'
import type { createMmapViewStore } from './store.ts'
import css from './MmapView.module.css'

/** Registration-side face of the drawer-hosted map (hosts without an aux column). */
export interface MapDrawerActionInjected {
  /** Read the whole map store of this session's workspace. */
  read: () => Promise<MmapReadResult>
  /** Reactive sources bound to `use<Name>` selector hooks by the renderer. */
  hooks: {
    /** Monotonic revision bumped on every `mmap/changed`, reset, and poll. */
    mmapRevision: ObservableSnapshot<number>
  }
}

/** Full props of the header action that owns the drawer. */
export type MapDrawerActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'mmap'>
  & InjectFace<MapDrawerActionInjected>
  & PropsStore<ReturnType<typeof createMmapViewStore>>

/**
 * The map surface for hosts whose web frame has no aux column: the same
 * header button, but toggling a right-edge drawer this component portals to
 * the document body. The drawer stays mounted while closed (slid offscreen),
 * mirroring the aux column's width-0 behavior, so live mapping activity can
 * auto-open it through the view's ordinary autoOpen callback.
 */
export function MapDrawerAction(props: MapDrawerActionProps): ReactNode {
  const { t } = props
  const [open, setOpen] = useState(false)
  const autoOpen = useCallback(() => { setOpen(true) }, [])
  return (
    <>
      <button
        type="button"
        className={css.toggle}
        data-open={open || undefined}
        onClick={() => { setOpen(value => !value) }}
        title={t('view.mmap')}
      >
        {t('view.mmap')}
      </button>
      {createPortal(
        <div className={css.drawer} data-open={open || undefined} role="complementary" aria-label={t('view.mmap')}>
          <button type="button" className={css.drawerClose} onClick={() => { setOpen(false) }} title={t('close')}>✕</button>
          {/* The view's props contract is slot-generic (locale, store, hooks,
              read); only the slot name differs, so the header-action seat
              satisfies it structurally. */}
          <MmapView {...(props as unknown as MmapViewProps)} autoOpen={autoOpen} />
        </div>,
        document.body,
      )}
    </>
  )
}
