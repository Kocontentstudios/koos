import type { AssetRef, ImageElement } from "../schema";
import {
  coverPlacement,
  grown,
  intersection,
  SUBJECT_GAP,
  SUBJECT_MIN_SHARE,
  type SubjectBox,
  subjectOnCanvas,
} from "../subject";
import {
  type Context,
  imageElement,
  NEAR_BLACK,
  px,
  type Rect,
  rect,
  WHITE,
} from "./context";
import { containedSubject } from "./cutout";
import {
  bestVeil,
  contrastOn,
  groundSamples,
  hexToRgb,
  type ImagePlacement,
  type Rgb,
  UNKNOWN_GROUND,
  type Veil,
} from "./ground";

/**
 * The image element for a frame, and the veil copy over it needs.
 *
 * A photograph fills its frame (cover). A cut-out is contained and sized to
 * `target` by its visible pixels (cutout.ts), so the subject and its shadow
 * are always whole.
 */

export function isCutout(ctx: Context): boolean {
  return Boolean(ctx.image && ctx.imageFacts?.cutout);
}

/** How far a cut-out subject stays inside its frame on each side. */
export interface SubjectInsets {
  top: number;
  bottom: number;
  sides: number;
}

export interface Framed {
  element: ImageElement;
  placement: ImagePlacement;
  /** The subject on the canvas, when the subject is known. */
  subject: Rect | null;
  /** The subject is whole, at SUBJECT_MIN_SHARE or more, and clear of the
   *  logo and every keep-out. Always true when the subject is unknown. */
  clean: boolean;
}

/** Rounded up, so the builders never leave less room than measureSubject
 *  checks for. */
export function subjectGap(ctx: Context): number {
  return Math.ceil(ctx.ref * SUBJECT_GAP);
}

export function minSubjectEdge(ctx: Context): number {
  return Math.ceil(ctx.ref * SUBJECT_MIN_SHARE);
}

/** The subject's width over its height, as drawn. */
export function subjectAspect(ctx: Context): number {
  const facts = ctx.imageFacts;
  const subject = ctx.subject;
  if (!facts || !subject) return 1;
  return (subject.w * facts.width) / (subject.h * facts.height);
}

/** The least height a frame must give the subject for its longer edge to
 *  reach SUBJECT_MIN_SHARE. */
export function minSubjectHeight(ctx: Context): number {
  return Math.ceil(minSubjectEdge(ctx) / Math.max(1, subjectAspect(ctx)));
}

/**
 * The image element for `frame`, with the subject kept whole, large enough
 * and clear of the logo and of `keepOut` (copy, footer), each grown by the
 * subject gap.
 *
 * A cut-out is contained and sized by its visible pixels (cutout.ts); when
 * the logo is in the way it tries the room below the mark and beside it,
 * and takes whichever draws the subject largest. A photograph with a known
 * subject gets the least cover zoom and the focus that satisfy the rule
 * (subject.ts coverPlacement). A photograph whose subject is unknown fills
 * the frame centred, as before.
 */
