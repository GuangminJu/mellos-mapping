import { describe, expect, it } from 'vitest'
import { wheelScaleFactor, type WheelFacts } from 'mellos-mapping-dsh-client/src/client/wheel.ts'

const facts = (deltaY: number, extra?: Partial<WheelFacts>): WheelFacts =>
  ({ deltaY, deltaMode: 0, ctrlKey: false, ...extra })

describe('wheelScaleFactor', () => {
  it('one mouse detent zooms about sixteen percent, symmetric both ways', () => {
    expect(wheelScaleFactor(facts(-100))).toBeCloseTo(1.162, 3)
    expect(wheelScaleFactor(facts(100)) * wheelScaleFactor(facts(-100))).toBeCloseTo(1, 10)
  })

  it('equal travel means equal ratio, however many events carry it', () => {
    const flick = Array.from({ length: 25 }, () => facts(-12))
    const composed = flick.reduce((scale, e) => scale * wheelScaleFactor(e), 1)
    expect(composed).toBeCloseTo(wheelScaleFactor(facts(-300)), 10)
  })

  it('a momentum tail decays toward factor one instead of drilling on', () => {
    expect(wheelScaleFactor(facts(-2))).toBeCloseTo(1.003, 3)
    expect(wheelScaleFactor(facts(-2))).toBeLessThan(wheelScaleFactor(facts(-60)))
  })

  it('line-mode deltas convert at the classic line height', () => {
    expect(wheelScaleFactor(facts(-3, { deltaMode: 1 }))).toBeCloseTo(wheelScaleFactor(facts(-120)), 10)
  })

  it('pinch (ctrl+wheel) zooms faster per pixel of travel', () => {
    expect(wheelScaleFactor(facts(-10, { ctrlKey: true }))).toBeGreaterThan(wheelScaleFactor(facts(-10)))
  })

  it('a zero delta is inert', () => {
    expect(wheelScaleFactor(facts(0))).toBe(1)
  })
})
