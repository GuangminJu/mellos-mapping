/** Live Mellos map column beside the conversation, plus its header toggle. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, type ClientContext, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the 'conversation.session.header.actions' SlotMap row.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the 'aux' SlotMap row and the ctx.layout face.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// The map Remote's generated client contribution and its namespace
// declaration. This plugin mounts its own Remote face (see apply) so the
// whole map surface stays out-of-tree installable: the host core needs no
// mmap entry in any of its assembly lists.
import mmapRemote from 'mellos-mapping-dsh/remote'
import { MapToggleAction, type MapToggleActionInjected } from './MapToggleAction.tsx'
import { MapDrawerAction, type MapDrawerActionInjected } from './MapDrawerAction.tsx'
import { MmapView, type MmapViewInjected } from './MmapView.tsx'
import { createMmapViewStore } from './store.ts'
import { en, zh, type MmapLocaleKey } from './locales.ts'

export type { MapToggleActionInjected, MapToggleActionProps } from './MapToggleAction.tsx'
export type { MapDrawerActionInjected, MapDrawerActionProps } from './MapDrawerAction.tsx'
export type { MmapViewInjected, MmapViewProps } from './MmapView.tsx'
export type { MmapLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mellos map view copy. */
    mmap: MmapLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'mmap'

/** Services required by the registrations, the layout face, and the Remote gateway. */
export const inject = ['slots', 'locale', 'layout', 'remote']

/** Poll cadence keeping closed hosts fresh; far above any read's real cost. */
const POLL_MS = 5000

/**
 * Contribute the side-by-side map column and its header toggle, and keep the
 * column live: one shared revision source bumps on every forwarded
 * `mmap/changed` and on connection reset (forwarded events carry no reconnect
 * replay, so a reset must force a fresh pull), and the mounted view re-reads
 * through the Remote seam when it moves. The view stays mounted while the
 * column is closed (width 0), which is what lets live mapping activity —
 * a page actually moving, never mere existence — auto-open the column.
 *
 * The plugin mounts its own `remote.mmap` face unless a host assembly already
 * did, and additionally polls at a slow cadence: a host whose forwarded-event
 * allowlist predates `mmap/changed` (any stock dsh today) never pushes the
 * event, and the poll keeps the map live there — an event-forwarding host
 * merely refreshes faster than the poll.
 * @param ctx - client root context.
 * @returns the Remote unmount when this plugin mounted the face itself.
 */
export async function apply(ctx: ClientContext): Promise<(() => Promise<void>) | undefined> {
  const unmount = ctx.remote.mmap === undefined ? await ctx.remote.$mount(mmapRemote) : undefined

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mmap: dictionaries')

  const revision = createSnapshotStore(0)
  const bump = (): void => { revision.set(revision.getSnapshot() + 1) }
  ctx.remote.$on('mmap/changed', bump)
  ctx.on('connection/reset', bump)
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') bump()
    }, POLL_MS)
    return () => { clearInterval(timer) }
  }, 'ui-mmap: freshness poll')

  // The mounted face is inject-guarded like any service: the registrations
  // live in a child scope declaring `remote.mmap`, so they tear down with the
  // face and cordis's access discipline stays intact.
  ctx.inject(['remote.mmap'], (scoped: ClientContext) => {
    const readFor = (sessionId: SessionId) => async () => {
      const result = await scoped.remote.mmap.read(sessionId)
      if (!result.ok) {
        throw new Error(`mmap.read failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    }

    // The web frame either carries the generic aux column or it does not
    // (stock dsh today): probe the layout face and pick the surface — the
    // side-by-side column, or a portal drawer owned by the header button.
    const layoutFace = scoped.layout as Partial<Record<'openAux' | 'toggleAux', () => void>>
    const auxAvailable = typeof layoutFace.openAux === 'function' && typeof layoutFace.toggleAux === 'function'

    if (auxAvailable) {
      scoped.slots.inject('aux', () => scoped.slots.register({
        name: 'aux',
        locale: NS,
        // Per-session viewpoint (page choice, follow, divider, parked views);
        // the framework keys one persisted instance per session (store.ts).
        store: createMmapViewStore,
        inject: (sessionId: SessionId): MmapViewInjected => ({
          hooks: { mmapRevision: revision },
          read: readFor(sessionId),
          autoOpen: () => { scoped.layout.openAux() },
        }),
      }, MmapView))

      scoped.slots.inject('conversation.session.header.actions', () => scoped.slots.register({
        name: 'conversation.session.header.actions',
        id: 'mmap-toggle',
        // After the job list: workspace state reads after process work.
        order: 30,
        locale: NS,
        inject: (): MapToggleActionInjected => ({
          toggle: () => { scoped.layout.toggleAux() },
        }),
      }, MapToggleAction))
    } else {
      scoped.slots.inject('conversation.session.header.actions', () => scoped.slots.register({
        name: 'conversation.session.header.actions',
        id: 'mmap-toggle',
        order: 30,
        locale: NS,
        // Same per-session viewpoint persistence as the aux column carries.
        store: createMmapViewStore,
        inject: (sessionId: SessionId): MapDrawerActionInjected => ({
          hooks: { mmapRevision: revision },
          read: readFor(sessionId),
        }),
      }, MapDrawerAction))
    }
  })

  return unmount === undefined ? undefined : async () => { await unmount() }
}
