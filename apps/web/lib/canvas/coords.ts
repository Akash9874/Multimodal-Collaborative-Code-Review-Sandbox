import type { Point } from '@sandbox/shared';

export type Scroll = { left: number; top: number };
export type Rect = { left: number; top: number };

/**
 * Screen coordinates → Monaco content space. The SVG strokes group is then transformed by
 * translate(−scrollLeft, −scrollTop), so a point stored here lands on the same code for every
 * viewer, whatever their scroll offset. Screen-space storage breaks the moment two people scroll
 * differently — which is most of the time.
 */
export const toContentPoint = (
  clientX: number,
  clientY: number,
  rect: Rect,
  scroll: Scroll,
): Point => ({
  x: clientX - rect.left + scroll.left,
  y: clientY - rect.top + scroll.top,
});
