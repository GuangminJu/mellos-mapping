import { describe, expect, it } from 'vitest'
import type { MellosMap } from 'mellos-mapping/domain/types'
import { statusGlyph } from 'mellos-mapping/semantics'
import {
  SCALE_DEFAULT, SCALE_MAX, SCALE_MIN, clampScale, computeLayout, stepForScale, wrapChars,
} from 'mellos-mapping-dsh-client/src/client/layout.ts'

const MAP = {
  title: 'spec',
  layers: [
    { id: 'base', name: 'primitives', rank: 0 },
    { id: 'top', name: 'orchestration', rank: 1 },
  ],
  groups: [
    { id: 'core', label: 'core', layer: 'base' },
  ],
  lanes: [],
  nodes: [
    { id: 'a', label: 'Alpha', layer: 'base', status: 'done', group: 'core', evidence: 'tests pass', detail: 'the base' },
    { id: 'b', label: 'Beta', layer: 'base', status: 'done', group: 'core' },
    { id: 'up', label: 'Upper', layer: 'top', status: 'in-progress' },
  ],
  edges: [{ from: 'up', to: 'a', label: 'calls' }],
} as unknown as MellosMap

describe('scale policy and wrapChars', () => {
  it('derives the content step from continuous scale by thresholds', () => {
    expect([2.4, 1.55, 1.2, 1, 0.63, 0.62, 0.51, 0.5, 0.4].map(scale => stepForScale(scale)))
      .toEqual([2, 2, 1, 0, 0, -3, -3, -4, -4])
  })

  it('boundaries act as a Schmitt trigger when the current step is supplied', () => {
    // Just past the detail threshold going up: not cleared yet, stay plain.
    expect(stepForScale(1.21, 0)).toBe(0)
    expect(stepForScale(1.25, 0)).toBe(1)
    // Just back under it going down: stay unfolded until cleared.
    expect(stepForScale(1.19, 1)).toBe(1)
    expect(stepForScale(1.15, 1)).toBe(0)
    // No flap either around the overview boundary.
    expect(stepForScale(0.52, -4)).toBe(-4)
    expect(stepForScale(0.55, -4)).toBe(-3)
    // Without a current step the raw mapping stands.
    expect(stepForScale(1.21)).toBe(1)
    // Standard gesture landings clear the band: one wheel detent back from
    // the unfolded side (135% -> 116.2%) folds, and the +/- keys' double
    // press (156.25%) crosses into detail-plus — the same scale never shows
    // different content depending on the approach direction.
    expect(stepForScale(1.162, 1)).toBe(0)
    expect(stepForScale(1.5625, 1)).toBe(2)
  })

  it('clamps scale into the contract range; non-finite legacy values land on the default', () => {
    expect(clampScale(9)).toBe(SCALE_MAX)
    expect(clampScale(0.01)).toBe(SCALE_MIN)
    expect(clampScale(1.3)).toBe(1.3)
    expect(clampScale(Number.NaN)).toBe(SCALE_DEFAULT)
  })

  it('wraps by character budget with CJK counting double', () => {
    expect(wrapChars('abcdef', 3)).toEqual(['abc', 'def'])
    expect(wrapChars('地图地图', 4)).toEqual(['地图', '地图'])
    expect(wrapChars('', 4)).toEqual([])
  })
})

