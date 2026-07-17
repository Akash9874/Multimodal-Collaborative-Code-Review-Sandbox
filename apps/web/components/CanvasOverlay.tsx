'use client';

import {
  type DraftStroke,
  STROKE_WIDTH,
  type Shape,
  type Stroke,
  appendStroke,
  eraseStroke,
} from '@sandbox/shared';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { useCanvas } from '@/lib/canvas/CanvasContext';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
import { type DrawTool, buildShape } from '@/lib/canvas/draft';
import { freehandPath } from '@/lib/canvas/freehand';
import { hits } from '@/lib/canvas/hitTest';
import { toContentPoint } from '@/lib/canvas/coords';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useStrokes } from '@/lib/yjs/useStrokes';

const ERASER_TOLERANCE = 8;
const DRAFT_THROTTLE_MS = 40;
const DRAW_TOOLS: DrawTool[] = ['freehand', 'arrow', 'rect'];

/** One shape → its SVG element. Used for committed strokes, live drafts, and remote drafts. */
function ShapeView({ shape, color, opacity = 1 }: { shape: Shape; color: string; opacity?: number }) {
  switch (shape.kind) {
    case 'freehand':
      return <path d={freehandPath(shape.points, STROKE_WIDTH)} fill={color} opacity={opacity} />;
    case 'arrow': {
      const { from, to } = shape;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = 10;
      const left = { x: to.x - head * Math.cos(angle - Math.PI / 6), y: to.y - head * Math.sin(angle - Math.PI / 6) };
      const right = { x: to.x - head * Math.cos(angle + Math.PI / 6), y: to.y - head * Math.sin(angle + Math.PI / 6) };
      return (
        <g stroke={color} strokeWidth={STROKE_WIDTH} fill={color} opacity={opacity}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          <polygon points={`${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`} />
        </g>
      );
    }
    case 'rect': {
      const { from, to } = shape;
      return (
        <rect
          x={Math.min(from.x, to.x)}
          y={Math.min(from.y, to.y)}
          width={Math.abs(to.x - from.x)}
          height={Math.abs(to.y - from.y)}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          opacity={opacity}
        />
      );
    }
    case 'text':
      return (
        <text x={shape.at.x} y={shape.at.y} fill={color} fontSize={14} opacity={opacity}>
          {shape.text}
        </text>
      );
  }
}

export function CanvasOverlay({ instance }: { instance: editor.IStandaloneCodeEditor }) {
  const { doc, awareness } = useRoomContext();
  const { mode, tool, user } = useCanvas();
  const { activeFileId } = useActiveFile();
  const strokes = useStrokes(activeFileId);

  const [scroll, setScroll] = useState({ left: instance.getScrollLeft(), top: instance.getScrollTop() });
  const [drafts, setDrafts] = useState<DraftStroke[]>([]); // remote, from awareness
  const [localDraft, setLocalDraft] = useState<Shape | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  const drawing = useRef<{ points: { x: number; y: number }[] } | null>(null);
  const lastBroadcast = useRef(0);
  const svg = useRef<SVGSVGElement>(null);

  // Keep the strokes group in step with Monaco's scroll. This is what pins a stroke to its code.
  useEffect(() => {
    const sub = instance.onDidScrollChange(() =>
      setScroll({ left: instance.getScrollLeft(), top: instance.getScrollTop() }),
    );
    return () => sub.dispose();
  }, [instance]);

  // Draw mode makes the editor read-only, so a stray keystroke cannot edit code while you draw.
  useEffect(() => {
    instance.updateOptions({ readOnly: mode === 'draw' });
  }, [instance, mode]);

  // Collect every peer's in-progress draft from awareness (mine is rendered from localDraft).
  // Filtered by file: an unfiltered draft would scribble a remote pen across a file you are not
  // looking at, at coordinates that mean nothing where they land.
  useEffect(() => {
    const read = () => {
      const mine = awareness.clientID;
      const next: DraftStroke[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== mine && state?.draft?.fileId === activeFileId) next.push(state.draft);
      });
      setDrafts(next);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness, activeFileId]);

  const pointFromEvent = (event: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return toContentPoint(event.clientX, event.clientY, rect, {
      left: instance.getScrollLeft(),
      top: instance.getScrollTop(),
    });
  };

  const broadcastDraft = (shape: Shape) => {
    const now = Date.now();
    if (now - lastBroadcast.current < DRAFT_THROTTLE_MS) return;
    lastBroadcast.current = now;
    awareness.setLocalStateField('draft', {
      fileId: activeFileId,
      color: user.color,
      width: STROKE_WIDTH,
      shape,
    } satisfies DraftStroke);
  };

  const clearDraft = () => {
    drawing.current = null;
    setLocalDraft(null);
    awareness.setLocalStateField('draft', undefined);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (mode !== 'draw') return;
    const point = pointFromEvent(event);

    if (tool === 'text') {
      setTextAt(point);
      setTextValue('');
      return;
    }
    if (tool === 'eraser') {
      for (const stroke of strokes) if (hits(stroke, point, ERASER_TOLERANCE)) eraseStroke(doc, stroke.id);
      drawing.current = { points: [point] };
      return;
    }

    (event.target as Element).setPointerCapture(event.pointerId);
    drawing.current = { points: [point] };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (mode !== 'draw' || !drawing.current) return;
    const point = pointFromEvent(event);
    drawing.current.points.push(point);

    if (tool === 'eraser') {
      for (const stroke of strokes) if (hits(stroke, point, ERASER_TOLERANCE)) eraseStroke(doc, stroke.id);
      return;
    }

    const shape = buildShape(tool as DrawTool, drawing.current.points);
    if (shape) {
      setLocalDraft(shape);
      broadcastDraft(shape);
    }
  };

  const onPointerUp = () => {
    if (mode !== 'draw' || !drawing.current) return;
    if (tool === 'eraser') {
      drawing.current = null;
      return;
    }

    const shape = DRAW_TOOLS.includes(tool as DrawTool)
      ? buildShape(tool as DrawTool, drawing.current.points)
      : null;

    if (shape) {
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: activeFileId,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape,
        createdAt: Date.now(),
      });
    }
    clearDraft();
  };

  const commitText = () => {
    const text = textValue.trim();
    if (textAt && text) {
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: activeFileId,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape: { kind: 'text', at: textAt, text },
        createdAt: Date.now(),
      });
    }
    setTextAt(null);
    setTextValue('');
  };

  return (
    <svg
      ref={svg}
      data-testid="canvas"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: mode === 'draw' ? 'auto' : 'none', cursor: mode === 'draw' ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <g transform={`translate(${-scroll.left}, ${-scroll.top})`}>
        {strokes.map((stroke: Stroke) => (
          <g key={stroke.id} data-testid="stroke">
            <ShapeView shape={stroke.shape} color={stroke.color} />
          </g>
        ))}
        {drafts.map((draft, i) => (
          <ShapeView key={`remote-${i}`} shape={draft.shape} color={draft.color} opacity={0.6} />
        ))}
        {localDraft && <ShapeView shape={localDraft} color={user.color} opacity={0.8} />}
        {textAt && (
          <foreignObject x={textAt.x} y={textAt.y - 18} width={200} height={28}>
            <input
              aria-label="Text annotation"
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') {
                  setTextAt(null);
                  setTextValue('');
                }
              }}
              className="w-full rounded border border-neutral-600 bg-neutral-900 px-1 text-sm text-white"
            />
          </foreignObject>
        )}
      </g>
    </svg>
  );
}