export function framedImage(
  ctx: Context,
  frame: Rect,
  options: {
    insets?: SubjectInsets;
    keepOut?: Rect[];
    /** A photograph may be drawn in a frame smaller than `frame`, centred
     *  in it, when the whole frame cannot show its subject whole. Only for
     *  a region the photo does not have to fill edge to edge. */
    inset?: boolean;
    /** How a picture set smaller than its region lines up with the copy:
     *  on the region's vertical axis, for centred copy, or from its left
     *  edge, for copy set flush left. Without it, centred in whatever room
     *  the logo leaves, which floated the photo off both. */
    align?: InsetAlign;
    /** Grounds of their own the region runs up to, a footer bar above
     *  all: an inset print keeps the same gutter from them as from the
     *  canvas edge, or its rounded corners sit flush on the band (round-8
     *  live critic, fashion split-left). */
    against?: Rect[];
    /** The least share of the region's width an inset may narrow to. A
     *  band meant to be filled edge to edge drew a tall photo as a small
     *  print with 350 px of ground beside it (round-8 live critic,
     *  storefront banner-bottom); below this the layout reports the
     *  subject cropped, and the chooser takes another. */
    minInsetWidth?: number;
  } = {},
): Framed | null {
  if (!ctx.image) return null;
  const facts = ctx.imageFacts;
  const gap = subjectGap(ctx);
  const avoid = [
    ...(options.keepOut ?? []),
    ...(ctx.logoBox ? [ctx.logoBox] : []),
  ].map((zone) => grown(zone, gap));
  const framed = (
    placement: ImagePlacement,
    subject: Rect | null,
    clean: boolean,
  ): Framed => ({
    element: imageElement(ctx.image as AssetRef, placement.frame, placement),
    placement,
    subject,
    clean,
  });

  if (facts?.cutout) {
    const insets = options.insets ?? {
      top: ctx.margin,
      bottom: ctx.margin,
      sides: ctx.margin,
    };
    const target = rect(
      frame.x + insets.sides,
      frame.y + insets.top,
      frame.width - insets.sides * 2,
      frame.height - insets.top - insets.bottom,
    );
    let best: {
      placement: ImagePlacement;
      subject: Rect;
      free: boolean;
    } | null = null;
    /* The whole target keeps the frame it was given. A smaller room is
       its own frame: contain never draws a picture smaller than its frame
       allows, so a subject that has to shrink to clear the logo needs a
       smaller frame to shrink into. */
    for (const room of alignedRooms(
      roomsBeside(target, avoid),
      frame,
      options.align,
    )) {
      const placed =
        room === target
          ? containedSubject(facts, frame, room)
          : containedSubject(facts, room, room);
      const free = !avoid.some((zone) => intersection(placed.subject, zone));
      const size = placed.subject.width * placed.subject.height;
      const bestSize = best ? best.subject.width * best.subject.height : -1;
      if (
        !best ||
        (free && !best.free) ||
        (free === best.free && size > bestSize)
      ) {
        best = { ...placed, free };
      }
    }
    const chosen = best as NonNullable<typeof best>;
    const large =
      Math.max(chosen.subject.width, chosen.subject.height) >=
      minSubjectEdge(ctx) - 1;
    return framed(chosen.placement, chosen.subject, chosen.free && large);
  }

  if (facts && ctx.subject) {
    const minEdge = minSubjectEdge(ctx);
    const exact =
      coverPlacement(
        facts,
        ctx.subject,
        frame,
        avoid,
        minEdge,
        ctx.heads ?? [],
      ) ??
      (options.inset
        ? insetCoverPlacement(facts, ctx.subject, frame, avoid, minEdge, {
            heads: ctx.heads ?? [],
            canvas: rect(0, 0, ctx.width, ctx.height),
            /* Flush-left copy starts at the margin; a picture lined up
               with it starts there too. */
            gutter: px(options.align === "start" ? ctx.margin : ctx.margin / 2),
            logo: ctx.logoBox ? grown(ctx.logoBox, gap) : null,
            align: options.align,
            against: options.against ?? [],
            minWidthShare: options.minInsetWidth ?? 0,
          })
        : null);
    const placement = balancedInset(
      exact ??
        coverPlacement(facts, ctx.subject, frame, avoid, 0) ??
        centredOn(ctx.subject, frame),
      frame,
      avoid,
      options.align,
    );
    const result = framed(
      placement,
      subjectOnCanvas(facts, ctx.subject, placement),
      Boolean(exact),
    );
    /* A photo set inside its region reads as a print laid on the ground,
       and square corners on it read as a crop gone wrong. */
    return placement.frame === frame
      ? result
      : {
          ...result,
          element: { ...result.element, radius: px(ctx.ref * INSET_RADIUS) },
        };
  }

  return framed(
    { frame, fit: "cover", zoom: 1, focusX: 0.5, focusY: 0.5 },
    null,
    true,
  );
}

/** Corner radius of a photograph inset in its region, as a share of the
 *  shorter side. */
const INSET_RADIUS = 0.02;

/** Shares of the region an inset frame steps down through, widest first. */
const INSET_STEPS = Array.from({ length: 15 }, (_, i) => 1 - i * 0.05);

/**
 * A cover placement in a frame narrower or shorter than `region`, centred
 * in it, for a subject that cannot be whole in the region itself.
 *
 * Cover never draws a photo smaller than its frame, so a subject wider
 * (or taller) than the region at zoom 1 can only be shown whole by
 * shrinking the frame: a landscape product shot in a portrait column, a
 * portrait in a short band above the copy. The largest frame that works.
 *
 * An inset frame keeps `gutter` from any canvas edge its region runs to:
 * rounded corners against the edge of the post read as a mistake. It also
 * stays clear of the logo: a mark half on the print and half on the ground
 * read as a sticker slapped across its corner. The room beside the logo is
 * tried too, and the largest frame wins.
 */