describe('computeLayout', () => {
  it('stacks bands top-down by descending rank with edges pointing down', () => {
    const layout = computeLayout(MAP, 0)
    expect(layout.bands.map(b => b.name)).toEqual(['orchestration', 'primitives'])
    const upper = layout.boxes.find(b => (b.node.id as string) === 'up')!
    const lower = layout.boxes.find(b => (b.node.id as string) === 'a')!
    expect(upper.y).toBeLessThan(lower.y)
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]).toMatchObject({ from: 'up', to: 'a', label: 'calls' })
    expect(layout.edges[0]!.y1).toBeLessThan(layout.edges[0]!.y2)
    expect(layout.aggregated).toBe(false)
  })

  it('prefixes dev labels with the status glyph, documentation labels with the kind glyph', () => {
    const dev = computeLayout(MAP, 0)
    const lineOf = (id: string): string | undefined =>
      dev.boxes.find(b => (b.node.id as string) === id)?.lines[0]?.text
    expect(lineOf('a')).toBe('■ Alpha')
    // The in-progress glyph comes from the shared vocabulary (one source for
    // terminal and browser), so the spec asserts the vocabulary, not a literal.
    expect(lineOf('up')).toBe(`${statusGlyph('in-progress', true)} Upper`)
    const doc = computeLayout({
      ...MAP,
      kind: 'architecture',
      groups: [],
      edges: [],
      nodes: [{ id: 's', label: 'Svc', layer: 'base', status: 'planned', kind: 'service' }],
    } as unknown as MellosMap, 0)
    expect(doc.boxes[0]?.lines[0]?.text).toBe('◆ Svc')
  })

  it('unfolds evidence and notes inside boxes at the detail steps only', () => {
    const standard = computeLayout(MAP, 0)
    const detail = computeLayout(MAP, 1)
    const boxAt = (l: typeof standard, id: string) => l.boxes.find(b => (b.node.id as string) === id)!
    expect(boxAt(standard, 'a').lines).toHaveLength(1)
    expect(boxAt(detail, 'a').lines.map(l => l.role)).toEqual(['label', 'evidence', 'note'])
    expect(boxAt(detail, 'a').h).toBeGreaterThan(boxAt(standard, 'a').h)
  })

  it('renders the aggregated map at the overview step: groups become the boxes', () => {
    const overview = computeLayout(MAP, -4)
    expect(overview.aggregated).toBe(true)
    const ids = overview.boxes.map(b => b.node.id as string)
    expect(ids).toContain('core')
    expect(ids).toContain('up')
    expect(ids).not.toContain('a')
    expect(overview.boxes.find(b => (b.node.id as string) === 'core')?.node.label).toBe('core 2/2')
  })

  it('carries member counts on the band rules at the tight steps', () => {
    expect(computeLayout(MAP, 0).bands[1]?.counts).toBeUndefined()
    expect(computeLayout(MAP, -3).bands[1]?.counts).toBe('2/2')
  })

  it('drops aligned adjacent edges straight and fans the rest onto claimed seats', () => {
    const wired = {
      ...MAP,
      groups: [],
      nodes: [
        { id: 'up', label: 'Upper', layer: 'top', status: 'done' },
        { id: 'a', label: 'Alpha', layer: 'base', status: 'done' },
        { id: 'b', label: 'Beta', layer: 'base', status: 'done' },
      ],
      edges: [{ from: 'up', to: 'a' }, { from: 'up', to: 'b' }],
    } as unknown as MellosMap
    const layout = computeLayout(wired, 0)
    const [one, two] = layout.edges
    // up sits over a: that edge is one vertical line, no corners — the
    // terminal pane's STRAIGHT preference.
    expect(one?.points).toHaveLength(2)
    expect(one?.x1).toBe(one?.x2)
    // up does not overlap b: that edge doglegs over a track row.
    expect(two?.points).toHaveLength(4)
    // The straight line claimed its column on the shared border, so the
    // dogleg's seat is nudged off it — the wires can never coincide.
    expect(one?.x1).not.toBe(two?.x1)
    expect(one?.midY).not.toBe(two?.midY)
    for (const wire of layout.edges) {
      expect(wire.midY).toBeGreaterThan(wire.y1)
      expect(wire.midY).toBeLessThan(wire.y2)
    }
  })

  it('packs runs onto shared track rows: disjoint runs share, overlapping runs split', () => {
    const laned = {
      ...MAP,
      groups: [],
      lanes: [
        { id: 'l1', label: 'A' }, { id: 'l2', label: 'B' },
        { id: 'l3', label: 'C' }, { id: 'l4', label: 'D' },
      ],
      nodes: [
        { id: 't1', label: 'T1', layer: 'top', status: 'done', lane: 'l1' },
        { id: 't2', label: 'T2', layer: 'top', status: 'done', lane: 'l3' },
        { id: 'b1', label: 'B1', layer: 'base', status: 'done', lane: 'l2' },
        { id: 'b2', label: 'B2', layer: 'base', status: 'done', lane: 'l4' },
      ],
      edges: [{ from: 't1', to: 'b1' }, { from: 't2', to: 'b2' }, { from: 't1', to: 'b2' }],
    } as unknown as MellosMap
    const layout = computeLayout(laned, 0)
    const edge = (from: string, to: string) => layout.edges.find(e => e.from === from && e.to === to)!
    // t1→b1 runs on the left, t2→b2 on the right: no horizontal overlap, so
    // they share one packed track row — the terminal pane's packing rule.
    expect(edge('t1', 'b1').midY).toBe(edge('t2', 'b2').midY)
    // t1→b2 spans the whole gap, overlapping both: it gets its own row.
    expect(edge('t1', 'b2').midY).not.toBe(edge('t1', 'b1').midY)
  })

  it('falls back to a right-margin column when no corridor crosses the intermediate band', () => {
    const long = {
      ...MAP,
      groups: [],
      layers: [
        { id: 'low', name: 'low', rank: 0 },
        { id: 'mid', name: 'mid', rank: 1 },
        { id: 'high', name: 'high', rank: 2 },
      ],
      nodes: [
        { id: 'c', label: 'C', layer: 'low', status: 'done' },
        { id: 'm', label: 'M', layer: 'mid', status: 'done' },
        { id: 'a', label: 'A', layer: 'high', status: 'done' },
      ],
      edges: [{ from: 'a', to: 'c', label: 'uses' }, { from: 'm', to: 'c' }],
    } as unknown as MellosMap
    const layout = computeLayout(long, 0)
    const longEdge = layout.edges.find(e => e.from === 'a' && e.to === 'c')!
    const adjacent = layout.edges.find(e => e.from === 'm' && e.to === 'c')!
    // The multi-band edge is a six-point polyline: source drop, entry run,
    // descent column, exit run, target drop — the intermediate band is bypassed.
    expect(longEdge.points).toHaveLength(6)
    const [p0, p1, p2, p3, p4, p5] = longEdge.points
    expect(p0![0]).toBe(p1![0])
    expect(p1![1]).toBe(p2![1])
    expect(p2![0]).toBe(p3![0])
    expect(p3![1]).toBe(p4![1])
    expect(p4![0]).toBe(p5![0])
    // The single mid box spans the whole band, so no corridor exists and the
    // descent column retreats past every box into the right margin.
    const rightmost = Math.max(...layout.boxes.map(b => b.x + b.w))
    expect(p2![0]).toBeGreaterThan(rightmost)
    expect(p3![0]).toBeGreaterThan(rightmost)
    // Every point stays out of the middle band's box row: the runs live in the
    // empty strips above and below it, never behind its boxes.
    const mid = layout.boxes.find(b => (b.node.id as string) === 'm')!
    for (const [, y] of longEdge.points) {
      expect(y < mid.y || y >= mid.y + mid.h).toBe(true)
    }
    // The stacked adjacent edge drops straight — one vertical line.
    expect(adjacent.points).toHaveLength(2)
    // Both edges still point downward with their runs between the endpoints.
    for (const wire of layout.edges) {
      expect(wire.y1).toBeLessThan(wire.y2)
      expect(wire.midY).toBeGreaterThan(wire.y1)
      expect(wire.midY).toBeLessThan(wire.y2)
    }
  })

  it('threads a multi-band edge through the gap between intermediate boxes', () => {
    const threaded = {
      ...MAP,
      groups: [],
      layers: [
        { id: 'low', name: 'low', rank: 0 },
        { id: 'mid', name: 'mid', rank: 1 },
        { id: 'high', name: 'high', rank: 2 },
      ],
      nodes: [
        { id: 'c', label: 'C', layer: 'low', status: 'done' },
        { id: 'm1', label: 'M1', layer: 'mid', status: 'done' },
        { id: 'm2', label: 'M2', layer: 'mid', status: 'done' },
        { id: 'a', label: 'A', layer: 'high', status: 'done' },
      ],
      edges: [{ from: 'a', to: 'c' }],
    } as unknown as MellosMap
    const layout = computeLayout(threaded, 0)
    const wire = layout.edges[0]!
    expect(wire.points).toHaveLength(6)
    const descent = wire.points[2]![0]
    const m1 = layout.boxes.find(b => (b.node.id as string) === 'm1')!
    const m2 = layout.boxes.find(b => (b.node.id as string) === 'm2')!
    // The descent column threads the needle between the two mid boxes —
    // through the picture, not around it.
    expect(descent).toBeGreaterThan(m1.x + m1.w)
    expect(descent).toBeLessThan(m2.x)
    // Threading means no margin fallback: the canvas keeps its content width.
    expect(descent).toBeLessThan(Math.max(...layout.boxes.map(b => b.x + b.w)))
  })

  it('aligns lane members under their column across bands', () => {
    const laned = {
      ...MAP,
      lanes: [{ id: 'left', label: 'L' }, { id: 'right', label: 'R' }],
      nodes: [
        { id: 'a', label: 'Alpha', layer: 'base', status: 'done', lane: 'right' },
        { id: 'up', label: 'Upper', layer: 'top', status: 'planned', lane: 'right' },
        { id: 'free', label: 'Free', layer: 'base', status: 'planned' },
      ],
      groups: [],
      edges: [],
    } as unknown as MellosMap
    const layout = computeLayout(laned, 0)
    expect(layout.lanes.map(l => l.label)).toEqual(['L', 'R'])
    const a = layout.boxes.find(b => (b.node.id as string) === 'a')!
    const up = layout.boxes.find(b => (b.node.id as string) === 'up')!
    const free = layout.boxes.find(b => (b.node.id as string) === 'free')!
    expect(a.x).toBe(up.x)
    expect(free.x).toBeGreaterThan(a.x)
  })
})
