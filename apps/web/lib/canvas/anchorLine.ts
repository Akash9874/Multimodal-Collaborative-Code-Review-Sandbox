import type { Point, Shape } from '@sandbox/shared';

/** The highest point of a shape in content space — the point its anchor binds to. */
export const topmostPoint = (shape: Shape): Point => {
  switch (shape.kind) {
    case 'freehand':
      return shape.points.reduce((top, point) => (point.y < top.y ? point : top), shape.points[0]!);
    case 'arrow':
    case 'rect':
      return shape.from.y <= shape.to.y ? shape.from : shape.to;
    case 'text':
      return shape.at;
  }
};

/**
 * Content-space y → 1-based line number, by binary search for the last line whose top is at or
 * above `y`.
 *
 * `Math.floor(y / lineHeight) + 1` is shorter and wrong: it assumes every line has the same
 * height, which wrapped lines and view zones break. Monaco is the authority on where a line
 * starts, so ask it — `O(log n)` times, assuming nothing.
 */
export const lineAtContentY = (
  y: number,
  lineCount: number,
  topForLine: (line: number) => number,
): number => {
  let low = 1;
  let high = Math.max(1, lineCount);

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (topForLine(mid) <= y) low = mid;
    else high = mid - 1;
  }

  return low;
};
