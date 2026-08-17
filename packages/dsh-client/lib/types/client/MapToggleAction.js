import { jsx as _jsx } from "react/jsx-runtime";
import css from './MmapView.module.css';
/** One header button toggling the side-by-side map column. */
export function MapToggleAction({ toggle, t }) {
    return (_jsx("button", { type: "button", className: css.toggle, onClick: toggle, title: t('view.mmap'), children: t('view.mmap') }));
}
//# sourceMappingURL=MapToggleAction.js.map