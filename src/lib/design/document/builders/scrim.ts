import { rgbLuminance } from "@/lib/design/palette";
import type { DesignElement, TextElement } from "../schema";
import { type Context, px, type Rect, rect, shapeElement } from "./context";
import {
  COPY_CONTRAST,
  type ImagePlacement,
  type Rgb,
  type Veil,
  veilAlpha,
  veilColor,
} from "./ground";
import { COPY_CANDIDATES, samplesUnder, veiled } from "./image";

/**
 * A veil graded to what each run of copy needs over the pixels under it.
 *
 * One alpha for the whole copy block, measured over its worst pixel, laid a
 * 0.55 slab across a bright sky because the subheadline crossed dark stone.
 * Here each run gets the least veil that clears its own target over its own
 * box, a headline only the 3:1 large type needs, and the veil rises through
 * them no faster than SLOPE_MAX, so it never lands as a band or a hard
 * edge, however close the copy sits to the subject or the canvas edge. The
 * text colour is the one whose veil changes the photo least to the eye: a
 * pale sky keeps its light under dark type and a light veil.
 */

/** WCAG large type: 3:1, with the margin COPY_CONTRAST keeps over 4.5:1. */
export const LARGE_COPY_CONTRAST = 3.1;

/** Large type as WCAG counts it on a social post viewed at full width:
 *  48px regular or 37px bold on a ~1080px canvas. */
export function isLargeType(
  element: Pick<TextElement, "fontSize" | "fontWeight">,
) {
  return (
    element.fontSize >= 48 ||
    (element.fontSize >= 37 && element.fontWeight >= 700)
  );
}

/** Steepest the veil may rise, in alpha per height of its box. Flex's
 *  fixed gradient rose 3.1; a ramp that read as a band rose 5. */
export const SLOPE_MAX = 2.4;

/** Shortest distance over which the veil reaches its full alpha. */
export const MIN_RAMP = 0.25;

/** Most stops a gradient may have (schema). */
const MAX_STOPS = 5;

/** The edge a veil is densest at: under copy set low, high, or in a band
 *  down one side of a full-bleed photo. */
export type VeilFrom = "bottom" | "top" | "left" | "right";

const isAcross = (from: VeilFrom) => from === "left" || from === "right";

export interface CopyBlock {
  box: Rect;
  large: boolean;
}

/** The copy runs a veil is graded for, from placed text elements. */
export function copyBlocks(
  ctx: Context,
  elements: DesignElement[],
): CopyBlock[] {
  const pad = px(ctx.ref * 0.01);
  return elements
    .filter((element): element is TextElement => element.type === "text")
    .map((element) => ({
      box: rect(
        element.x - pad,
        element.y - pad,
        element.width + pad * 2,
        element.height + pad * 2,
      ),
      large: isLargeType(element),
    }));
}

/** A point the veil must reach: `alpha` from `at` (share of the box from
 *  its clear edge) onwards. */
interface Need {
  at: number;
  alpha: number;
}

export interface Stop {
  at: number;
  alpha: number;
}

/**
 * The lightest veil profile meeting every need: zero until it must rise,
 * rising at SLOPE_MAX into each need, over at least MIN_RAMP into the
 * largest, holding after. As stops: the profile is convex between
 * consecutive needs, so straight lines between its values at the needs
 * never dip under it.
 */
export function profileStops(needs: Need[]): Stop[] {
  const sorted = [...needs].sort((a, b) => a.at - b.at);
  const rising: Need[] = [];
  for (const need of sorted) {
    const held = rising.at(-1)?.alpha ?? 0;
    if (need.alpha > held) rising.push(need);
  }
  const top = rising.at(-1);
  if (!top || top.alpha < 0.02) return [];
  /* Past MAX_STOPS - 2 needs, the earliest ones are folded into the next:
     reaching that need's alpha sooner over-veils a little, never under. */
  while (rising.length > MAX_STOPS - 2) {
    const [first, second] = rising;
    rising.splice(0, 2, { at: first.at, alpha: second.alpha });
  }
  const peak = rising.at(-1) ?? top;
  const lineStart = peak.at - MIN_RAMP;
  const valueAt = (u: number) => {
    let alpha = 0;
    for (const need of rising) {
      alpha = Math.max(
        alpha,
        u >= need.at ? need.alpha : need.alpha - SLOPE_MAX * (need.at - u),
      );
    }
    const line = peak.alpha * ((u - lineStart) / MIN_RAMP);
    return Math.max(0, Math.min(peak.alpha, Math.max(alpha, line)));
  };
  const start = Math.min(
    lineStart,
    ...rising.map((need) => need.at - need.alpha / SLOPE_MAX),
  );
  const at = [Math.max(0, start), ...rising.map((need) => need.at), 1];
  const stops: Stop[] = [];
  for (const u of at) {
    const clamped = Math.min(1, Math.max(0, u));
    if (stops.length && clamped <= (stops.at(-1)?.at ?? 0)) continue;
    stops.push({ at: clamped, alpha: valueAt(clamped) });
  }
  return stops;
}

