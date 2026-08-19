/**
 * Layer 4b — the pane's page set, as a value.
 *
 * The watcher polls a directory and has to decide, every tick, WHICH map it
 * is looking at and what it knows about the others. Those rules are the
 * pane's whole behavior — and they used to live inside a 600-line main(),
 * captured by nested closures, so the contracts its header promised were
 * unprovable. They are a fold now: a state, one scan of the store, a new
 * state. No file handles, no timers, no terminal.
 *
 * The rules, in the order they win:
 *
 *   1. An explicit request outranks everything. `--page` on the command line,
 *      or the one-shot focus file a launcher writes for an ALREADY-RUNNING
 *      pane. A page requested before it exists stays pending and is shown the
 *      moment it appears.
 *   2. Auto-follow takes the page last WRITTEN — the map the agent is
 *      operating on right now — unless the user is engaged with this one
 *      (dragging), in which case the writer's next save re-triggers it.
 *   3. Otherwise the pane keeps its page, and falls back to the most recently
 *      written one when that page disappears.
 *
 * And the promises about reading:
 *
 *   - The startup scan is not news. Nothing it finds is marked fresh, and
 *     auto-follow does not fire on it: everything already on disk was there
 *     before this pane opened.
 *   - A torn or unparseable file never costs the last good picture. The map
 *     that was read successfully stays in the entry, the fault is reported
 *     beside it, and a fault that could be a half-written file is retried on
 *     every tick instead of waiting for the mtime to move again.
 *   - A page that changed while it was not on screen is FRESH until viewed —
 *     the pane lights its tab instead of stealing the view.
 *
 * The shape mirrors packages/dsh-client's pages.ts, which folds the same
 * store for a browser: one page set, keep-last-good merging, fresh marking,
 * most-recently-written selection. Two media, one set of rules — but no
 * import between them, because the wire's page keys and a filesystem's paths
 * are not the same thing.
 */

import type { MellosMap } from '../domain/types.js';
import { mostRecentKey } from '../semantics/semantics.js';
import { type StoreError, describeStoreError } from '../store/store.js';

// ---------------------------------------------------------------------------
// faults — everything that can stand between a page file and a picture
// ---------------------------------------------------------------------------

/** A fault the store does not model: the page file could not be read at all. */
export interface UnreadablePage {
  readonly kind: 'unreadable';
  readonly path: string;
  readonly detail: string;
}

/** Everything that can go wrong between a page file and a map value. */
export type PageFault = StoreError | UnreadablePage;

export function describePageFault(fault: PageFault): string {
  return fault.kind === 'unreadable' ? `cannot read ${fault.path}: ${fault.detail}` : describeStoreError(fault);
}

/**
 * A fault that could simply be a half-written file: the next tick may find a
 * whole one, so it is worth re-reading even though nothing moved. Anything
 * else (a directory in the way, a broken invariant, a shape the parser
 * refuses) will still be there next tick and is only re-read when the file
 * actually changes.
 */
function isTransient(fault: PageFault): boolean {
  return fault.kind === 'malformed-json';
}

// ---------------------------------------------------------------------------
// the state
// ---------------------------------------------------------------------------

/**
 * What the pane knows about one page file. Every state is named: there is no
 * "mtime of -1 means we did not really record one" and no error flattened to
 * a string before anyone has decided how to show it.
 */
export type PageState =
  /** Listed by the store, not readable yet — announced before it exists, or gone since. */
  | { readonly kind: 'absent' }
  | { readonly kind: 'loaded'; readonly map: MellosMap; readonly mtimeMs: number }
  | {
      readonly kind: 'faulted';
      readonly fault: PageFault;
      /** The last map that DID load, kept so the picture never blanks. */
      readonly lastGood: MellosMap | undefined;
      readonly mtimeMs: number;
      /** Re-read on the next tick even if the file has not moved. */
      readonly transient: boolean;
    };

export interface PageEntry {
  readonly file: string;
  readonly state: PageState;
  /** Changed while it was not the active page — its tab lights up until viewed. */
  readonly fresh: boolean;
}

