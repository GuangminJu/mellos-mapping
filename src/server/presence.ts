/** Presentation of store discovery and heartbeat reports; no screen assumptions. */
import { type PageId, listPageFiles, pageIdOfFile, readLiveViewers } from '../store/store.js';
/**
 * How the default page is named in the page-set line. Parenthesized on
 * purpose: a NAMED page may legitimately be called "default", and the two
 * must never read alike.
 */
const DEFAULT_PAGE_NAME = '(default)';
/** The same name when the default page has no file yet — a project whose work lives on named pages. */
const DEFAULT_PAGE_ABSENT = '(default: absent)';

/**
 * The page-set line every view carries: which pages this project HAS, and
 * which one the response is showing.
 *
 * Page discovery had no tool at all — a caller that did not already know a
 * slug could only guess, and the empty-map hint looked identical whether the
 * project had no map or five pages of one. One line answers both, cheaply
 * enough to append to every view.
 * @param stateFile - the default page's file path (the store's base).
 * @param shown - the page this response rendered; undefined = the default page.
 */
export function pagesLine(stateFile: string, shown: string | undefined): string {
  const files = listPageFiles(stateFile);
  const named = files.map((f) => pageIdOfFile(stateFile, f)).filter((p): p is PageId => p !== undefined);
  const hasDefault = files.length > named.length;
  const known = [hasDefault ? DEFAULT_PAGE_NAME : DEFAULT_PAGE_ABSENT, ...named];
  return `pages: ${known.join(', ')} — this view: ${shown ?? DEFAULT_PAGE_NAME}`;
}

// ---------------------------------------------------------------------------
// the pane line — who, if anyone, is SEEING what this call just did
// ---------------------------------------------------------------------------
//
// The ledger's oldest blind spot. An assistant declared a design, lit nodes
// up as it built them, and had no way to know whether any of it was on a
// screen: opening the pane took a human typing `mmap`, and a map written into
// a store nobody had open looks exactly like a map somebody is watching.
// Users watched nothing happen and concluded the tool did nothing.
//
// So every write and every view now carries what the panes themselves report
// (readLiveViewers). It is a STATE line first — this is the fact — and an
// instruction second, because the assistant is the only party in a position
// to act on it: it knows which page it just wrote, and mmap_open takes one.

/** How a page reads in the pane line; the default page has no slug to print. */
function pageName(page: string | undefined): string {
  return page ?? DEFAULT_PAGE_NAME;
}

/**
 * One line on whether a running watcher reports the page this call touched.
 *
 * @param stateFile - the default page's file path (the store's base).
 * @param touched - the page this call wrote or rendered; undefined = default.
 *
 * Four facts, and only one of them is good news:
 *   - no pane at all: the work is invisible, and opening one is the fix.
 *   - a pane on this page: its process is alive, but its window may be hidden.
 *   - a pane elsewhere with auto-follow on: it comes here by itself, because
 *     follow tracks the page last WRITTEN — which this call just was.
 *   - a pane elsewhere with follow off: the user pinned that page by hand.
 *     The change is real and unseen, and the honest move is to say so, not to
 *     yank their view around behind them (SKILL.md: don't fight it).
 */
export function paneLine(stateFile: string, touched: string | undefined, openFailure?: string): string {
  const viewers = readLiveViewers(stateFile, Date.now());
  if (viewers.length === 0) {
    if (openFailure !== undefined) return 'pane: CLOSED — automatic opening previously failed. ' +
      'Do not retry mmap_open until the terminal environment changes or the user asks to retry. ' +
      `The map is saved; mmap_view remains available inline. Last failure: ${openFailure}`;
    return (
      'pane: CLOSED — nobody is seeing this map. Open it with mmap_open ' +
      `{page: ${touched === undefined ? '(omit for the default page)' : `"${touched}"`}} ` +
      'and do not ask first: a user with a mapping policy has already said they want the picture.'
    );
  }
  if (viewers.some((v) => v.page === touched)) return 'pane: running on this page — a heartbeat confirms the process, not terminal visibility.';
  const elsewhere = [...new Set(viewers.map((v) => pageName(v.page)))].join(', ');
  if (viewers.some((v) => v.follow)) {
    return `pane: open on ${elsewhere}, auto-follow on — it lands on this page within a second.`;
  }
  return (
    `pane: open on ${elsewhere}, auto-follow OFF — the user pinned that page, so this change is ` +
    'NOT on their screen. Tell them rather than switching it behind them; mmap_open {page} ' +
    'retargets the pane if they want it moved.'
  );
}