/**
 * The higher of two rising profiles at every stop of either: straight
 * lines between those stops never dip under the higher of the two, so it
 * over-veils a little, never under. Past MAX_STOPS the stops nearest each
 * other are merged into the earlier at the later's alpha, which on a
 * rising profile again only over-veils.
 */
export function atLeast(a: Stop[], b: Stop[]): Stop[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const at = [...new Set([...a, ...b].map((stop) => stop.at))].sort(
    (x, y) => x - y,
  );
  let stops = at.map((u) => ({
    at: u,
    alpha: Math.max(alphaAt(a, u), alphaAt(b, u)),
  }));
  /* The clear edge's stop is never merged: raising it would draw a hard
     edge where the veil should start from nothing. */
  while (stops.length > MAX_STOPS) {
    let closest = 2;
    for (let i = 3; i < stops.length; i += 1) {
      if (
        stops[i].at - stops[i - 1].at <
        stops[closest].at - stops[closest - 1].at
      ) {
        closest = i;
      }
    }
    /* The earlier of the pair takes the higher alpha: reaching it sooner
       over-veils, never under. */
    const merged = {
      at: stops[closest - 1].at,
      alpha: Math.max(stops[closest - 1].alpha, stops[closest].alpha),
    };
    stops = [
      ...stops.slice(0, closest - 1),
      merged,
      ...stops.slice(closest + 1),
    ];
  }
  return stops;
}

/**
 * The veil started from nothing at its clear edge, rising straight to what
 * it holds at `lead`, the nearest any copy comes to that edge. Copy set a
 * margin in from the edge of a band left the graded veil a third dense
 * there, a hard line down the photo (round-24 geometry, storefront); no
 * copy lies before `lead`, so no run is veiled less. Unchanged when the
 * stops would pass MAX_STOPS.
 */
export function startClear(stops: Stop[], lead: number): Stop[] {
  if (stops.length === 0 || stops[0].alpha === 0 || lead <= 0) return stops;
  const after = stops.filter((stop) => stop.at > lead);
  const rise = [
    { at: 0, alpha: 0 },
    { at: lead, alpha: alphaAt(stops, lead) },
  ];
  return rise.length + after.length > MAX_STOPS ? stops : [...rise, ...after];
}

/** Where the copy nearest a veil's clear edge starts, as a share of `box`
 *  from that edge. */
export function nearestLead(
  box: Rect,
  blocks: CopyBlock[],
  from: VeilFrom,
): number {
  return Math.min(1, ...blocks.map((block) => edgesOf(box, block, from)[0]));
}

/** The alpha drawn at `u`: linear between stops, the end stops held. */
export function alphaAt(stops: Stop[], u: number): number {
  if (stops.length === 0) return 0;
  if (u <= stops[0].at) return stops[0].alpha;
  for (let i = 1; i < stops.length; i += 1) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (u <= b.at) {
      return a.alpha + ((b.alpha - a.alpha) * (u - a.at)) / (b.at - a.at);
    }
  }
  return stops[stops.length - 1].alpha;
}

/** CIE L* (0..1) of a pixel: lightness as the eye scales it. */
function lightness(rgb: Rgb): number {
  const y = rgbLuminance(...rgb);
  const f = y > 216 / 24389 ? Math.cbrt(y) : ((24389 / 27) * y + 16) / 116;
  return (116 * f - 16) / 100;
}

/* Rows the change is measured over; finer than any image grid cell. */
const COST_ROWS = 24;

/**
 * How much the veil changes the photograph, as the eye sees it: the mean
 * change in lightness over the box. A black veil over a pale sky and a
 * white one over dark stone both cost a lot; the same veils the other way
 * round cost little, which a cost in alpha alone cannot tell apart.
 */
function lightnessChange(
  ctx: Context,
  placement: ImagePlacement | null,
  box: Rect,
  stops: Stop[],
  veil: { color: string },
  options: { from: VeilFrom; background: string },
): number {
  if (stops.length === 0) return 0;
  let total = 0;
  for (let row = 0; row < COST_ROWS; row += 1) {
    const u = (row + 0.5) / COST_ROWS;
    const alpha = alphaAt(stops, u);
    if (alpha === 0) continue;
    const samples = samplesUnder(
      ctx,
      placement,
      sliceAt(box, row, options.from),
      options.background,
    );
    const seen = veiled(samples, veil, alpha);
    let change = 0;
    samples.forEach((sample, i) => {
      change += Math.abs(lightness(seen[i]) - lightness(sample));
    });
    total += change / samples.length;
  }
  return total / COST_ROWS;
}

