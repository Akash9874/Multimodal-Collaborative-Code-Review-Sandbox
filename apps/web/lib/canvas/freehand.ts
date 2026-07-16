import getStroke from 'perfect-freehand';
import type { Point } from '@sandbox/shared';

const average = (a: number, b: number): number => (a + b) / 2;

/** Outline points → a smooth SVG path, the standard perfect-freehand recipe. */
const toSvgPath = (points: number[][]): string => {
  if (points.length === 0) return '';

  const first = points[0]!;
  let d = `M ${first[0]!.toFixed(2)} ${first[1]!.toFixed(2)} Q`;

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]! as [number, number];
    const [x1, y1] = points[i + 1]! as [number, number];
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${average(x0, x1).toFixed(2)} ${average(y0, y1).toFixed(2)}`;
  }

  return `${d} Z`;
};

/** A freehand stroke as a filled SVG outline path. `width` scales the pen. */
export const freehandPath = (points: Point[], width: number): string => {
  if (points.length === 0) return '';

  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.p ?? 0.5]),
    { size: width * 2, thinning: 0.5, smoothing: 0.5, streamline: 0.5 },
  );

  return toSvgPath(outline);
};
