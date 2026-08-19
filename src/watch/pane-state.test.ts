/**
 * Spec for the pane's page set.
 *
 * These are the watcher header's promises, and until the fold existed they
 * could only be checked by opening a pane and watching it: a torn file never
 * costs the last good picture, the startup scan is not news, an explicit
 * request outranks auto-follow, and a page that disappears hands the view to
 * the most recently written one.
 */

import { describe, expect, it } from 'vitest';

import { declareLayer, declareNode, setTitle } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Rank, type Result, err, ok } from '../domain/types.js';
import {
  type PageFault,
  type PaneState,
  type ScanInput,
  entryOf,
  filesOf,
  initialPaneState,
  mapOf,
  popDive,
  pushDive,
  scan,
  toggleFollow,
  userSwitch,
} from './pane-state.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;
const rnk = (n: number): Rank => n as Rank;

const MAIN = '/p/.mellos/map.json';
const API = '/p/.mellos/pages/api.json';
const UI = '/p/.mellos/pages/ui.json';

function page(title: string): MellosMap {
  let map = setTitle(EMPTY_MAP, title);
  map = must(declareLayer(map, { id: lid('base'), name: 'Base', rank: rnk(0) }));
  map = must(declareNode(map, { id: nid('core'), label: 'Core', layer: lid('base') }));
  return map;
}

/** A fake store: which files exist, when they moved, and what they hold. */
class Store {
  readonly mtimes = new Map<string, number>();
  readonly content = new Map<string, Result<MellosMap, PageFault>>();

  put(file: string, map: MellosMap, mtimeMs: number): this {
    this.mtimes.set(file, mtimeMs);
    this.content.set(file, ok(map));
    return this;
  }

  fault(file: string, fault: PageFault, mtimeMs: number): this {
    this.mtimes.set(file, mtimeMs);
    this.content.set(file, err(fault));
    return this;
  }

  remove(file: string): this {
    this.mtimes.delete(file);
    this.content.delete(file);
    return this;
  }

  get files(): string[] {
    return [...this.mtimes.keys()];
  }

  input(extra: Partial<ScanInput> = {}): ScanInput {
    return {
      files: this.files,
      mtimeAt: (file) => this.mtimes.get(file),
      load: (file) => this.content.get(file) ?? err({ kind: 'not-found', path: file }),
      focusRequest: undefined,
      engaged: false,
      ...extra,
    };
  }
}

const torn = (path: string): PageFault => ({ kind: 'malformed-json', path, detail: 'Unexpected end of JSON input' });
const wedged = (path: string): PageFault => ({ kind: 'unreadable', path, detail: 'EISDIR' });

/** Scan a store into a state, one tick. */
function tick(state: PaneState, store: Store, extra: Partial<ScanInput> = {}): PaneState {
  return scan(state, store.input(extra)).state;
}

describe('the startup scan is not news', () => {
  it('marks nothing fresh and follows nothing — everything found was already there', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 900);
    const outcome = scan(initialPaneState(true, undefined), store.input());
    expect(outcome.freshened).toEqual([]);
    expect(outcome.state.pages.every((p) => !p.fresh)).toBe(true);
    // no follow on the first scan: the most recently written page is simply
    // the default choice, and it is the same answer here
    expect(outcome.state.activeFile).toBe(API);
  });

  it('opens on the page last WRITTEN, not the first listed', () => {
    const store = new Store().put(MAIN, page('main'), 900).put(API, page('api'), 100);
    expect(tick(initialPaneState(true, undefined), store).activeFile).toBe(MAIN);
  });

  it('falls back to store order when no page has a readable mtime', () => {
    const store = new Store().put(MAIN, page('main'), 1).put(API, page('api'), 2);
    const blind = store.input({ mtimeAt: () => undefined });
    // nothing can be read at all: the pane still names a page to wait on
    expect(scan(initialPaneState(true, undefined), blind).state.activeFile).toBe(MAIN);
  });
});

describe('background changes', () => {
  it('marks a page that moved while it was off screen, and clears it when viewed', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90);
    let state = tick(initialPaneState(false, undefined), store); // follow off: stays on MAIN
    expect(state.activeFile).toBe(MAIN);

    store.put(API, page('api v2'), 200);
    const outcome = scan(state, store.input());
    expect(outcome.freshened).toEqual([API]);
    expect(entryOf(outcome.state, API)!.fresh).toBe(true);
    expect(entryOf(outcome.state, MAIN)!.fresh).toBe(false);

    state = userSwitch(outcome.state, API).state;
    expect(entryOf(state, API)!.fresh).toBe(false);
  });

  it('never marks the page being looked at', () => {
    const store = new Store().put(MAIN, page('main'), 100);
    const state = tick(initialPaneState(false, undefined), store);
    store.put(MAIN, page('main v2'), 200);
    expect(scan(state, store.input()).freshened).toEqual([]);
  });
});

