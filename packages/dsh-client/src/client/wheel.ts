/**
 * Wheel-to-scale: continuous exponential zoom, the canvas-app native feel.
 *
 * Real devices disagree wildly on wheel granularity — a mouse emits one
 * ~100px pixel-mode event per detent (line-mode browsers report whole
 * lines), a touchpad emits dozens of tiny events per flick plus a decaying
 * momentum tail, and a pinch arrives as ctrl+wheel with tiny deltas. An
 * exponential factor per event absorbs all of that by construction: equal
 * travel means equal zoom ratio regardless of how many events carry it, a
 * momentum tail decays into ever-smaller ratios instead of drilling on, and
 * no step quantization exists to slam.
 */

/** Pixel worth of one line/page-mode unit (the classic wheel-line height). */
const LINE_PX = 40
/** e-fold zoom per pixel of wheel travel: one ~100px detent ≈ ×1.16. */
const ZOOM_RATE = 0.0015
/** Pinch ctrl+wheel deltas are tiny but deliberate; zoom faster per pixel. */
const PINCH_RATE = 0.005

/** The wheel facts read here; a DOM WheelEvent satisfies it. */
export interface WheelFacts {
  readonly deltaY: number
  /** 0 = pixels, 1 = lines, 2 = pages (DOM deltaMode). */
  readonly deltaMode: number
  /** Pinch gestures arrive as ctrl+wheel. */
  readonly ctrlKey: boolean
}

/**
 * The multiplicative scale factor one wheel event contributes.
 * @param event - wheel facts of the incoming event.
 * @returns factor > 1 for wheel-up (zoom in), < 1 for wheel-down, 1 for zero delta.
 */
export function wheelScaleFactor(event: WheelFacts): number {
  const px = event.deltaMode === 0 ? event.deltaY : event.deltaY * LINE_PX
  return Math.exp(-px * (event.ctrlKey ? PINCH_RATE : ZOOM_RATE))
}