function insetCoverPlacement(
  image: { width: number; height: number },
  subject: SubjectBox,
  region: Rect,
  avoid: Rect[],
  minEdge: number,
  {
    canvas,
    gutter,
    logo,
    align,
    against,
    minWidthShare,
    heads,
  }: {
    heads: readonly SubjectBox[];
    canvas: Rect;
    gutter: number;
    logo: Rect | null;
    align?: InsetAlign;
    against: Rect[];
    minWidthShare: number;
  },
): ImagePlacement | null {
  const onEdge = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;
  const touches = (side: (r: Rect) => number, at: number) =>
    against.some((r) => onEdge(side(r), at));
  const left =
    region.x +
    (onEdge(region.x, canvas.x) || touches((r) => r.x + r.width, region.x)
      ? gutter
      : 0);
  const top =
    region.y +
    (onEdge(region.y, canvas.y) || touches((r) => r.y + r.height, region.y)
      ? gutter
      : 0);
  const right =
    regionRight -
    (onEdge(regionRight, canvas.x + canvas.width) ||
    touches((r) => r.x, regionRight)
      ? gutter
      : 0);
  const bottom =
    regionBottom -
    (onEdge(regionBottom, canvas.y + canvas.height) ||
    touches((r) => r.y, regionBottom)
      ? gutter
      : 0);
  const whole = rect(left, top, right - left, bottom - top);
  if (whole.width <= 0 || whole.height <= 0) return null;
  const rooms = alignedRooms(
    logo && intersection(logo, whole)
      ? roomsBeside(whole, [logo]).slice(1)
      : [whole],
    region,
    align,
  );
  let best: ImagePlacement | null = null;
  for (const room of rooms) {
    const placement = largestInsetIn(
      room,
      (frame) => coverPlacement(image, subject, frame, avoid, minEdge, heads),
      align === "start" ? "start" : "centre",
      (minWidthShare * region.width) / Math.max(1, room.width),
    );
    if (
      placement &&
      (!best ||
        placement.frame.width * placement.frame.height >
          best.frame.width * best.frame.height)
    ) {
      best = placement;
    }
  }
  return best;
}

export type InsetAlign = "axis" | "start";

/**
 * An inset print narrower than its side moved onto the canvas margin on
 * `edge`, so the copy beside it can take the room it frees (round-8 live
 * critic, fashion split-left: a 16:9 portrait centred in its half left
 * 350 px of bare ground between copy and photo). Only the frame moves: a
 * cover crop depends on its frame's size, never its place. A move that
 * would meet the logo is not made.
 */
export function onMargin(
  ctx: Context,
  framed: Framed,
  side: Rect,
  edge: "left" | "right",
): Framed {
  const frame = framed.element;
  const gutter = px(ctx.margin / 2);
  if (frame.width >= side.width - gutter) return framed;
  const x =
    edge === "right" ? px(ctx.width - gutter - frame.width) : px(gutter);
  if (edge === "right" ? x <= frame.x : x >= frame.x) return framed;
  const moved = { ...frame, x };
  if (ctx.logoBox && intersection(moved, grown(ctx.logoBox, subjectGap(ctx)))) {
    return framed;
  }
  const dx = x - frame.x;
  return {
    ...framed,
    element: moved,
    placement: {
      ...framed.placement,
      frame: { ...framed.placement.frame, x: framed.placement.frame.x + dx },
    },
    subject: framed.subject
      ? { ...framed.subject, x: framed.subject.x + dx }
      : null,
  };
}

/**
 * Rooms cut down to what an aligned picture can use. On the axis: each
 * room narrowed to be symmetric about the region's centre line, so a
 * picture centred in it is centred on the copy below. From the start: only
 * rooms that begin at the region's left edge, where flush-left copy does.
 */
/* A print set from the left edge that leaves more than this share of its
   region empty on the right reads as parked, not aligned (round-7 live
   critic: a 9:16 photo with 220 px blank beside it). */
const PARKED_SHARE = 0.12;

/** An inset print lined up from the left, moved to the middle of its
 *  region when it would leave a blank side, and when the middle is clear
 *  of the logo and anything kept out. */
export function balancedInset(
  placement: ImagePlacement,
  region: Rect,
  avoid: Rect[],
  align: InsetAlign | undefined,
): ImagePlacement {
  const inner = placement.frame;
  if (align !== "start" || inner === region) return placement;
  const blank = region.x + region.width - (inner.x + inner.width);
  const leftGap = inner.x - region.x;
  if (blank - leftGap <= region.width * PARKED_SHARE) return placement;
  const centred = rect(
    region.x + (region.width - inner.width) / 2,
    inner.y,
    inner.width,
    inner.height,
  );
  if (avoid.some((zone) => intersection(centred, zone))) return placement;
  return { ...placement, frame: centred };
}

function alignedRooms(
  rooms: Rect[],
  region: Rect,
  align: InsetAlign | undefined,
): Rect[] {
  if (align === "start") {
    const left = Math.min(...rooms.map((room) => room.x));
    return rooms.filter((room) => room.x <= left + 0.5);
  }
  if (align !== "axis") return rooms;
  const axis = region.x + region.width / 2;
  return rooms.flatMap((room) => {
    const half = Math.min(axis - room.x, room.x + room.width - axis);
    return half > 1 ? [rect(axis - half, room.y, half * 2, room.height)] : [];
  });
}

