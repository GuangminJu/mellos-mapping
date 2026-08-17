import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MmapReadResult } from 'mellos-mapping-dsh/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { mostRecentKey, zoomLabel } from 'mellos-mapping/semantics'
import { SCALE_DEFAULT, clampScale, computeLayout, stepForScale, type MapLayout } from './layout.ts'
import { wheelScaleFactor } from './wheel.ts'
import { createMmapViewStore } from './store.ts'
import {
  DEFAULT_PAGE_KEY, breadcrumbOf, changedKeys, markViewed, mergePages, pageTabs, resolveActiveKey, topLevelKeys,
  type PageEntry,
} from './pages.ts'
import { DetailPanel } from './DetailPanel.tsx'
import { MapSvg } from './MapSvg.tsx'
import css from './MmapView.module.css'

/** Registration-side face: the per-session read plus the change-revision hook source. */
export interface MmapViewInjected {
  /** Read the whole map store of this session's workspace. */
  read: () => Promise<MmapReadResult>
  /** Open the aux column (no-op when open); called once when a map page first MOVES during this mount. */
  autoOpen: () => void
  /** Reactive sources bound to `use<Name>` selector hooks by the renderer. */
  hooks: {
    /** Monotonic revision bumped on every `mmap/changed` and connection reset. */
    mmapRevision: ObservableSnapshot<number>
  }
}

/** Full component props assembled by the aux column slot renderer. */
export type MmapViewProps =
  PropsRuntime<'aux'>
  & PropsLocale<'mmap'>
  & InjectFace<MmapViewInjected>
  & PropsStore<ReturnType<typeof createMmapViewStore>>

type FetchState = 'loading' | 'error' | 'ready'

/** Keyboard zoom ratio per +/- press. */
const KEY_ZOOM = 1.25