/** The map an entry can show, which may be older than its state. */
export function mapOf(entry: PageEntry | undefined): MellosMap | undefined {
  if (entry === undefined || entry.state.kind === 'absent') return undefined;
  return entry.state.kind === 'loaded' ? entry.state.map : entry.state.lastGood;
}

/** The mtime an entry was last read at; undefined while it has never been read. */
export function mtimeOf(entry: PageEntry | undefined): number | undefined {
  return entry === undefined || entry.state.kind === 'absent' ? undefined : entry.state.mtimeMs;
}

/** The fault an entry is currently carrying, if any. */
export function faultOf(entry: PageEntry | undefined): PageFault | undefined {
  return entry?.state.kind === 'faulted' ? entry.state.fault : undefined;
}

export interface PaneState {
  /** Every page file the store lists, in store order (default page first). */
  readonly pages: readonly PageEntry[];
  /** The page on screen. undefined only before the first scan of an empty store. */
  readonly activeFile: string | undefined;
  /** A requested page that does not exist yet; shown the moment it appears. */
  readonly pendingFocusFile: string | undefined;
  /** Auto-follow: the pane switches to the page last written. */
  readonly follow: boolean;
  /** Pages dived through, oldest first — the way back out of a sub-map. */
  readonly diveStack: readonly string[];
  /** Whether the startup scan has happened; before it, nothing is news. */
  readonly scanned: boolean;
}

/**
 * The state a pane opens with.
 * @param follow - auto-follow as configured (`--no-follow` starts it off).
 * @param requestedFile - the page file `--page` asked for, if any.
 */
export function initialPaneState(follow: boolean, requestedFile: string | undefined): PaneState {
  return { pages: [], activeFile: undefined, pendingFocusFile: requestedFile, follow, diveStack: [], scanned: false };
}

export function entryOf(state: PaneState, file: string | undefined): PageEntry | undefined {
  return file === undefined ? undefined : state.pages.find((p) => p.file === file);
}

/** Every page's map, for the rules that need to see the whole store at once. */
export function mapsOf(state: PaneState): ReadonlyMap<string, MellosMap | undefined> {
  return new Map(state.pages.map((p) => [p.file, mapOf(p)]));
}

/** The files the store listed, in store order. */
export function filesOf(state: PaneState): string[] {
  return state.pages.map((p) => p.file);
}

// ---------------------------------------------------------------------------
// transitions
// ---------------------------------------------------------------------------

/** Put out a page's fresh light: it is being looked at. */
function markViewed(state: PaneState, file: string | undefined): PaneState {
  if (file === undefined || !state.pages.some((p) => p.file === file && p.fresh)) return state;
  return { ...state, pages: state.pages.map((p) => (p.file === file ? { ...p, fresh: false } : p)) };
}

/**
 * A page switch the USER made. It withdraws any pending focus request and
 * turns auto-follow off: a pane that yanks the view back while its user is
 * deliberately looking elsewhere would make follow its own enemy.
 * @returns the new state, and whether follow was just turned off (the footer
 *   says so once).
 */
export function userSwitch(state: PaneState, file: string): { state: PaneState; followTurnedOff: boolean } {
  const followTurnedOff = state.follow;
  return {
    state: markViewed({ ...state, activeFile: file, pendingFocusFile: undefined, follow: false }, file),
    followTurnedOff,
  };
}

/** Toggle auto-follow by hand. */
export function toggleFollow(state: PaneState): PaneState {
  return { ...state, follow: !state.follow };
}

/** Remember the page being dived out of, so Backspace can climb back to it. */
export function pushDive(state: PaneState, file: string): PaneState {
  return { ...state, diveStack: [...state.diveStack, file] };
}

/**
 * Climb one dive: the newest remembered page that still exists.
 * @returns the parent to switch to, or undefined when the stack has none —
 *   the caller then derives one by scanning for the linking node.
 */
export function popDive(state: PaneState): { state: PaneState; parent: string | undefined } {
  const files = new Set(filesOf(state));
  const stack = [...state.diveStack];
  while (stack.length > 0) {
    const parent = stack.pop()!;
    if (files.has(parent)) return { state: { ...state, diveStack: stack }, parent };
  }
  return { state: { ...state, diveStack: [] }, parent: undefined };
}