describe('a file that will not load', () => {
  it('keeps the last good map, reports the fault, and retries a torn read every tick', () => {
    const store = new Store().put(MAIN, page('main'), 100);
    let state = tick(initialPaneState(false, undefined), store);
    expect(mapOf(entryOf(state, MAIN))!.title).toBe('main');

    // a foreign writer caught mid-write: same mtime on the next tick
    store.fault(MAIN, torn(MAIN), 200);
    state = tick(state, store);
    expect(entryOf(state, MAIN)!.state.kind).toBe('faulted');
    expect(mapOf(entryOf(state, MAIN))!.title).toBe('main'); // the picture stays up

    let reads = 0;
    state = tick(state, store, {
      load: (file) => {
        reads++;
        return err(torn(file));
      },
    });
    expect(reads).toBe(1); // re-read although nothing moved

    store.put(MAIN, page('main v2'), 200); // the write finished, mtime unchanged
    state = tick(state, store);
    expect(mapOf(entryOf(state, MAIN))!.title).toBe('main v2');
  });

  it('does not re-read a fault that will still be there — only a moved file is', () => {
    const store = new Store().put(MAIN, page('main'), 100).fault(API, wedged(API), 100);
    let state = tick(initialPaneState(false, undefined), store);
    expect(entryOf(state, API)!.state.kind).toBe('faulted');

    let reads = 0;
    state = tick(state, store, {
      load: (file) => {
        reads++;
        return err(wedged(file));
      },
    });
    expect(reads).toBe(0);

    store.fault(API, wedged(API), 300); // it moved: worth another look
    tick(state, store, {
      load: (file) => {
        reads++;
        return err(wedged(file));
      },
    });
    expect(reads).toBe(1);
  });

  it('keeps a page it cannot stat rather than forgetting it', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 100);
    const state = tick(initialPaneState(false, undefined), store);
    const blinked = tick(state, store, { mtimeAt: (f) => (f === API ? undefined : 100) });
    expect(mapOf(entryOf(blinked, API))!.title).toBe('api');
  });
});

describe('who decides which page is shown', () => {
  it('auto-follow takes the page last written', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90);
    let state = tick(initialPaneState(true, undefined), store);
    expect(state.activeFile).toBe(MAIN);
    store.put(API, page('api v2'), 300);
    state = tick(state, store);
    expect(state.activeFile).toBe(API);
  });

  it('yields to the hand on the mouse: no switch while the user is dragging', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90);
    let state = tick(initialPaneState(true, undefined), store);
    store.put(API, page('api v2'), 300);
    state = tick(state, store, { engaged: true });
    expect(state.activeFile).toBe(MAIN);
  });

  it('an explicit request outranks auto-follow in the same tick', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90).put(UI, page('ui'), 80);
    let state = tick(initialPaneState(true, undefined), store);
    store.put(API, page('api v2'), 300); // follow would take this one
    state = tick(state, store, { focusRequest: UI });
    expect(state.activeFile).toBe(UI);
  });

  it('holds a request for a page that does not exist yet, and applies it on arrival', () => {
    const store = new Store().put(MAIN, page('main'), 100);
    let state = tick(initialPaneState(true, UI), store);
    expect(state.activeFile).toBe(MAIN);
    expect(state.pendingFocusFile).toBe(UI);
    store.put(UI, page('ui'), 400);
    state = tick(state, store);
    expect(state.activeFile).toBe(UI);
    expect(state.pendingFocusFile).toBeUndefined();
  });

  it('lets --page beat a focus file left behind by a dead watcher, once', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90).put(UI, page('ui'), 80);
    // the launcher asked for UI; a stale request for API is swept on the way
    let state = tick(initialPaneState(true, UI), store, { focusRequest: API });
    expect(state.activeFile).toBe(UI);
    // afterwards the file channel IS how a running pane is retargeted
    state = tick(state, store, { focusRequest: API });
    expect(state.activeFile).toBe(API);
  });

  it('hands the view to the most recent page when the active one disappears', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90).put(UI, page('ui'), 80);
    let state = userSwitch(tick(initialPaneState(false, undefined), store), UI).state;
    expect(state.activeFile).toBe(UI);
    store.remove(UI);
    state = tick(state, store);
    expect(state.activeFile).toBe(MAIN);
    expect(filesOf(state)).toEqual([MAIN, API]);
  });
});

describe('switching by hand', () => {
  it('turns auto-follow off — once — and withdraws any pending request', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90);
    const state = tick(initialPaneState(true, UI), store);
    const first = userSwitch(state, API);
    expect(first.followTurnedOff).toBe(true);
    expect(first.state.follow).toBe(false);
    expect(first.state.pendingFocusFile).toBeUndefined();
    expect(userSwitch(first.state, MAIN).followTurnedOff).toBe(false);
    expect(toggleFollow(first.state).follow).toBe(true);
  });
});

describe('the dive stack', () => {
  it('climbs back to the newest page still on disk, and forgets the rest', () => {
    const store = new Store().put(MAIN, page('main'), 100).put(API, page('api'), 90).put(UI, page('ui'), 80);
    let state = tick(initialPaneState(false, undefined), store);
    state = pushDive(pushDive(state, MAIN), API);
    store.remove(API);
    state = tick(state, store); // the scan prunes what is gone
    const climbed = popDive(state);
    expect(climbed.parent).toBe(MAIN);
    expect(popDive(climbed.state).parent).toBeUndefined();
  });
});
