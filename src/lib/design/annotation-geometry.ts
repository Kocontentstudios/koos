export type Point = { x: number; y: number };
export type Size = { w: number; h: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function toNormalized(px: Point, size: Size): Point {
  return {
    x: clamp01(px.x / size.w),
    y: clamp01(px.y / size.h),
  };
}

export function toPixels(norm: Point, size: Size): Point {
  return {
    x: clamp01(norm.x) * size.w,
    y: clamp01(norm.y) * size.h,
  };
}