// ---------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------

/** One look at the store: what it holds, and what the outside world asked for. */
export interface ScanInput {
  /** Page files the store lists right now, in store order. */
  readonly files: readonly string[];
  /** Modification time of a file, or undefined when it cannot be stat'ed. */
  readonly mtimeAt: (file: string) => number | undefined;
  /** Read a page; every fault is a value (see readPage in watch.ts). */
  readonly load: (file: string) => { readonly ok: true; readonly value: MellosMap } | { readonly ok: false; readonly error: PageFault };
  /** A one-shot "show this page" request consumed this tick, if any. */
  readonly focusRequest: string | undefined;
  /** The user is dragging: auto-follow yields to the hand on the mouse. */
  readonly engaged: boolean;
}

export interface ScanOutcome {
  readonly state: PaneState;
  /** Pages that changed in the background this scan — their tabs light up. */
  readonly freshened: readonly string[];
}

/**
 * Fold one look at the store into the pane's state: discovery, reading,
 * fresh marking, then the page decision (request, then follow, then keep or
 * fall back). See the module header for the promises this keeps.
 */
export function scan(state: PaneState, input: ScanInput): ScanOutcome {
  const first = !state.scanned;
  const previousActive = state.activeFile;

  const pages: PageEntry[] = [];
  const freshened: string[] = [];
  const changed: string[] = []; // (re)loaded this scan, startup excluded
  for (const file of input.files) {
    const held = entryOf(state, file);
    const mtimeMs = input.mtimeAt(file);
    if (mtimeMs === undefined) {
      // Listed but not readable: keep whatever is known rather than forgetting
      // a page because one stat lost a race with a writer.
      pages.push(held ?? { file, state: { kind: 'absent' }, fresh: false });
      continue;
    }
    const settled =
      held !== undefined &&
      mtimeOf(held) === mtimeMs &&
      !(held.state.kind === 'faulted' && held.state.transient);
    if (settled) {
      pages.push(held);
      continue;
    }

    const loaded = input.load(file);
    if (loaded.ok) {
      if (!first) changed.push(file);
      const fresh = !first && file !== previousActive;
      if (fresh) freshened.push(file);
      pages.push({ file, state: { kind: 'loaded', map: loaded.value, mtimeMs }, fresh });
      continue;
    }
    pages.push({
      file,
      state: {
        kind: 'faulted',
        fault: loaded.error,
        lastGood: mapOf(held),
        mtimeMs,
        transient: isTransient(loaded.error),
      },
      fresh: held?.fresh ?? false,
    });
  }

  // 1. an explicit request outranks every default. On the startup scan the
  // --page argument is the newest intent — a focus file left behind by a dead
  // watcher merely gets swept; afterwards the file channel is how a running
  // pane is retargeted.
  let pendingFocusFile = state.pendingFocusFile;
  if (input.focusRequest !== undefined && !(first && pendingFocusFile !== undefined)) {
    pendingFocusFile = input.focusRequest;
  }
  let activeFile = previousActive;
  let requestApplied = false;
  if (pendingFocusFile !== undefined && input.files.includes(pendingFocusFile)) {
    activeFile = pendingFocusFile;
    pendingFocusFile = undefined;
    requestApplied = true;
  }

  // 2. auto-follow: the page last WRITTEN is the map being operated on now.
  const mtimeIn = (file: string): number | undefined => mtimeOf(pages.find((p) => p.file === file));
  if (state.follow && !requestApplied && changed.length > 0 && !input.engaged) {
    activeFile = mostRecentKey(changed, mtimeIn) ?? activeFile;
  }

  // 3. otherwise keep the page — unless it is gone, and then the most recently
  // written one is where the effort is.
  if (activeFile === undefined || !input.files.includes(activeFile)) {
    activeFile = mostRecentKey(input.files, mtimeIn);
  }

  const files = new Set(input.files);
  const next: PaneState = {
    pages,
    activeFile,
    pendingFocusFile,
    follow: state.follow,
    diveStack: state.diveStack.filter((f) => files.has(f)),
    scanned: true,
  };
  return { state: markViewed(next, activeFile), freshened };
}
