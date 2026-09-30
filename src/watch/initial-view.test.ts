import { describe, expect, it } from 'vitest';
import { declareGroup, declareLayer, declareNode, removeGroup, setTitle } from '../domain/ops.js';
import { EMPTY_MAP, type GroupId, type LayerId, type MellosMap, type NodeId, type Rank, type Result } from '../domain/types.js';
import { measureMapBody, renderMapWindow } from '../render/render.js';
import { cancelInitialView, decideInitialView, initialViewDecision } from './initial-view.js';

const opts = { color: false, unicode: true, spinnerFrame: 0 } as const;
const layer = 'base' as LayerId;
const group = 'subsystem' as GroupId;
function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function groupedMap(count = 8): MellosMap {
  let map = must(declareLayer(EMPTY_MAP, { id: layer, name: 'Base', rank: 0 as Rank }));
  map = must(declareGroup(map, { id: group, label: 'Subsystem', layer }));
  for (let i = 0; i < count; i++) map = must(declareNode(map, {
    id: `node-${i}` as NodeId, label: `Node ${i}`, layer, group, status: 'planned',
  }));
  return map;
}
const namedSize = (map: MellosMap) => measureMapBody(map, { ...opts, zoom: -4 });

describe('the one-shot startup view decision', () => {
  it('selects a named overview at its exact body fit even when the legend overflows', () => {
    const map = groupedMap();
    const viewport = namedSize(map);
    const picture = renderMapWindow(map, { ...opts, zoom: -4 }, { ...viewport, x: 0, y: 0 });
    expect(picture.contentWidth).toBeGreaterThan(viewport.width);
    expect(picture.contentHeight).toBeGreaterThan(viewport.height);
    expect(measureMapBody(map, opts).width).toBeGreaterThan(viewport.width);
    expect(decideInitialView(initialViewDecision(), map, opts, viewport)).toEqual({
      state: { phase: 'settled', autoSelectedNamed: true }, zoom: -4,
    });
  });

  it('requires both the named body width and height to fit the actual map viewport', () => {
    const map = groupedMap();
    const size = namedSize(map);
    for (const viewport of [{ ...size, width: size.width - 1 }, { ...size, height: size.height - 1 }]) {
      expect(decideInitialView(initialViewDecision(), map, opts, viewport)).toEqual({
        state: { phase: 'settled', autoSelectedNamed: false }, zoom: undefined,
      });
    }
  });

  it('includes full layer names even when every aggregated box would otherwise fit', () => {
    const map = groupedMap();
    const size = namedSize(map);
    const longLayer = { ...map, layers: map.layers.map((value) => ({ ...value, name: 'A very long readable layer label' })) };
    expect(decideInitialView(initialViewDecision(), longLayer, opts, size).zoom).toBeUndefined();
  });

  it('ignores title width but counts its occupied rows', () => {
    const map = setTitle(groupedMap(), 'A very long descriptive title '.repeat(20));
    const size = namedSize(map);
    expect(decideInitialView(initialViewDecision(), map, opts, size).zoom).toBe(-4);
    expect(decideInitialView(initialViewDecision(), map, opts, { ...size, height: size.height - 1 }).zoom).toBeUndefined();
  });

  it('keeps the normal view when its body fits even if its legend does not', () => {
    const map = groupedMap(1);
    const size = measureMapBody(map, opts);
    const picture = renderMapWindow(map, opts, { ...size, x: 0, y: 0 });
    expect(picture.contentWidth).toBeGreaterThan(size.width);
    expect(decideInitialView(initialViewDecision(), map, opts, size)).toEqual({
      state: { phase: 'settled', autoSelectedNamed: false }, zoom: undefined,
    });
  });

  it('never selects the anonymous overview of an ungrouped map', () => {
    const map = must(removeGroup(groupedMap(), group));
    const viewport = namedSize(map);
    expect(measureMapBody(map, opts).width).toBeGreaterThan(viewport.width);
    expect(decideInitialView(initialViewDecision(), map, opts, viewport).state).toEqual({
      phase: 'settled', autoSelectedNamed: false,
    });
  });

  it('waits through missing, empty and layer-only maps for the first nonempty snapshot', () => {
    let state = initialViewDecision();
    const pending = state;
    const map = groupedMap();
    for (const empty of [undefined, EMPTY_MAP, groupedMap(0)]) {
      const decision = decideInitialView(state, empty, opts, namedSize(map));
      expect(decision.zoom).toBeUndefined();
      state = decision.state;
      expect(state).toBe(pending);
    }
    expect(decideInitialView(state, map, opts, namedSize(map)).zoom).toBe(-4);
  });

  it('does not settle before a usable viewport exists', () => {
    const state = initialViewDecision();
    const map = groupedMap();
    for (const size of [{ width: 0, height: 20 }, { width: 80, height: 0 },
      { width: Number.NaN, height: 20 }, { width: 80, height: Infinity }]) {
      expect(decideInitialView(state, map, opts, size)).toEqual({ state, zoom: undefined });
    }
  });

  it('settles once even when no overview is chosen, so updates, resizes and pages cannot steal the view', () => {
    const map = groupedMap();
    for (const first of [map, must(removeGroup(map, group))]) {
      const state = decideInitialView(initialViewDecision(), first, opts, { width: 200, height: 100 }).state;
      expect(state).toEqual({ phase: 'settled', autoSelectedNamed: false });
      const changedPage = setTitle(groupedMap(12), 'Different page');
      expect(decideInitialView(state, changedPage, opts, namedSize(changedPage))).toEqual({ state, zoom: undefined });
    }
  });

  it('never reapplies a selected overview after later changes or cancellation attempts', () => {
    const map = groupedMap();
    const first = decideInitialView(initialViewDecision(), map, opts, namedSize(map));
    expect(first.state.autoSelectedNamed).toBe(true);
    expect(cancelInitialView(first.state)).toBe(first.state);
    expect(decideInitialView(first.state, map, opts, namedSize(map))).toEqual({ state: first.state, zoom: undefined });
  });

  it('lets manual input cancel pending selection before either loading or later population', () => {
    const map = groupedMap();
    let state = decideInitialView(initialViewDecision(), EMPTY_MAP, opts, namedSize(map)).state;
    state = cancelInitialView(state);
    expect(state).toEqual({ phase: 'cancelled', autoSelectedNamed: false });
    expect(cancelInitialView(state)).toBe(state);
    expect(decideInitialView(state, map, opts, namedSize(map))).toEqual({ state, zoom: undefined });
  });
});
