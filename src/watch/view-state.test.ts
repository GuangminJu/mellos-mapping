import { describe, expect, it } from 'vitest';
import { initialViewState, reduceView, clickNode, isPointerClick } from './view-state.js';
import { clampZoom } from '../semantics/semantics.js';

describe('view event sequences', () => {
  it('restores page pan, zoom and selection without carrying an active gesture across pages', () => {
    const initial = initialViewState();
    let state = reduceView(initial, { kind: 'pan', dx: 12, dy: 8 });
    state = reduceView(state, { kind: 'zoom', value: clampZoom(-2) });
    state = reduceView(state, { kind: 'select', id: 'a-node' });
    state = reduceView(state, { kind: 'down', x: 5, y: 5, divider: false });
    state = reduceView(state, { kind: 'pages', files: ['a', 'b'], previous: 'a', active: 'b' });
    expect(state.offsetX).toBe(0);
    expect(isPointerClick(state)).toBe(false);
    state = reduceView(state, { kind: 'pan', dx: 3, dy: 2 });
    state = reduceView(state, { kind: 'pages', files: ['a', 'b'], previous: 'b', active: 'a' });
    expect(state).toMatchObject({ offsetX: 12, offsetY: 8, zoom: -2, selectedId: 'a-node' });
    expect(initial.offsetX).toBe(0);
    expect(initial.pageViews.size).toBe(0);
  });

  it('does not resurrect a deleted page view when leaving it or later recreating the page', () => {
    let state = reduceView(initialViewState(), { kind: 'pan', dx: 50, dy: 10 });
    state = reduceView(state, { kind: 'pages', files: ['b'], previous: 'a', active: 'b' });
    expect(state.pageViews.has('a')).toBe(false);
    state = reduceView(state, { kind: 'pages', files: ['a', 'b'], previous: 'b', active: 'a' });
    expect(state.offsetX).toBe(0);
  });

  it('keeps dragging and divider resizing distinct from clicks, even after returning to the starting cell', () => {
    let state = reduceView(initialViewState(), { kind: 'down', x: 8, y: 5, divider: false });
    expect(isPointerClick(state)).toBe(true);
    state = reduceView(state, { kind: 'drag', x: 6, y: 4 });
    expect(state).toMatchObject({ offsetX: 2, offsetY: 1 });
    state = reduceView(state, { kind: 'drag', x: 8, y: 5 });
    expect(isPointerClick(state)).toBe(false);
    state = reduceView(state, { kind: 'up' });
    state = reduceView(state, { kind: 'down', x: 4, y: 9, divider: true });
    expect(isPointerClick(state)).toBe(false);
    expect(reduceView(state, { kind: 'drag', x: 5, y: 7 })).toBe(state);
    state = reduceView(state, { kind: 'up' });
    expect(state.dividerDrag).toBe(false);
  });

  it('double-clicks only the same node in the same page within the time window', () => {
    let result = clickNode(initialViewState(), 'node', 100, 450);
    expect(result.diveId).toBeUndefined();
    expect(clickNode(result.state, 'node', 550, 450).diveId).toBe('node');
    expect(clickNode(result.state, 'node', 551, 450).diveId).toBeUndefined();
    expect(clickNode(result.state, 'different', 120, 450).diveId).toBeUndefined();
    const changed = reduceView(result.state, { kind: 'pages', files: ['a', 'b'], previous: 'a', active: 'b' });
    expect(clickNode(changed, 'node', 130, 450).diveId).toBeUndefined();
  });
});
