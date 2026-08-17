import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './MmapView.module.css'

/** Registration-side face of the header toggle. */
export interface MapToggleActionInjected {
  /** Toggle the aux map column. */
  toggle: () => void
}

/** Full props for the session-header map toggle action. */
export type MapToggleActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'mmap'>
  & InjectFace<MapToggleActionInjected>

/** One header button toggling the side-by-side map column. */
export function MapToggleAction({ toggle, t }: MapToggleActionProps): ReactNode {
  return (
    <button type="button" className={css.toggle} onClick={toggle} title={t('view.mmap')}>
      {t('view.mmap')}
    </button>
  )
}