/** Render the live Mellos map of this session's workspace. */
export function MmapView(props: MmapViewProps): ReactNode {
  const { read, autoOpen, t, useStore, actions } = props
  const revision = props.useMmapRevision(value => value)
  const [fetchState, setFetchState] = useState<FetchState>('loading')
  const [pages, setPages] = useState<readonly PageEntry[]>([])
  const [retries, setRetries] = useState(0)
  const [scale, setScale] = useState(SCALE_DEFAULT)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // The conversation's own viewpoint (store.ts): page choice, auto-follow
  // armedness, divider height, and parked per-page views all persist per
  // session — switching back to this conversation restores how IT looked at
  // the shared workspace store.
  const chosenKey = useStore(s => s.chosenKey)
  const follow = useStore(s => s.follow)
  const panelH = useStore(s => s.panelH)
  const views = useStore(s => s.views)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef<readonly PageEntry[]>([])
  // Mirrors for the fetch closure: reading live state there must not re-arm
  // the read effect itself.
  const followRef = useRef(follow)
  followRef.current = follow
  const viewsRef = useRef(views)
  viewsRef.current = views
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const diveStackRef = useRef<string[]>([])
  const activeKeyRef = useRef<string | undefined>(undefined)
  const chosenRef = useRef<string | undefined>(undefined)
  chosenRef.current = chosenKey
  const openedRef = useRef(false)
  /** Last ok read found a resolved workspace with zero pages (a true empty store). */
  const emptyStoreRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null)
  const swallowClickRef = useRef(false)
  const zoomAnchorRef = useRef<{
    id: string | undefined
    /** The anchor's cross-boundary stand-in: a node's group, a group's member. */
    kinId: string | undefined
    screenX: number
    screenY: number
    cx: number
    cy: number
  } | null>(null)

  const activeKey = resolveActiveKey(pages, chosenKey)
  activeKeyRef.current = activeKey
  const active = pages.find(page => page.key === activeKey)
  const activeMap = active?.map
  // Schmitt-triggered content step: the previous render's step engages the
  // hysteresis band, so wheel jitter at a threshold cannot flap the layout.
  const stepRef = useRef(stepForScale(scale))
  const step = stepForScale(scale, stepRef.current)
  stepRef.current = step
  const layout: MapLayout | undefined = useMemo(
    () => (activeMap === undefined ? undefined : computeLayout(activeMap, step)),
    [activeMap, step],
  )
  const focus = hover ?? selected
  const tabs = useMemo(() => pageTabs(pages, activeKey), [activeKey, pages])
  const crumb = activeKey === undefined ? undefined : breadcrumbOf(pages, activeKey)

  // -- data cycle: read on every revision bump; keep-last-good per page.
  // Change events are the primary trigger, but they cannot be the only one:
  // a read that raced the Host's own startup (transport not ready, session
  // store still empty) would otherwise stick forever. An unusable answer —
  // failure, no workspace, or an empty store — retries on its own with
  // backoff, and a usable one resets the ladder.
  const failsRef = useRef(0)
  useEffect(() => {
    let current = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleRetry = (): void => {
      failsRef.current += 1
      const delay = Math.min(10_000, 1000 * 2 ** (failsRef.current - 1))
      retryTimer = setTimeout(() => { setRetries(value => value + 1) }, delay)
    }
    void Promise.resolve().then(() => read()).then(
      (result) => {
        if (!current) return
        setFetchState('ready')
        const prev = pagesRef.current
        const next = mergePages(prev, result, activeKeyRef.current)
        pagesRef.current = next
        setPages(next)
        // A hidden sub-map has no tab to light: surface its change here.
        const top = new Set(topLevelKeys(next))
        const hidden = next.find(page => page.fresh && !top.has(page.key)
          && !(prev.find(old => old.key === page.key)?.fresh ?? false))
        if (hidden !== undefined) {
          setFlash(`⊞ ${hidden.map?.title ?? hidden.key}`)
        }
        // Auto-follow: switch to the page last WRITTEN among this read's
        // changes (several → most recent wins). A drag in progress skips the
        // jump — the writer's next save re-triggers it anyway.
        const changed = changedKeys(prev, next)
        // The column auto-opens on ACTIVITY, never on existence: the map
        // store belongs to the workspace, so every conversation there reads
        // the same maps — a panel that popped in all of them just because a
        // map exists would sever the tie between a conversation and the
        // mapping happening in it. A workspace's FIRST map is activity too:
        // a read that follows a resolved-but-empty store carries pages the
        // first-read rule of changedKeys cannot see. Once per mount: a user
        // who closed the column mid-session has answered, and stays closed.
        const born = emptyStoreRef.current && next.length > 0
        if ((changed.length > 0 || born) && !openedRef.current) {
          openedRef.current = true
          autoOpen()
        }
        emptyStoreRef.current = result.cwd !== null && result.pages.length === 0
        if (followRef.current && changed.length > 0 && dragRef.current === null) {
          const target = mostRecentKey(changed, key => next.find(page => page.key === key)?.mtimeMs ?? undefined)
          if (target !== undefined && target !== activeKeyRef.current) switchPageRef.current(target)
        }
        // Pin the passive default. With no standing choice (first resolution,
        // or the chosen page's file vanished) the resolver re-defaults to the
        // most recently written page on EVERY read — a background write would
        // yank the view with follow off, and the yanked-to page would keep
        // its fresh star forever (the active tab's click is a no-op, so
        // markViewed never runs). Adopting the resolution as the choice makes
        // follow the only mover, and viewing puts the light out like any
        // deliberate switch.
        const resolved = resolveActiveKey(pagesRef.current, chosenRef.current)
        if (resolved !== undefined && resolved !== chosenRef.current) {
          chosenRef.current = resolved
          actions.choosePage(resolved)
          pagesRef.current = markViewed(pagesRef.current, resolved)
          setPages(pagesRef.current)
        }
        if (result.cwd === null || result.pages.length === 0) {
          scheduleRetry()
        } else {
          failsRef.current = 0
        }
      },
      (error: unknown) => {
        if (!current) return
        // The panel shows a generic retry line; the cause goes to the console
        // so a failing host round-trip stays diagnosable in the field.
        console.warn('mmap: read failed', error)
        setFetchState('error')
        scheduleRetry()
      },
    )
    return () => {
      current = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [actions, autoOpen, read, revision, retries, props.sessionId])

  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => { setFlash(null) }, 4000)
    return () => { clearTimeout(timer) }
  }, [flash])

  // -- page switching: park the current view, restore the target's ----------
  const switchPage = useCallback((key: string) => {
    const el = scrollRef.current
    const from = activeKeyRef.current
    if (from !== undefined) {
      actions.parkView(from, {
        scale, selected, scrollX: el?.scrollLeft ?? 0, scrollY: el?.scrollTop ?? 0,
      })
    }
    const view = viewsRef.current[key]
    chosenRef.current = key
    actions.choosePage(key)
    setScale(view === undefined ? SCALE_DEFAULT : clampScale(view.scale))
    setSelected(view?.selected ?? null)
    setHover(null)
    pagesRef.current = markViewed(pagesRef.current, key)
    setPages(pagesRef.current)
    requestAnimationFrame(() => {
      const target = scrollRef.current
      if (target !== null) {
        target.scrollLeft = view?.scrollX ?? 0
        target.scrollTop = view?.scrollY ?? 0
      }
    })
  }, [actions, selected, scale])
  const switchPageRef = useRef(switchPage)
  switchPageRef.current = switchPage

  /**
   * A page switch the USER made — it turns auto-follow off: a view that
   * yanks back while its user deliberately looks elsewhere would make
   * follow its own enemy.
   */
  const manualSwitch = useCallback((key: string) => {
    if (followRef.current) {
      actions.setFollow(false)
      setFlash(t('followOff'))
    }
    switchPage(key)
  }, [actions, switchPage, t])

  const toggleFollow = useCallback(() => {
    const next = !followRef.current
    actions.setFollow(next)
    setFlash(next ? t('followOn') : t('followOff'))
  }, [actions, t])

  const climbBack = useCallback((): boolean => {
    const stack = diveStackRef.current
    let parent = stack.pop()
    while (parent !== undefined && !pages.some(page => page.key === parent)) parent = stack.pop()
    parent ??= activeKey === undefined ? undefined : breadcrumbOf(pages, activeKey)?.parentKey
    if (parent !== undefined && parent !== activeKey) {
      manualSwitch(parent)
      return true
    }
    return false
  }, [activeKey, manualSwitch, pages])

  const dive = useCallback((id: string) => {
    const submap = activeMap?.nodes.find(node => (node.id as string) === id)?.submap as string | undefined
    if (submap === undefined) return
    if (pages.some(page => page.key === submap)) {
      if (activeKey !== undefined) diveStackRef.current.push(activeKey)
      manualSwitch(submap)
    } else {
      setFlash(`${t('submapMissing')}: ${submap}`)
    }
  }, [activeKey, activeMap, manualSwitch, pages, t])

  // -- zoom: continuous geometric scale with a visual anchor; the content
  // step follows the scale by thresholds (layout.ts) -----------------------
  const applyScale = useCallback((next: number, clientX?: number, clientY?: number) => {
    const el = scrollRef.current
    if (next === scale || el === null || layout === undefined) return
    const box = el.getBoundingClientRect()
    const ax = clientX !== undefined ? clientX - box.left : el.clientWidth / 2
    const ay = clientY !== undefined ? clientY - box.top : el.clientHeight / 2
    const cx = (el.scrollLeft + ax) / scale
    const cy = (el.scrollTop + ay) / scale
    // A same-step zoom is pure geometry: anchoring the exact content point
    // under the cursor is mathematically inverse, so zoom in and out retrace
    // each other. Box identity would snap to a box CENTER on every step — a
    // systematic drift — and is only needed to bridge a REFLOW, where the
    // old coordinates stop being comparable.
    const anchorId = stepForScale(next, stepRef.current) === stepRef.current
      ? undefined
      : focus
        ?? layout.boxes.find(b => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)?.node.id as string | undefined
    const anchorBox = anchorId === undefined ? undefined : layout.boxes.find(b => (b.node.id as string) === anchorId)
    // The overview step swaps node identities for group identities, so an
    // anchor that crosses that boundary would simply vanish and drop the
    // scroll into the wrong coordinate space. Carry the anchor's kin — a
    // node's group going far, one of a group's members coming back — and
    // the handoff keeps the same neighborhood under the cursor.
    const kinId = anchorId === undefined || activeMap === undefined
      ? undefined
      : layout.aggregated
        ? activeMap.nodes.find(node => (node.group as string | undefined) === anchorId)?.id as string | undefined
        : activeMap.nodes.find(node => (node.id as string) === anchorId)?.group as string | undefined
    zoomAnchorRef.current = {
      id: anchorId,
      kinId,
      screenX: anchorBox !== undefined ? (anchorBox.x + anchorBox.w / 2) * scale - el.scrollLeft : ax,
      screenY: anchorBox !== undefined ? (anchorBox.y + anchorBox.h / 2) * scale - el.scrollTop : ay,
      cx,
      cy,
    }
    setScale(next)
  }, [activeMap, focus, layout, scale])

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    const el = scrollRef.current
    if (anchor === null || el === null || layout === undefined) return
    zoomAnchorRef.current = null
    const boxOf = (id: string | undefined): (typeof layout.boxes)[number] | undefined =>
      id === undefined ? undefined : layout.boxes.find(b => (b.node.id as string) === id)
    const after = boxOf(anchor.id) ?? boxOf(anchor.kinId)
    if (after !== undefined) {
      el.scrollLeft = Math.max(0, (after.x + after.w / 2) * scale - anchor.screenX)
      el.scrollTop = Math.max(0, (after.y + after.h / 2) * scale - anchor.screenY)
    } else {
      el.scrollLeft = Math.max(0, anchor.cx * scale - anchor.screenX)
      el.scrollTop = Math.max(0, anchor.cy * scale - anchor.screenY)
    }
  }, [layout, scale])

  // React roots register wheel passively; zooming needs preventDefault, so
  // the listener attaches natively. Shift+wheel and horizontal-dominant
  // events pass through untouched — native horizontal scroll IS the pan
  // (and a pure-horizontal event must never read as a zoom-out). Each event
  // contributes an exponential factor (wheel.ts), so every device zooms
  // smoothly by its travel.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      event.preventDefault()
      applyScale(clampScale(scale * wheelScaleFactor(event)), event.clientX, event.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [applyScale, scale])

  // -- drag pan: content follows the pointer; a moved press is not a click.
  // Capture starts only once the press actually MOVES: capturing on the bare
  // press would retarget the derived click/dblclick to this container and
  // silently eat every node pin and dive.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const el = scrollRef.current
    if (el === null) return
    // A fresh press clears a swallow left by a drag whose click never came
    // (released outside the window) — it must not eat this gesture's click.
    swallowClickRef.current = false
    dragRef.current = { x: event.clientX, y: event.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false }
  }, [])
  // Edge auto-pan: once the cursor overshoots the pane during a drag, the
  // content keeps sliding by the overshoot — which also covers the cursor
  // PINNED at a screen edge, where no further move events arrive at all.
  // The drag origin is rebased every tick so the absolute pan math and the
  // auto-pan never fight over the scroll position.
  const autoPanRef = useRef<number | null>(null)
  const overshootRef = useRef({ x: 0, y: 0 })
  const lastPointerAt = useRef(0)
  const stopAutoPan = useCallback(() => {
    if (autoPanRef.current !== null) cancelAnimationFrame(autoPanRef.current)
    autoPanRef.current = null
    overshootRef.current = { x: 0, y: 0 }
  }, [])
  useEffect(() => stopAutoPan, [stopAutoPan])
  const ensureAutoPan = useCallback(() => {
    if (autoPanRef.current !== null) return
    const tick = (): void => {
      const el = scrollRef.current
      const drag = dragRef.current
      const { x, y } = overshootRef.current
      if (el === null || drag === null || (x === 0 && y === 0)) {
        autoPanRef.current = null
        return
      }
      // While the hand is actively moving, pointer deltas own the pan — the
      // auto-pan only takes over once the cursor RESTS outside (screen edge,
      // out of the window). Stepping during live movement would fight a
      // pull-back and eat it.
      if (performance.now() - lastPointerAt.current < 150) {
        autoPanRef.current = requestAnimationFrame(tick)
        return
      }
      const stepX = Math.max(-24, Math.min(24, x * 0.2))
      const stepY = Math.max(-24, Math.min(24, y * 0.2))
      const beforeX = el.scrollLeft
      const beforeY = el.scrollTop
      el.scrollLeft -= stepX
      el.scrollTop -= stepY
      // Rebase by the delta the browser actually applied (a clamped bound
      // applies none): booking the intended step would run up phantom
      // travel the user must retrace before the map answers again.
      drag.sl += el.scrollLeft - beforeX
      drag.st += el.scrollTop - beforeY
      autoPanRef.current = requestAnimationFrame(tick)
    }
    autoPanRef.current = requestAnimationFrame(tick)
  }, [])

  // Ending a drag has more exits than pointerup: the browser may cancel the
  // pointer (window blur, OS gesture), capture may be torn away, or a
  // release outside the window may never deliver up at all — every exit runs
  // through here, and a captureless move with no buttons down is treated as
  // one too, so a drag can never dangle and pan with the button released.
  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Idempotent: releasing capture below re-fires lostpointercapture into
    // this same handler, which must not clear the click-swallow flag again.
    if (dragRef.current === null) return
    stopAutoPan()
    swallowClickRef.current = dragRef.current.moved
    dragRef.current = null
    const el = scrollRef.current
    if (el !== null && el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  }, [stopAutoPan])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const el = scrollRef.current
    if (drag === null || el === null) return
    if (event.buttons === 0) {
      endDrag(event)
      return
    }
    lastPointerAt.current = performance.now()
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved) {
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return
      drag.moved = true
      el.setPointerCapture(event.pointerId)
    }
    el.scrollLeft = drag.sl - dx
    el.scrollTop = drag.st - dy
    // The browser clamps the assignment at the scroll bounds; rebase the
    // origin to the REAL position so pulling back after riding a bound
    // moves the map immediately instead of retracing the overshoot first.
    drag.sl = el.scrollLeft + dx
    drag.st = el.scrollTop + dy
    const rect = el.getBoundingClientRect()
    overshootRef.current = {
      x: event.clientX < rect.left ? event.clientX - rect.left : event.clientX > rect.right ? event.clientX - rect.right : 0,
      y: event.clientY < rect.top ? event.clientY - rect.top : event.clientY > rect.bottom ? event.clientY - rect.bottom : 0,
    }
    if (overshootRef.current.x !== 0 || overshootRef.current.y !== 0) ensureAutoPan()
  }, [endDrag, ensureAutoPan])
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false
      event.stopPropagation()
      event.preventDefault()
    }
  }, [])

  // -- keyboard: the terminal pane's vocabulary, minus quit -----------------
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    const top = topLevelKeys(pages)
    const nudge = (dx: number, dy: number): void => { el?.scrollBy({ left: dx, top: dy }) }
    switch (event.key) {
      case '+': case '=': applyScale(clampScale(scale * KEY_ZOOM)); break
      case '-': applyScale(clampScale(scale / KEY_ZOOM)); break
      case '0':
        setScale(SCALE_DEFAULT)
        requestAnimationFrame(() => { if (el !== null) { el.scrollLeft = 0; el.scrollTop = 0 } })
        break
      case 'Escape':
        if (selected !== null) setSelected(null)
        else climbBack()
        break
      case 'Backspace': climbBack(); break
      case 'Tab': {
        if (top.length < 2 || activeKey === undefined) return
        const index = top.indexOf(activeKey)
        const step = event.shiftKey ? -1 : 1
        const target = top[(index + step + top.length) % top.length]
        if (target !== undefined) manualSwitch(target)
        break
      }
      case 'f': case 'F': toggleFollow(); break
      case 'ArrowLeft': case 'h': nudge(-48, 0); break
      case 'ArrowRight': case 'l': nudge(48, 0); break
      case 'ArrowUp': case 'k': nudge(0, -48); break
      case 'ArrowDown': case 'j': nudge(0, 48); break
      default: {
        const digit = Number(event.key)
        const target = Number.isInteger(digit) && digit >= 1 && digit <= 9 ? top[digit - 1] : undefined
        if (target === undefined) return
        manualSwitch(target)
        break
      }
    }
    event.preventDefault()
  }, [activeKey, applyScale, climbBack, manualSwitch, pages, selected, toggleFollow, scale])

  // -- divider drag: resident panel height ----------------------------------
  const dividerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startH = panelH
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (ev: PointerEvent): void => {
      actions.setPanelH(startH + (startY - ev.clientY))
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }, [actions, panelH])

  // -- viewpoint round trip across session switches -------------------------
  // A remount (this conversation re-entered) restores the active page's
  // parked view once; leaving parks the active page the same way switchPage
  // parks a background one.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || activeKey === undefined) return
    restoredRef.current = true
    const view = viewsRef.current[activeKey]
    if (view !== undefined) {
      setScale(clampScale(view.scale))
      setSelected(view.selected)
    }
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el !== null) {
        el.scrollLeft = view?.scrollX ?? 0
        el.scrollTop = view?.scrollY ?? 0
      }
    })
  }, [activeKey])
  useEffect(() => () => {
    const key = activeKeyRef.current
    const el = scrollRef.current
    if (key === undefined) return
    actions.parkView(key, {
      scale: scaleRef.current,
      selected: selectedRef.current,
      scrollX: el?.scrollLeft ?? 0,
      scrollY: el?.scrollTop ?? 0,
    })
  }, [actions])

  return (
    <div className={css.view} tabIndex={0} onKeyDown={onKeyDown}>
      {fetchState === 'loading' && pages.length === 0 ? <p className={css.status}>{t('loading')}</p> : null}
      {fetchState === 'error' && pages.length === 0 ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={() => { setRetries(value => value + 1) }}>{t('retry')}</button>
        </div>
      ) : null}
      {fetchState === 'ready' && pages.length === 0 ? (
        <div className={css.emptyState}>
          <p><span className={css.cursor}>{t('empty')}</span></p>
          <p className={css.hint}>{t('emptyHint')}</p>
        </div>
      ) : null}
      {pages.length > 0 && active !== undefined ? (
        <>
          {crumb !== undefined ? (
            <button type="button" className={css.crumb} title={t('back')} onClick={() => { climbBack() }}>
              ⌫ {crumb.parentTitle ?? (crumb.parentKey === DEFAULT_PAGE_KEY ? t('defaultPage') : crumb.parentKey)} ▸ <strong>{crumb.label}</strong>
            </button>
          ) : tabs.length > 1 ? (
            <div className={css.tabs} role="tablist">
              {tabs.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={tab.active}
                  data-active={tab.active ? 'true' : undefined}
                  data-status={tab.neutral ? 'neutral' : tab.status}
                  data-fresh={tab.fresh ? 'true' : undefined}
                  onClick={() => { if (!tab.active) manualSwitch(tab.key) }}
                >
                  {/* The bracketed digit IS the shortcut: keys 1-9 switch pages. */}
                  <b>[{index + 1}]</b>
                  {tab.title ?? (tab.key === DEFAULT_PAGE_KEY ? t('defaultPage') : tab.key)}
                  {tab.fresh ? '*' : null}
                </button>
              ))}
            </div>
          ) : null}
          <div
            ref={scrollRef}
            className={css.scroll}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onClickCapture={onClickCapture}
          >
            {layout !== undefined && layout.boxes.length > 0 ? (
              <MapSvg
                layout={layout}
                scale={scale}
                focus={focus}
                selected={selected}
                onHover={setHover}
                onSelect={setSelected}
                onDive={dive}
              />
            ) : (
              <p className={css.status}>{active.error !== null && activeMap === undefined ? `${t('pageInvalid')}: ${active.error}` : t('emptyMap')}</p>
            )}
          </div>
          {active.error !== null && activeMap !== undefined ? (
            <p className={css.stale} role="alert">{t('stalePage')}</p>
          ) : null}
          {flash !== null ? <p className={css.flash}>» {flash}</p> : null}
          <div className={css.divider} onPointerDown={dividerDown}>
            <span className={css.dividerGrip}>╌╌╌</span>
            <button
              type="button"
              className={css.followTag}
              data-armed={follow ? 'true' : undefined}
              title={follow ? t('followOn') : t('followOff')}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={toggleFollow}
            >
              {t('followTag')}
            </button>
          </div>
          <div className={css.panel} style={{ height: panelH }}>
            {activeMap !== undefined ? (
              <DetailPanel map={activeMap} focus={focus} pinned={focus !== null && focus === selected} t={t} />
            ) : null}
          </div>
          <div className={css.footer}>
            <span>
              ⊕ {Math.round(scale * 100)}%
              {step >= 1 ? ` · ${zoomLabel(step)}` : ''}
              {layout?.aggregated === true ? ` · ${t('aggregated')}` : ''}
            </span>
            <span>{t('zoomHint')}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}
