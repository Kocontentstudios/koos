import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The viewport widths the lane renders at, derived from the breakpoints src
 * actually writes. Every breakpoint splits the width axis; the lane renders
 * one width in every band between them, so an element shown only in some
 * band (`md:hidden`, `max-[1400px]:inline`, a landing.css media query) is on
 * screen in at least one pass. Writing a new breakpoint adds a pass.
 */

/* Tailwind v4's defaults; globals.css does not override them. */
const TAILWIND: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

const PX_PER_REM = 16;
const toPx = (value: number, unit: string) =>
  unit === "px" ? value : value * PX_PER_REM;

/** The first width at which each breakpoint's styles change, from one
 * source file. `min-width: N` and Tailwind's `md:` / `min-[N]:` turn on at N;
 * Tailwind's `max-md:` / `max-[N]:` are `width < N`, so they change at N too;
 * a CSS `max-width: N` holds up to and including N, so it changes at N + 1. */
export function thresholdsIn(source: string, isCss: boolean): number[] {
  const found: number[] = [];
  if (isCss) {
    for (const m of source.matchAll(
      /\((min|max)-width:\s*([\d.]+)(px|rem|em)\s*\)/g,
    )) {
      const px = toPx(Number(m[2]), m[3]);
      found.push(m[1] === "min" ? px : px + 1);
    }
    return found;
  }
  for (const m of source.matchAll(/(?<![\w-])(?:max-)?(sm|md|lg|xl|2xl):/g)) {
    found.push(TAILWIND[m[1]]);
  }
  for (const m of source.matchAll(
    /(?<![\w-])(?:min|max)-\[([\d.]+)(px|rem)\]:/g,
  )) {
    found.push(toPx(Number(m[1]), m[2]));
  }
  return found;
}

export function srcThresholds(
  root = path.join(process.cwd(), "src"),
): number[] {
  const all = new Set<number>();
  for (const entry of readdirSync(root, { recursive: true })) {
    const file = String(entry);
    if (/\.test\.[jt]sx?$/.test(file)) continue;
    const isCss = file.endsWith(".css");
    if (!isCss && !/\.[jt]sx?$/.test(file)) continue;
    for (const t of thresholdsIn(
      readFileSync(path.join(root, file), "utf8"),
      isCss,
    )) {
      all.add(Math.round(t));
    }
  }
  return [...all].sort((a, b) => a - b);
}

export const PHONE_WIDTH = 390;
export const DESKTOP_WIDTH = 1440;
/* The laptop pass also runs with reduced motion, so styles that apply only
   under prefers-reduced-motion are measured at a common width. */
export const REDUCED_MOTION_WIDTH = 1280;

export interface ExtraViewport {
  name: string;
  width: number;
  height: number;
  reducedMotion: boolean;
  /** Open every disclosure as well: on a phone the navigation is behind one. */
  disclosures: boolean;
}

/** One width per band the thresholds make, besides the full 1440 pass: the
 * phone width for the band below the first threshold, and each threshold
 * itself for the band it opens. A band that already holds 1440 needs no
 * extra pass. */
export function laneViewports(thresholds = srcThresholds()): ExtraViewport[] {
  const sorted = [...new Set(thresholds)].sort((a, b) => a - b);
  const bandOf = (width: number) => sorted.filter((t) => t <= width).length;
  const widths = new Set<number>([PHONE_WIDTH, REDUCED_MOTION_WIDTH]);
  for (const t of sorted) {
    if (t > PHONE_WIDTH && bandOf(t) !== bandOf(DESKTOP_WIDTH)) widths.add(t);
  }
  return [...widths]
    .sort((a, b) => a - b)
    .map((width) => ({
      name: width === PHONE_WIDTH ? "phone" : `w${width}`,
      width,
      height: width < 768 ? 844 : width < 1280 ? 1024 : 800,
      reducedMotion: width === REDUCED_MOTION_WIDTH,
      disclosures: width === PHONE_WIDTH,
    }));
}

/** Whether every band the thresholds make holds a rendered width. */
export function uncoveredBands(
  thresholds: number[],
  widths: number[],
): [number, number][] {
  const edges = [
    0,
    ...[...new Set(thresholds)].sort((a, b) => a - b),
    Infinity,
  ];
  const missing: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [lo, hi] = [edges[i], edges[i + 1]];
    if (lo === hi) continue;
    if (!widths.some((w) => w >= lo && w < hi)) missing.push([lo, hi]);
  }
  return missing;
}
