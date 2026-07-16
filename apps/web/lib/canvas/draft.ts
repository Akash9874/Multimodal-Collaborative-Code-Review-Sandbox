import type { Point, Shape } from '@sandbox/shared';

export type DrawTool = 'freehand' | 'arrow' | 'rect';

/**
 * Turn a pointer path into an in-progress shape, or null if it is degenerate (a stray click, a
 * single point). The overlay calls this on every move to render the live draft, and once more on
 * pointer-up to decide whether there is anything worth committing.
 */
export const buildShape = (tool: DrawTool, points: Point[]): Shape | null => {
  if (points.length < 2) return null;

  const from = points[0]!;
  const to = points[points.length - 1]!;

  if (tool === 'freehand') return { kind: 'freehand', points };

  // A drag that never moved is a click, not a shape.
  if (from.x === to.x && from.y === to.y) return null;

  return tool === 'arrow' ? { kind: 'arrow', from, to } : { kind: 'rect', from, to };
};
