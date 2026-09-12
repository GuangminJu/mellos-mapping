export interface Viewport { readonly x: number; readonly y: number; readonly scale: number }
/** Project the viewport into SVG user space; native SVG redraws at display resolution. */
export function svgViewBox(view: Viewport, width: number, height: number): string {
  return `${-view.x / view.scale} ${-view.y / view.scale} ${Math.max(1, width) / view.scale} ${Math.max(1, height) / view.scale}`;
}
export const clampScale = (scale: number): number => Math.max(0.15, Math.min(2.5, scale));
export function fitViewport(width: number, height: number, sceneWidth: number, sceneHeight: number): Viewport {
  const scale = Math.max(0.15, Math.min(1, (width - 48) / sceneWidth, (height - 32) / sceneHeight));
  return { scale, x: (width - sceneWidth * scale) / 2, y: Math.max(16, (height - sceneHeight * scale) / 2) };
}
/** Keep the world point below the cursor fixed while zooming. */
export function zoomViewport(view: Viewport, scale: number, x: number, y: number): Viewport {
  const next = clampScale(scale), ratio = next / view.scale;
  return { scale: next, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
