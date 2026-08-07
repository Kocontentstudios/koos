"use client";

import { useEffect, useRef, useState } from "react";
import type { AnnotationShape } from "@/lib/db/queries";
import {
  type Point,
  type Size,
  toPixels,
} from "@/lib/design/annotation-geometry";
import { cn } from "@/lib/utils";

type AnnotationOverlayProps = {
  imageUrl: string;
  shapes: AnnotationShape[];
  alt?: string;
  className?: string;
};

// Rows come from jsonb with no schema-level guarantee, so a shape saved
// before server-side validation existed (or written directly to the DB)
// must not be able to throw during render.
function shapeToPixelPoints(shape: AnnotationShape, size: Size): Point[] {
  if (!Array.isArray(shape.coords)) return [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < shape.coords.length; i += 2) {
    const x = shape.coords[i];
    const y = shape.coords[i + 1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    points.push(toPixels({ x, y }, size));
  }
  return points;
}

/** Read-only render of saved annotation shapes over a deliverable image, so
 * the design team sees exactly what a reviewer marked up — no drawing tools. */
export function AnnotationOverlay({
  imageUrl,
  shapes,
  alt = "Deliverable with reviewer annotations",
  className,
}: AnnotationOverlayProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  // Overlay only has a size once the image has laid out client-side; stays
  // null through SSR so no canvas/SVG geometry is computed on the server.
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;

    const measure = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-surface-1",
        className,
      )}
    >
      {/** biome-ignore lint/performance/noImgElement: arbitrary delivered design assets, not an optimizable static asset */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt={alt}
        onLoad={() => {
          const el = imgRef.current;
          if (el && el.clientWidth > 0 && el.clientHeight > 0) {
            setSize({ w: el.clientWidth, h: el.clientHeight });
          }
        }}
        className="block w-full select-none"
        draggable={false}
      />
      {size && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          aria-hidden="true"
        >
          {shapes.map((shape, index) => {
            if (!shape || !Array.isArray(shape.coords)) return null;
            const points = shapeToPixelPoints(shape, size);
            if (shape.type === "rect") {
              const [p0, p1] = points;
              if (!p0 || !p1) return null;
              return (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: shapes are a static, read-only snapshot with no stable id
                  key={index}
                  x={Math.min(p0.x, p1.x)}
                  y={Math.min(p0.y, p1.y)}
                  width={Math.abs(p1.x - p0.x)}
                  height={Math.abs(p1.y - p0.y)}
                  fill="none"
                  stroke={shape.color}
                  strokeWidth={2}
                />
              );
            }
            if (shape.type === "path") {
              return (
                <polyline
                  // biome-ignore lint/suspicious/noArrayIndexKey: shapes are a static, read-only snapshot with no stable id
                  key={index}
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={shape.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            return null;
          })}
        </svg>
      )}
    </div>
  );
}
