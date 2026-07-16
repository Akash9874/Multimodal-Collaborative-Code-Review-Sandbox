import type { Point, Stroke } from '@sandbox/shared';

/** Approx glyph metrics for the text hit-box — good enough for an eraser, not for layout. */
const TEXT_CHAR_WIDTH = 8;
const TEXT_HEIGHT = 16;

const distToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const nearPolyline = (points: Point[], p: Point, tolerance: number): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(p, points[i]!, points[i + 1]!) <= tolerance) return true;
  }
  return false;
};

/** True if `point` is within `tolerance` of the stroke (its outline, for a rect). */
export const hits = (stroke: Stroke, point: Point, tolerance: number): boolean => {
  const shape = stroke.shape;
  switch (shape.kind) {
    case 'freehand':
      return nearPolyline(shape.points, point, tolerance);
    case 'arrow':
      return distToSegment(point, shape.from, shape.to) <= tolerance;
    case 'rect': {
      const { from, to } = shape;
      const corners = [
        { x: from.x, y: from.y },
        { x: to.x, y: from.y },
        { x: to.x, y: to.y },
        { x: from.x, y: to.y },
        { x: from.x, y: from.y },
      ];
      return nearPolyline(corners, point, tolerance);
    }
    case 'text': {
      const width = Math.max(1, shape.text.length) * TEXT_CHAR_WIDTH;
      const top = shape.at.y - TEXT_HEIGHT;
      return (
        point.x >= shape.at.x - tolerance &&
        point.x <= shape.at.x + width + tolerance &&
        point.y >= top - tolerance &&
        point.y <= shape.at.y + tolerance
      );
    }
  }
};