/* The `row`th of COST_ROWS slices of `box`, counted from its clear edge. */
function sliceAt(box: Rect, row: number, from: VeilFrom): Rect {
  const near = row / COST_ROWS;
  const far = (row + 1) / COST_ROWS;
  if (isAcross(from)) {
    const x =
      from === "left"
        ? box.x + box.width * (1 - far)
        : box.x + box.width * near;
    return rect(x, box.y, box.width / COST_ROWS, box.height);
  }
  const y =
    from === "top" ? box.y + box.height * (1 - far) : box.y + box.height * near;
  return rect(box.x, y, box.width, box.height / COST_ROWS);
}

export interface GradedVeil {
  veil: Veil;
  stops: Stop[];
  /** Mean change in lightness the veil makes to the photo (0..1). */
  cost: number;
}

/**
 * The text colour whose graded veil changes the photo least, and that veil.
 * Earlier candidates win near-ties, as in ground.ts bestVeil.
 */
export function gradedVeil(
  ctx: Context,
  placement: ImagePlacement | null,
  box: Rect,
  blocks: CopyBlock[],
  options: {
    from: VeilFrom;
    background: string;
    /** Text colours to choose among; every copy candidate by default. */
    texts?: string[];
    /** A profile the veil may not fall under anywhere. */
    floor?: Stop[];
  },
): GradedVeil {
  const lead = (block: CopyBlock) => edgesOf(box, block, options.from)[0];
  let best: GradedVeil | null = null;
  for (const text of options.texts ?? COPY_CANDIDATES(ctx)) {
    let color = "#000000";
    const needs: Need[] = [];
    let reachable = true;
    for (const block of blocks) {
      const needed = veilAlpha(
        samplesUnder(ctx, placement, block.box, options.background),
        text,
        block.large ? LARGE_COPY_CONTRAST : COPY_CONTRAST,
      );
      if (!needed) {
        reachable = false;
        break;
      }
      color = needed.color;
      needs.push({ at: lead(block), alpha: needed.alpha });
    }
    if (!reachable) continue;
    const stops = options.floor
      ? atLeast(profileStops(needs), options.floor)
      : profileStops(needs);
    const peak = Math.max(0, ...stops.map((stop) => stop.alpha));
    const cost = lightnessChange(
      ctx,
      placement,
      box,
      stops,
      { color },
      options,
    );
    if (!best || cost < best.cost - 0.01) {
      best = { veil: { text, color, alpha: peak }, stops, cost };
    }
  }
  return (
    best ?? {
      veil: { text: "#FFFFFF", color: "#000000", alpha: 1 },
      stops: [
        { at: 0, alpha: 1 },
        { at: 1, alpha: 1 },
      ],
      cost: 1,
    }
  );
}

/** Where a block starts and ends, as shares of `box` from its clear edge. */
function edgesOf(
  box: Rect,
  block: CopyBlock,
  from: VeilFrom,
): [number, number] {
  if (isAcross(from)) {
    const left = (block.box.x - box.x) / box.width;
    const right = (block.box.x + block.box.width - box.x) / box.width;
    return from === "left" ? [1 - right, 1 - left] : [left, right];
  }
  const top = (block.box.y - box.y) / box.height;
  const bottom = (block.box.y + block.box.height - box.y) / box.height;
  return from === "top" ? [1 - bottom, 1 - top] : [top, bottom];
}

/**
 * What the reader sees under each block through the graded veil, at the
 * lightest and heaviest alpha the block spans: contrast moves one way as a
 * veil thickens, so a colour that clears both clears everything between.
 */
export function veiledFaces(
  ctx: Context,
  placement: ImagePlacement | null,
  box: Rect,
  blocks: CopyBlock[],
  graded: GradedVeil,
  options: { from: VeilFrom; background: string },
): Rgb[] {
  return blocks.flatMap((block) => {
    const samples = samplesUnder(ctx, placement, block.box, options.background);
    return edgesOf(box, block, options.from).flatMap((edge) =>
      veiled(samples, graded.veil, alphaAt(graded.stops, edge)),
    );
  });
}

/** The graded veil as a shape over `box`, or null when nothing needs one. */
export function scrimElement(
  box: Rect,
  graded: GradedVeil,
  options: { from: VeilFrom; radius?: number },
): DesignElement | null {
  if (graded.stops.length < 2 || graded.veil.alpha < 0.02) return null;
  /* The gradient runs from the clear edge (0%) to the dense one. */
  const angle = { bottom: 180, top: 0, right: 90, left: 270 }[options.from];
  const stops = graded.stops.map(
    (stop) => `${veilColor(graded.veil, stop.alpha)} ${pct(stop.at)}`,
  );
  return shapeElement(
    "scrim",
    "Scrim",
    box,
    `linear-gradient(${angle}deg, ${stops.join(", ")})`,
    { radius: options.radius ?? 0 },
  );
}

function pct(share: number): string {
  return `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;
}