/** The first placement `place` finds in `room` stepped down narrower or
 *  shorter, widest first: centred in the room, or from its left edge. */
function largestInsetIn(
  room: Rect,
  place: (frame: Rect) => ImagePlacement | null,
  anchor: "centre" | "start",
  minWidthShare = 0,
): ImagePlacement | null {
  for (const share of INSET_STEPS) {
    const narrower = rect(
      room.x + (anchor === "start" ? 0 : (room.width * (1 - share)) / 2),
      room.y,
      room.width * share,
      room.height,
    );
    const shorter = rect(
      room.x,
      room.y + (room.height * (1 - share)) / 2,
      room.width,
      room.height * share,
    );
    const frames = share >= minWidthShare ? [narrower, shorter] : [shorter];
    for (const frame of frames) {
      const placement = place(frame);
      if (placement) return placement;
    }
  }
  return null;
}

/** Cover at zoom 1 with the subject as near the middle as the photo allows,
 *  for when no placement keeps the rule. */
function centredOn(subject: SubjectBox, frame: Rect): ImagePlacement {
  return {
    frame,
    fit: "cover",
    zoom: 1,
    focusX: Math.min(1, Math.max(0, subject.x + subject.w / 2)),
    focusY: Math.min(1, Math.max(0, subject.y + subject.h / 2)),
  };
}

/**
 * `target`, then the rooms left in it once every zone is cut out: each room
 * a zone cuts into is replaced by its parts below, above, left and right of
 * that zone. A subject contained in any room but the first is clear of every
 * zone at once.
 */
function roomsBeside(target: Rect, zones: Rect[]): Rect[] {
  let rooms: Rect[] = [target];
  for (const zone of zones) {
    const next: Rect[] = [];
    for (const room of rooms) {
      if (!intersection(zone, room)) {
        next.push(room);
        continue;
      }
      const right = room.x + room.width;
      const bottom = room.y + room.height;
      /* A pixel clear of the zone: containment rounds to half a pixel, and
         a subject touching the zone by a sliver counts as on it. */
      const parts = [
        { x: room.x, y: zone.y + zone.height + 1, right, bottom },
        { x: room.x, y: room.y, right, bottom: zone.y - 1 },
        { x: room.x, y: room.y, right: zone.x - 1, bottom },
        { x: zone.x + zone.width + 1, y: room.y, right, bottom },
      ];
      for (const part of parts) {
        const width = Math.min(part.right, right) - Math.max(part.x, room.x);
        const height = Math.min(part.bottom, bottom) - Math.max(part.y, room.y);
        if (width > 1 && height > 1) {
          next.push(
            rect(
              Math.max(part.x, room.x),
              Math.max(part.y, room.y),
              width,
              height,
            ),
          );
        }
      }
    }
    rooms = next;
  }
  return [target, ...rooms.filter((room) => room !== target)];
}

export const COPY_CANDIDATES = (ctx: Context) => [
  WHITE,
  ctx.palette.foreground,
  NEAR_BLACK,
];

/** What the reader sees in `region`, from the measured image when there is
 *  one. Without facts, the worst ground: white and black both. */
export function samplesUnder(
  ctx: Context,
  placement: ImagePlacement | null,
  region: Rect,
  background: string,
): Rgb[] {
  if (!ctx.imageFacts || !placement) return UNKNOWN_GROUND;
  return groundSamples(ctx.imageFacts, placement, region, background);
}

export function veilFor(
  ctx: Context,
  placement: ImagePlacement | null,
  region: Rect,
  background: string,
): Veil {
  return bestVeil(
    samplesUnder(ctx, placement, region, background),
    COPY_CANDIDATES(ctx),
  );
}

/** `samples` as seen through `alpha` of a veil in `veil.color`. */
export function veiled(
  samples: Rgb[],
  veil: { color: string },
  alpha: number,
): Rgb[] {
  const target = hexToRgb(veil.color);
  return samples.map(
    (sample) => sample.map((c, i) => c + (target[i] - c) * alpha) as Rgb,
  );
}

/**
 * The accent where it clears 3:1 on every pixel of `ground` (WCAG for
 * display-size type, which a stat, a quote mark and a rule all are);
 * otherwise `fallback`, the copy's own colour. Judged per pixel, not on an
 * average: an orange mark over a veiled checkerboard averaged fine and was
 * lost on half its squares.
 */
export function accentOn(ctx: Context, ground: Rgb[], fallback: string) {
  return ground.every((pixel) => contrastOn(ctx.palette.accent, pixel) >= 3)
    ? ctx.palette.accent
    : fallback;
}
