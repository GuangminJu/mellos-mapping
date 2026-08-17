import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mostRecentKey, zoomLabel } from 'mellos-mapping/semantics';
import { SCALE_DEFAULT, clampScale, computeLayout, stepForScale } from "./layout.js";
import { wheelScaleFactor } from "./wheel.js";
import { DEFAULT_PAGE_KEY, breadcrumbOf, changedKeys, markViewed, mergePages, pageTabs, resolveActiveKey, topLevelKeys, } from "./pages.js";
import { DetailPanel } from "./DetailPanel.js";
import { MapSvg } from "./MapSvg.js";
import css from './MmapView.module.css';
/** Keyboard zoom ratio per +/- press. */
const KEY_ZOOM = 1.25;
/** Render the live Mellos map of this session's workspace. */
export function MmapView(props) {
    const { read, autoOpen, t, useStore, actions } = props;
    const revision = props.useMmapRevision(value => value);
    const [fetchState, setFetchState] = useState('loading');
    const [pages, setPages] = useState([]);
    const [retries, setRetries] = useState(0);
    const [scale, setScale] = useState(SCALE_DEFAULT);
    const [selected, setSelected] = useState(null);
    const [hover, setHover] = useState(null);
    const [flash, setFlash] = useState(null);
    // The conversation's own viewpoint (store.ts): page choice, auto-follow
    // armedness, divider height, and parked per-page views all persist per
    // session — switching back to this conversation restores how IT looked at
    // the shared workspace store.
    const chosenKey = useStore(s => s.chosenKey);
    const follow = useStore(s => s.follow);
    const panelH = useStore(s => s.panelH);
    const views = useStore(s => s.views);
    const scrollRef = useRef(null);
    const pagesRef = useRef([]);
    // Mirrors for the fetch closure: reading live state there must not re-arm
    // the read effect itself.
    const followRef = useRef(follow);
    followRef.current = follow;
    const viewsRef = useRef(views);
    viewsRef.current = views;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const diveStackRef = useRef([]);
    const activeKeyRef = useRef(undefined);
    const chosenRef = useRef(undefined);
    chosenRef.current = chosenKey;
    const openedRef = useRef(false);
    /** Last ok read found a resolved workspace with zero pages (a true empty store). */
    const emptyStoreRef = useRef(false);
    const dragRef = useRef(null);
    const swallowClickRef = useRef(false);
    const zoomAnchorRef = useRef(null);
    const activeKey = resolveActiveKey(pages, chosenKey);
    activeKeyRef.current = activeKey;
    const active = pages.find(page => page.key === activeKey);
    const activeMap = active?.map;
    // Schmitt-triggered content step: the previous render's step engages the
    // hysteresis band, so wheel jitter at a threshold cannot flap the layout.
    const stepRef = useRef(stepForScale(scale));
    const step = stepForScale(scale, stepRef.current);
    stepRef.current = step;
    const layout = useMemo(() => (activeMap === undefined ? undefined : computeLayout(activeMap, step)), [activeMap, step]);
    const focus = hover ?? selected;
    const tabs = useMemo(() => pageTabs(pages, activeKey), [activeKey, pages]);
    const crumb = activeKey === undefined ? undefined : breadcrumbOf(pages, activeKey);
    // -- data cycle: read on every revision bump; keep-last-good per page.
    // Change events are the primary trigger, but they cannot be the only one:
    // a read that raced the Host's own startup (transport not ready, session
    // store still empty) would otherwise stick forever. An unusable answer —
    // failure, no workspace, or an empty store — retries on its own with
    // backoff, and a usable one resets the ladder.
    const failsRef = useRef(0);
    useEffect(() => {
        let current = true;
        let retryTimer;
        const scheduleRetry = () => {
            failsRef.current += 1;
            const delay = Math.min(10_000, 1000 * 2 ** (failsRef.current - 1));
            retryTimer = setTimeout(() => { setRetries(value => value + 1); }, delay);
        };
        void Promise.resolve().then(() => read()).then((result) => {
            if (!current)
                return;
            setFetchState('ready');
            const prev = pagesRef.current;
            const next = mergePages(prev, result, activeKeyRef.current);
            pagesRef.current = next;
            setPages(next);
            // A hidden sub-map has no tab to light: surface its change here.
            const top = new Set(topLevelKeys(next));
            const hidden = next.find(page => page.fresh && !top.has(page.key)
                && !(prev.find(old => old.key === page.key)?.fresh ?? false));
            if (hidden !== undefined) {
                setFlash(`⊞ ${hidden.map?.title ?? hidden.key}`);
            }
            // Auto-follow: switch to the page last WRITTEN among this read's
            // changes (several → most recent wins). A drag in progress skips the
            // jump — the writer's next save re-triggers it anyway.
            const changed = changedKeys(prev, next);
            // The column auto-opens on ACTIVITY, never on existence: the map
            // store belongs to the workspace, so every conversation there reads
            // the same maps — a panel that popped in all of them just because a
            // map exists would sever the tie between a conversation and the
            // mapping happening in it. A workspace's FIRST map is activity too:
            // a read that follows a resolved-but-empty store carries pages the
            // first-read rule of changedKeys cannot see. Once per mount: a user
            // who closed the column mid-session has answered, and stays closed.
            const born = emptyStoreRef.current && next.length > 0;
            if ((changed.length > 0 || born) && !openedRef.current) {
                openedRef.current = true;
                autoOpen();
            }
            emptyStoreRef.current = result.cwd !== null && result.pages.length === 0;
            if (followRef.current && changed.length > 0 && dragRef.current === null) {
                const target = mostRecentKey(changed, key => next.find(page => page.key === key)?.mtimeMs ?? undefined);
                if (target !== undefined && target !== activeKeyRef.current)
                    switchPageRef.current(target);
            }
            // Pin the passive default. With no standing choice (first resolution,
            // or the chosen page's file vanished) the resolver re-defaults to the
            // most recently written page on EVERY read — a background write would
            // yank the view with follow off, and the yanked-to page would keep
            // its fresh star forever (the active tab's click is a no-op, so
            // markViewed never runs). Adopting the resolution as the choice makes
            // follow the only mover, and viewing puts the light out like any
            // deliberate switch.
            const resolved = resolveActiveKey(pagesRef.current, chosenRef.current);
            if (resolved !== undefined && resolved !== chosenRef.current) {
                chosenRef.current = resolved;
                actions.choosePage(resolved);
                pagesRef.current = markViewed(pagesRef.current, resolved);
                setPages(pagesRef.current);
            }
            if (result.cwd === null || result.pages.length === 0) {
                scheduleRetry();
            }
            else {
                failsRef.current = 0;
            }
        }, (error) => {
            if (!current)
                return;
            // The panel shows a generic retry line; the cause goes to the console
            // so a failing host round-trip stays diagnosable in the field.
            console.warn('mmap: read failed', error);
            setFetchState('error');
            scheduleRetry();
        });
        return () => {
            current = false;
            if (retryTimer !== undefined)
                clearTimeout(retryTimer);
        };
    }, [actions, autoOpen, read, revision, retries, props.sessionId]);
    useEffect(() => {
        if (flash === null)
            return;
        const timer = setTimeout(() => { setFlash(null); }, 4000);
        return () => { clearTimeout(timer); };
    }, [flash]);
    // -- page switching: park the current view, restore the target's ----------
    const switchPage = useCallback((key) => {
        const el = scrollRef.current;
        const from = activeKeyRef.current;
        if (from !== undefined) {
            actions.parkView(from, {
                scale, selected, scrollX: el?.scrollLeft ?? 0, scrollY: el?.scrollTop ?? 0,
            });
        }
        const view = viewsRef.current[key];
        chosenRef.current = key;
        actions.choosePage(key);
        setScale(view === undefined ? SCALE_DEFAULT : clampScale(view.scale));
        setSelected(view?.selected ?? null);
        setHover(null);
        pagesRef.current = markViewed(pagesRef.current, key);
        setPages(pagesRef.current);
        requestAnimationFrame(() => {
            const target = scrollRef.current;
            if (target !== null) {
                target.scrollLeft = view?.scrollX ?? 0;
                target.scrollTop = view?.scrollY ?? 0;
            }
        });
    }, [actions, selected, scale]);
    const switchPageRef = useRef(switchPage);
    switchPageRef.current = switchPage;
    /**
     * A page switch the USER made — it turns auto-follow off: a view that
     * yanks back while its user deliberately looks elsewhere would make
     * follow its own enemy.
     */
    const manualSwitch = useCallback((key) => {
        if (followRef.current) {
            actions.setFollow(false);
            setFlash(t('followOff'));
        }
        switchPage(key);
    }, [actions, switchPage, t]);
    const toggleFollow = useCallback(() => {
        const next = !followRef.current;
        actions.setFollow(next);
        setFlash(next ? t('followOn') : t('followOff'));
    }, [actions, t]);
    const climbBack = useCallback(() => {
        const stack = diveStackRef.current;
        let parent = stack.pop();
        while (parent !== undefined && !pages.some(page => page.key === parent))
            parent = stack.pop();
        parent ??= activeKey === undefined ? undefined : breadcrumbOf(pages, activeKey)?.parentKey;
        if (parent !== undefined && parent !== activeKey) {
            manualSwitch(parent);
            return true;
        }
        return false;
    }, [activeKey, manualSwitch, pages]);
    const dive = useCallback((id) => {
        const submap = activeMap?.nodes.find(node => node.id === id)?.submap;
        if (submap === undefined)
            return;
        if (pages.some(page => page.key === submap)) {
            if (activeKey !== undefined)
                diveStackRef.current.push(activeKey);
            manualSwitch(submap);
        }
        else {
            setFlash(`${t('submapMissing')}: ${submap}`);
        }
    }, [activeKey, activeMap, manualSwitch, pages, t]);
    // -- zoom: continuous geometric scale with a visual anchor; the content
    // step follows the scale by thresholds (layout.ts) -----------------------
    const applyScale = useCallback((next, clientX, clientY) => {
        const el = scrollRef.current;
        if (next === scale || el === null || layout === undefined)
            return;
        const box = el.getBoundingClientRect();
        const ax = clientX !== undefined ? clientX - box.left : el.clientWidth / 2;
        const ay = clientY !== undefined ? clientY - box.top : el.clientHeight / 2;
        const cx = (el.scrollLeft + ax) / scale;
        const cy = (el.scrollTop + ay) / scale;
        // A same-step zoom is pure geometry: anchoring the exact content point
        // under the cursor is mathematically inverse, so zoom in and out retrace
        // each other. Box identity would snap to a box CENTER on every step — a
        // systematic drift — and is only needed to bridge a REFLOW, where the
        // old coordinates stop being comparable.
        const anchorId = stepForScale(next, stepRef.current) === stepRef.current
            ? undefined
            : focus
                ?? layout.boxes.find(b => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)?.node.id;
        const anchorBox = anchorId === undefined ? undefined : layout.boxes.find(b => b.node.id === anchorId);
        // The overview step swaps node identities for group identities, so an
        // anchor that crosses that boundary would simply vanish and drop the
        // scroll into the wrong coordinate space. Carry the anchor's kin — a
        // node's group going far, one of a group's members coming back — and
        // the handoff keeps the same neighborhood under the cursor.
        const kinId = anchorId === undefined || activeMap === undefined
            ? undefined
            : layout.aggregated
                ? activeMap.nodes.find(node => node.group === anchorId)?.id
                : activeMap.nodes.find(node => node.id === anchorId)?.group;
        zoomAnchorRef.current = {
            id: anchorId,
            kinId,
            screenX: anchorBox !== undefined ? (anchorBox.x + anchorBox.w / 2) * scale - el.scrollLeft : ax,
            screenY: anchorBox !== undefined ? (anchorBox.y + anchorBox.h / 2) * scale - el.scrollTop : ay,
            cx,
            cy,
        };
        setScale(next);
    }, [activeMap, focus, layout, scale]);
    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current;
        const el = scrollRef.current;
        if (anchor === null || el === null || layout === undefined)
            return;
        zoomAnchorRef.current = null;
        const boxOf = (id) => id === undefined ? undefined : layout.boxes.find(b => b.node.id === id);
        const after = boxOf(anchor.id) ?? boxOf(anchor.kinId);
        if (after !== undefined) {
            el.scrollLeft = Math.max(0, (after.x + after.w / 2) * scale - anchor.screenX);
            el.scrollTop = Math.max(0, (after.y + after.h / 2) * scale - anchor.screenY);
        }
        else {
            el.scrollLeft = Math.max(0, anchor.cx * scale - anchor.screenX);
            el.scrollTop = Math.max(0, anchor.cy * scale - anchor.screenY);
        }
    }, [layout, scale]);
    // React roots register wheel passively; zooming needs preventDefault, so
    // the listener attaches natively. Shift+wheel and horizontal-dominant
    // events pass through untouched — native horizontal scroll IS the pan
    // (and a pure-horizontal event must never read as a zoom-out). Each event
    // contributes an exponential factor (wheel.ts), so every device zooms
    // smoothly by its travel.
    useEffect(() => {
        const el = scrollRef.current;
        if (el === null)
            return;
        const onWheel = (event) => {
            if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
                return;
            event.preventDefault();
            applyScale(clampScale(scale * wheelScaleFactor(event)), event.clientX, event.clientY);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => { el.removeEventListener('wheel', onWheel); };
    }, [applyScale, scale]);
    // -- drag pan: content follows the pointer; a moved press is not a click.
    // Capture starts only once the press actually MOVES: capturing on the bare
    // press would retarget the derived click/dblclick to this container and
    // silently eat every node pin and dive.
    const onPointerDown = useCallback((event) => {
        if (event.button !== 0)
            return;
        const el = scrollRef.current;
        if (el === null)
            return;
        // A fresh press clears a swallow left by a drag whose click never came
        // (released outside the window) — it must not eat this gesture's click.
        swallowClickRef.current = false;
        dragRef.current = { x: event.clientX, y: event.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
    }, []);
    // Edge auto-pan: once the cursor overshoots the pane during a drag, the
    // content keeps sliding by the overshoot — which also covers the cursor
    // PINNED at a screen edge, where no further move events arrive at all.
    // The drag origin is rebased every tick so the absolute pan math and the
    // auto-pan never fight over the scroll position.
    const autoPanRef = useRef(null);
    const overshootRef = useRef({ x: 0, y: 0 });
    const lastPointerAt = useRef(0);
    const stopAutoPan = useCallback(() => {
        if (autoPanRef.current !== null)
            cancelAnimationFrame(autoPanRef.current);
        autoPanRef.current = null;
        overshootRef.current = { x: 0, y: 0 };
    }, []);
    useEffect(() => stopAutoPan, [stopAutoPan]);
    const ensureAutoPan = useCallback(() => {
        if (autoPanRef.current !== null)
            return;
        const tick = () => {
            const el = scrollRef.current;
            const drag = dragRef.current;
            const { x, y } = overshootRef.current;
            if (el === null || drag === null || (x === 0 && y === 0)) {
                autoPanRef.current = null;
                return;
            }
            // While the hand is actively moving, pointer deltas own the pan — the
            // auto-pan only takes over once the cursor RESTS outside (screen edge,
            // out of the window). Stepping during live movement would fight a
            // pull-back and eat it.
            if (performance.now() - lastPointerAt.current < 150) {
                autoPanRef.current = requestAnimationFrame(tick);
                return;
            }
            const stepX = Math.max(-24, Math.min(24, x * 0.2));
            const stepY = Math.max(-24, Math.min(24, y * 0.2));
            const beforeX = el.scrollLeft;
            const beforeY = el.scrollTop;
            el.scrollLeft -= stepX;
            el.scrollTop -= stepY;
            // Rebase by the delta the browser actually applied (a clamped bound
            // applies none): booking the intended step would run up phantom
            // travel the user must retrace before the map answers again.
            drag.sl += el.scrollLeft - beforeX;
            drag.st += el.scrollTop - beforeY;
            autoPanRef.current = requestAnimationFrame(tick);
        };
        autoPanRef.current = requestAnimationFrame(tick);
    }, []);
    // Ending a drag has more exits than pointerup: the browser may cancel the
    // pointer (window blur, OS gesture), capture may be torn away, or a
    // release outside the window may never deliver up at all — every exit runs
    // through here, and a captureless move with no buttons down is treated as
    // one too, so a drag can never dangle and pan with the button released.
    const endDrag = useCallback((event) => {
        // Idempotent: releasing capture below re-fires lostpointercapture into
        // this same handler, which must not clear the click-swallow flag again.
        if (dragRef.current === null)
            return;
        stopAutoPan();
        swallowClickRef.current = dragRef.current.moved;
        dragRef.current = null;
        const el = scrollRef.current;
        if (el !== null && el.hasPointerCapture(event.pointerId))
            el.releasePointerCapture(event.pointerId);
    }, [stopAutoPan]);
    const onPointerMove = useCallback((event) => {
        const drag = dragRef.current;
        const el = scrollRef.current;
        if (drag === null || el === null)
            return;
        if (event.buttons === 0) {
            endDrag(event);
            return;
        }
        lastPointerAt.current = performance.now();
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved) {
            if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3)
                return;
            drag.moved = true;
            el.setPointerCapture(event.pointerId);
        }
        el.scrollLeft = drag.sl - dx;
        el.scrollTop = drag.st - dy;
        // The browser clamps the assignment at the scroll bounds; rebase the
        // origin to the REAL position so pulling back after riding a bound
        // moves the map immediately instead of retracing the overshoot first.
        drag.sl = el.scrollLeft + dx;
        drag.st = el.scrollTop + dy;
        const rect = el.getBoundingClientRect();
        overshootRef.current = {
            x: event.clientX < rect.left ? event.clientX - rect.left : event.clientX > rect.right ? event.clientX - rect.right : 0,
            y: event.clientY < rect.top ? event.clientY - rect.top : event.clientY > rect.bottom ? event.clientY - rect.bottom : 0,
        };
        if (overshootRef.current.x !== 0 || overshootRef.current.y !== 0)
            ensureAutoPan();
    }, [endDrag, ensureAutoPan]);
    const onClickCapture = useCallback((event) => {
        if (swallowClickRef.current) {
            swallowClickRef.current = false;
            event.stopPropagation();
            event.preventDefault();
        }
    }, []);
    // -- keyboard: the terminal pane's vocabulary, minus quit -----------------
    const onKeyDown = useCallback((event) => {
        const el = scrollRef.current;
        const top = topLevelKeys(pages);
        const nudge = (dx, dy) => { el?.scrollBy({ left: dx, top: dy }); };
        switch (event.key) {
            case '+':
            case '=':
                applyScale(clampScale(scale * KEY_ZOOM));
                break;
            case '-':
                applyScale(clampScale(scale / KEY_ZOOM));
                break;
            case '0':
                setScale(SCALE_DEFAULT);
                requestAnimationFrame(() => { if (el !== null) {
                    el.scrollLeft = 0;
                    el.scrollTop = 0;
                } });
                break;
            case 'Escape':
                if (selected !== null)
                    setSelected(null);
                else
                    climbBack();
                break;
            case 'Backspace':
                climbBack();
                break;
            case 'Tab': {
                if (top.length < 2 || activeKey === undefined)
                    return;
                const index = top.indexOf(activeKey);
                const step = event.shiftKey ? -1 : 1;
                const target = top[(index + step + top.length) % top.length];
                if (target !== undefined)
                    manualSwitch(target);
                break;
            }
            case 'f':
            case 'F':
                toggleFollow();
                break;
            case 'ArrowLeft':
            case 'h':
                nudge(-48, 0);
                break;
            case 'ArrowRight':
            case 'l':
                nudge(48, 0);
                break;
            case 'ArrowUp':
            case 'k':
                nudge(0, -48);
                break;
            case 'ArrowDown':
            case 'j':
                nudge(0, 48);
                break;
            default: {
                const digit = Number(event.key);
                const target = Number.isInteger(digit) && digit >= 1 && digit <= 9 ? top[digit - 1] : undefined;
                if (target === undefined)
                    return;
                manualSwitch(target);
                break;
            }
        }
        event.preventDefault();
    }, [activeKey, applyScale, climbBack, manualSwitch, pages, selected, toggleFollow, scale]);
    // -- divider drag: resident panel height ----------------------------------
    const dividerDown = useCallback((event) => {
        const startY = event.clientY;
        const startH = panelH;
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const move = (ev) => {
            actions.setPanelH(startH + (startY - ev.clientY));
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    }, [actions, panelH]);
    // -- viewpoint round trip across session switches -------------------------
    // A remount (this conversation re-entered) restores the active page's
    // parked view once; leaving parks the active page the same way switchPage
    // parks a background one.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current || activeKey === undefined)
            return;
        restoredRef.current = true;
        const view = viewsRef.current[activeKey];
        if (view !== undefined) {
            setScale(clampScale(view.scale));
            setSelected(view.selected);
        }
        requestAnimationFrame(() => {
            const el = scrollRef.current;
            if (el !== null) {
                el.scrollLeft = view?.scrollX ?? 0;
                el.scrollTop = view?.scrollY ?? 0;
            }
        });
    }, [activeKey]);
    useEffect(() => () => {
        const key = activeKeyRef.current;
        const el = scrollRef.current;
        if (key === undefined)
            return;
        actions.parkView(key, {
            scale: scaleRef.current,
            selected: selectedRef.current,
            scrollX: el?.scrollLeft ?? 0,
            scrollY: el?.scrollTop ?? 0,
        });
    }, [actions]);
    return (_jsxs("div", { className: css.view, tabIndex: 0, onKeyDown: onKeyDown, children: [fetchState === 'loading' && pages.length === 0 ? _jsx("p", { className: css.status, children: t('loading') }) : null, fetchState === 'error' && pages.length === 0 ? (_jsxs("div", { className: css.failure, children: [_jsx("p", { role: "alert", children: t('error') }), _jsx("button", { type: "button", onClick: () => { setRetries(value => value + 1); }, children: t('retry') })] })) : null, fetchState === 'ready' && pages.length === 0 ? (_jsxs("div", { className: css.emptyState, children: [_jsx("p", { children: _jsx("span", { className: css.cursor, children: t('empty') }) }), _jsx("p", { className: css.hint, children: t('emptyHint') })] })) : null, pages.length > 0 && active !== undefined ? (_jsxs(_Fragment, { children: [crumb !== undefined ? (_jsxs("button", { type: "button", className: css.crumb, title: t('back'), onClick: () => { climbBack(); }, children: ["\u232B ", crumb.parentTitle ?? (crumb.parentKey === DEFAULT_PAGE_KEY ? t('defaultPage') : crumb.parentKey), " \u25B8 ", _jsx("strong", { children: crumb.label })] })) : tabs.length > 1 ? (_jsx("div", { className: css.tabs, role: "tablist", children: tabs.map((tab, index) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": tab.active, "data-active": tab.active ? 'true' : undefined, "data-status": tab.neutral ? 'neutral' : tab.status, "data-fresh": tab.fresh ? 'true' : undefined, onClick: () => { if (!tab.active)
                                manualSwitch(tab.key); }, children: [_jsxs("b", { children: ["[", index + 1, "]"] }), tab.title ?? (tab.key === DEFAULT_PAGE_KEY ? t('defaultPage') : tab.key), tab.fresh ? '*' : null] }, tab.key))) })) : null, _jsx("div", { ref: scrollRef, className: css.scroll, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onClickCapture: onClickCapture, children: layout !== undefined && layout.boxes.length > 0 ? (_jsx(MapSvg, { layout: layout, scale: scale, focus: focus, selected: selected, onHover: setHover, onSelect: setSelected, onDive: dive })) : (_jsx("p", { className: css.status, children: active.error !== null && activeMap === undefined ? `${t('pageInvalid')}: ${active.error}` : t('emptyMap') })) }), active.error !== null && activeMap !== undefined ? (_jsx("p", { className: css.stale, role: "alert", children: t('stalePage') })) : null, flash !== null ? _jsxs("p", { className: css.flash, children: ["\u00BB ", flash] }) : null, _jsxs("div", { className: css.divider, onPointerDown: dividerDown, children: [_jsx("span", { className: css.dividerGrip, children: "\u254C\u254C\u254C" }), _jsx("button", { type: "button", className: css.followTag, "data-armed": follow ? 'true' : undefined, title: follow ? t('followOn') : t('followOff'), onPointerDown: (event) => { event.stopPropagation(); }, onClick: toggleFollow, children: t('followTag') })] }), _jsx("div", { className: css.panel, style: { height: panelH }, children: activeMap !== undefined ? (_jsx(DetailPanel, { map: activeMap, focus: focus, pinned: focus !== null && focus === selected, t: t })) : null }), _jsxs("div", { className: css.footer, children: [_jsxs("span", { children: ["\u2295 ", Math.round(scale * 100), "%", step >= 1 ? ` · ${zoomLabel(step)}` : '', layout?.aggregated === true ? ` · ${t('aggregated')}` : ''] }), _jsx("span", { children: t('zoomHint') })] })] })) : null] }));
}
//# sourceMappingURL=MmapView.js.map