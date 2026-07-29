"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnnotationShape } from "@/lib/db/queries";
import {
  type Point,
  type Size,
  toNormalized,
  toPixels,
} from "@/lib/design/annotation-geometry";
import { cn } from "@/lib/utils";

type Tool = "rect" | "freehand";

type Mark = {
  id: string;
  shape: AnnotationShape;
  note: string;
};

/** One authored mark: a single shape plus its optional note, matching the
 * `addAnnotation` API's `{ shapes, note }` input shape. */
export type AnnotationCanvasMark = {
  shapes: AnnotationShape[];
  note?: string;
};

type AnnotationCanvasProps = {
  imageUrl: string;
  onChange: (annotations: AnnotationCanvasMark[]) => void;
  className?: string;
};

// A small, fixed palette keeps color choice a one-tap decision instead of a
// full picker; users distinguish marks by clicking a different swatch before
// drawing the next one.
const COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6"] as const;

// Freehand points are only recorded past this pixel spacing so a slow drag
// doesn't balloon the coords array with near-duplicate points.
const FREEHAND_MIN_STEP_PX = 3;

// Below this normalized delta a "rectangle" is really just a stray click, not
// an intentional mark.
const MIN_RECT_SIZE = 0.005;

type Drawing =
  | { type: "rect"; start: Point; end: Point }
  | { type: "path"; points: Point[] };

function createMarkId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function shapeToPixelPoints(shape: AnnotationShape, size: Size): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < shape.coords.length; i += 2) {
    points.push(toPixels({ x: shape.coords[i], y: shape.coords[i + 1] }, size));
  }
  return points;
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  p0: Point,
  p1: Point,
  strokeColor: string,
  lineWidth = 2,
) {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(
    Math.min(p0.x, p1.x),
    Math.min(p0.y, p1.y),
    Math.abs(p1.x - p0.x),
    Math.abs(p1.y - p0.y),
  );
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  strokeColor: string,
  lineWidth = 2,
) {
  if (points.length < 2) return;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

export function AnnotationCanvas({
  imageUrl,
  onChange,
  className,
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Drawing | null>(null);

  const [size, setSize] = useState<Size | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);

  const measure = useCallback(() => {
    const el = imgRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const emit = useCallback(
    (next: Mark[]) => {
      onChange(
        next.map((m) => ({
          shapes: [m.shape],
          note: m.note.trim() ? m.note : undefined,
        })),
      );
    },
    [onChange],
  );

  const updateMarks = useCallback(
    (updater: (prev: Mark[]) => Mark[]) => {
      setMarks((prev) => {
        const next = updater(prev);
        emit(next);
        return next;
      });
    },
    [emit],
  );

  // Redraw imperatively rather than diffing a virtual DOM: canvas has no
  // reconciled tree, so every relevant state change repaints from scratch.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    for (const mark of marks) {
      const points = shapeToPixelPoints(mark.shape, size);
      const isActive = mark.id === activeMarkId;
      if (isActive) {
        if (mark.shape.type === "rect") {
          drawRect(ctx, points[0], points[1], "rgba(255,255,255,0.9)", 5);
        } else {
          drawPath(ctx, points, "rgba(255,255,255,0.9)", 5);
        }
      }
      if (mark.shape.type === "rect") {
        drawRect(ctx, points[0], points[1], mark.shape.color);
      } else {
        drawPath(ctx, points, mark.shape.color);
      }
    }

    if (draft) {
      if (draft.type === "rect") {
        drawRect(ctx, draft.start, draft.end, color);
      } else {
        drawPath(ctx, draft.points, color);
      }
    }
  }, [marks, draft, size, color, activeMarkId]);

  function pointerPosition(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!size) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = pointerPosition(e);
    const drawing: Drawing =
      tool === "rect"
        ? { type: "rect", start: point, end: point }
        : { type: "path", points: [point] };
    drawingRef.current = drawing;
    setDraft(drawing);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const point = pointerPosition(e);
    if (drawing.type === "rect") {
      drawing.end = point;
    } else {
      const last = drawing.points[drawing.points.length - 1];
      const farEnough =
        !last ||
        Math.hypot(point.x - last.x, point.y - last.y) >= FREEHAND_MIN_STEP_PX;
      if (!farEnough) return;
      drawing.points.push(point);
    }
    setDraft(
      drawing.type === "rect"
        ? { ...drawing }
        : { type: "path", points: [...drawing.points] },
    );
  }

  function handlePointerUp() {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    setDraft(null);
    if (!drawing || !size) return;

    let shape: AnnotationShape;
    if (drawing.type === "rect") {
      const p0 = toNormalized(drawing.start, size);
      const p1 = toNormalized(drawing.end, size);
      const negligible =
        Math.abs(p1.x - p0.x) < MIN_RECT_SIZE &&
        Math.abs(p1.y - p0.y) < MIN_RECT_SIZE;
      if (negligible) return;
      shape = { type: "rect", coords: [p0.x, p0.y, p1.x, p1.y], color };
    } else {
      if (drawing.points.length < 2) return;
      const coords = drawing.points.flatMap((p) => {
        const n = toNormalized(p, size);
        return [n.x, n.y];
      });
      shape = { type: "path", coords, color };
    }

    const mark: Mark = { id: createMarkId(), shape, note: "" };
    setActiveMarkId(mark.id);
    updateMarks((prev) => [...prev, mark]);
  }

  function updateNote(id: string, note: string) {
    updateMarks((prev) => prev.map((m) => (m.id === id ? { ...m, note } : m)));
  }

  function removeMark(id: string) {
    updateMarks((prev) => prev.filter((m) => m.id !== id));
    setActiveMarkId((current) => (current === id ? null : current));
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
          <Button
            type="button"
            size="sm"
            variant={tool === "rect" ? "secondary" : "ghost"}
            aria-pressed={tool === "rect"}
            onClick={() => setTool("rect")}
          >
            Rectangle
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "freehand" ? "secondary" : "ghost"}
            aria-pressed={tool === "freehand"}
            onClick={() => setTool("freehand")}
          >
            Freehand
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use ${swatch} for the next mark`}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
              className={cn(
                "size-6 rounded-full border-2 transition-transform",
                color === swatch
                  ? "scale-110 border-foreground"
                  : "border-transparent",
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-surface-1"
      >
        {/** biome-ignore lint/performance/noImgElement: arbitrary delivered design assets, not an optimizable static asset */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Design deliverable to annotate"
          onLoad={measure}
          className="block w-full select-none"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="absolute inset-0 touch-none"
        />
      </div>

      <ul className="space-y-2">
        {marks.map((mark, index) => (
          <li
            key={mark.id}
            className={cn(
              "flex items-start gap-2 rounded-lg border p-2.5 transition-colors",
              mark.id === activeMarkId
                ? "border-[var(--border-accent)]"
                : "border-[var(--border)]",
            )}
          >
            <button
              type="button"
              onClick={() => setActiveMarkId(mark.id)}
              className="mt-1 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: mark.shape.color }}
              aria-label={`Highlight mark ${index + 1}`}
            />
            <input
              value={mark.note}
              onChange={(e) => updateNote(mark.id, e.target.value)}
              onFocus={() => setActiveMarkId(mark.id)}
              placeholder={`Note for mark ${index + 1}`}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-[13px] text-foreground outline-none focus-visible:border-[var(--border-accent)]"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove mark ${index + 1}`}
              onClick={() => removeMark(mark.id)}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
