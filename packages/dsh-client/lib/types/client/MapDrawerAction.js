import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { MmapView } from "./MmapView.js";
import css from './MmapView.module.css';
/**
 * The map surface for hosts whose web frame has no aux column: the same
 * header button, but toggling a right-edge drawer this component portals to
 * the document body. The drawer stays mounted while closed (slid offscreen),
 * mirroring the aux column's width-0 behavior, so live mapping activity can
 * auto-open it through the view's ordinary autoOpen callback.
 */
export function MapDrawerAction(props) {
    const { t } = props;
    const [open, setOpen] = useState(false);
    const autoOpen = useCallback(() => { setOpen(true); }, []);
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.toggle, "data-open": open || undefined, onClick: () => { setOpen(value => !value); }, title: t('view.mmap'), children: t('view.mmap') }), createPortal(_jsxs("div", { className: css.drawer, "data-open": open || undefined, role: "complementary", "aria-label": t('view.mmap'), children: [_jsx("button", { type: "button", className: css.drawerClose, onClick: () => { setOpen(false); }, title: t('close'), children: "\u2715" }), _jsx(MmapView, { ...props, autoOpen: autoOpen })] }), document.body)] }));
}
//# sourceMappingURL=MapDrawerAction.js.map