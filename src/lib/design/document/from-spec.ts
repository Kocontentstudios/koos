import type { Canvas } from "@/lib/design/canvas";
import { logoBoxIn } from "@/lib/design/logo-placement";
import { contrastRatio, type ResolvedPalette } from "@/lib/design/palette";
import { footerLinesFor, hasFooter } from "@/lib/design/render/footer";
import type { DesignSpec } from "@/lib/design/spec";
import { normalizeHex } from "@/lib/validation/hex";
import {
  type FittedText,
  fitText,
  glyphOverhang,
  largestFitting,
  lineBox,
  type TextLook,
  type TextMeasurer,
} from "./fit";
import { BUTTON_LINE_HEIGHT, buttonPaddingX, buttonPaddingY } from "./render";
import {
  type AssetRef,
  type ButtonElement,
  type DesignDocument,
  type DesignElement,
  DOCUMENT_VERSION,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type TextRole,
} from "./schema";

/**
 * Builds a layer document from a DesignSpec, one builder per flex layout.
 *
 * Each builder draws the same composition as render/layouts.tsx: the same
 * zones, the same 8% margin, the same logo corner from logoBoxIn. Where the
 * flex version had a known weakness it is fixed here rather than copied:
 *
 *  - Copy over a photograph sits on a scrim dark enough for white text to
 *    clear 4.5:1 even over a white image (black at 0.56 over white is
 *    #707070, 4.8:1). The flex scrim reached 0.05-0.3 behind the headline and
 *    white type on a pale photo was unreadable.
 *  - The footer takes its colour from what is actually under it. The flex
 *    footer turned white whenever a plate existed, including on split-left
 *    and banner-bottom where it sits on the flat background.
 *  - The card layouts wrap the copy instead of covering the whole photo with
 *    a 42% panel, and the quote card gets a card that is visible without a
 *    photo (the flex panel was the same colour as the canvas).
 *  - Every size comes from the measured layout (fit.ts), so the headline is
 *    as large as the room allows instead of a pessimistic estimate, never
 *    runs to more lines than its layout reads well at while a smaller size
 *    would avoid it, and never drops below 1.3x the subheadline while the
 *    subheadline can still step down instead.
 *  - Split and banner compositions without a photograph fill the image zone
 *    with an accent field instead of leaving half the canvas bare.
 *
 * Geometry is integer pixels so the browser editor and satori place every
 * box on the same pixel.
 */

export interface DocumentLogoInput {
  asset: AssetRef;
  /** Width/height of the mark, so its box is the mark's own footprint. */
  aspect?: number;
}

export interface DocumentFromSpecInput {
  spec: DesignSpec;
  palette: ResolvedPalette;
  canvas: Canvas;
  image: AssetRef | null;
  logo: DocumentLogoInput | null;
  measurer: TextMeasurer;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Context {
  spec: DesignSpec;
  palette: ResolvedPalette;
  width: number;
  height: number;
  /** The shorter side. Every size keys off it, as in the flex layouts, so a
   *  landscape canvas does not get type sized for its long edge. */
  ref: number;
  margin: number;
  image: AssetRef | null;
  logoBox: Rect | null;
  logo: DocumentLogoInput | null;
  measurer: TextMeasurer;
}

const WHITE = "#FFFFFF";
const NEAR_BLACK = "#111111";

/* Black at this alpha over pure white is #707070, which white text clears at
   4.8:1: the scrim alone guarantees legible copy over any photograph. */
const SCRIM_UNDER_COPY = 0.56;

/* What the footer sits on when a photograph fills the canvas: the bottom of
   the scrim over a pale image, the worst case for light text. */
const PHOTO_GROUND = "#3A3A3A";

const SIZES = {
  subheadline: { size: 0.036, min: 0.027 },
  cta: { size: 0.032, min: 0.024 },
  footer: { size: 0.026, min: 0.019 },
  headlineMin: 0.042,
} as const;

/* Per layout: how big the headline may get and how many lines it may take
   before a smaller size reads better. The largest sizes match the flex
   ladder's top step (0.11) except where the layout's purpose asks for more
   (a stat is the number) or less (a 52% column). */
const HEADLINE: Record<
  DesignSpec["layout"],
  { max: number; maxLines: number }
> = {
  "hero-center": { max: 0.12, maxLines: 4 },
  "split-left": { max: 0.095, maxLines: 5 },
  "banner-bottom": { max: 0.09, maxLines: 3 },
  "quote-card": { max: 0.085, maxLines: 5 },
  "stat-highlight": { max: 0.15, maxLines: 3 },
};

const HERO_OVER_PHOTO = { max: 0.095, maxLines: 3 };

/** The smallest headline-to-subheadline size ratio that still reads as a
 *  headline. */
const HIERARCHY = 1.3;

function px(value: number): number {
  return Math.round(value);
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return {
    x: px(x),
    y: px(y),
    width: Math.max(1, px(width)),
    height: Math.max(1, px(height)),
  };
}

function base(id: string, name: string, box: Rect) {
  return {
    id,
    name,
    ...rect(box.x, box.y, box.width, box.height),
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };
}

function channels(hex: string): [number, number, number] {
  const value = normalizeHex(hex) ?? NEAR_BLACK;
  return [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function mixHex(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((c, i) =>
      Math.round(c + (b[i] - c) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** The candidate with the most contrast against `ground`. */
export function mostReadableOn(ground: string, candidates: string[]): string {
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, ground) > contrastRatio(best, ground)
      ? candidate
      : best,
  );
}

function black(alpha: number): string {
  return `rgba(0,0,0,${alpha})`;
}

function pct(share: number): string {
  return `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;
}

function imageElement(asset: AssetRef, box: Rect): ImageElement {
  return {
    ...base("image", "Image", box),
    type: "image",
    asset,
    fit: "cover",
    crop: { zoom: 1, focusX: 0.5, focusY: 0.5 },
    radius: 0,
  };
}

function shapeElement(
  id: string,
  name: string,
  box: Rect,
  fill: string,
  extra: Partial<
    Pick<ShapeElement, "radius" | "borderColor" | "borderWidth">
  > = {},
): ShapeElement {
  return {
    ...base(id, name, box),
    type: "shape",
    fill,
    borderColor: extra.borderColor ?? "transparent",
    borderWidth: extra.borderWidth ?? 0,
    radius: extra.radius ?? 0,
  };
}

/** A colour field in the brand accent, for the half of a split or banner
 *  composition that would hold the photograph. Without it the flex layouts
 *  left that half as bare background and the copy looked misplaced. */
function accentField(palette: ResolvedPalette): string {
  return `linear-gradient(160deg, ${palette.accent} 0%, ${mixHex(palette.accent, "#000000", 0.22)} 100%)`;
}

const looks = {
  headline: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "heading",
    fontSize,
    fontWeight: 700,
    lineHeight: 1.05,
    letterSpacing: -0.01,
    align,
    italic: false,
  }),
  body: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 400,
    lineHeight: 1.35,
    letterSpacing: 0,
    align,
    italic: false,
  }),
  footer: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: 0.01,
    align,
    italic: false,
  }),
  cta: (fontSize: number): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 600,
    lineHeight: BUTTON_LINE_HEIGHT,
    letterSpacing: 0,
    align: "center",
    italic: false,
  }),
  quote: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "heading",
    fontSize,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: 0,
    align,
    italic: false,
  }),
};

function textElement(
  id: string,
  name: string,
  role: TextRole,
  text: string,
  look: TextLook,
  color: string,
  content: Rect,
): TextElement {
  /* The element is the laid-out box plus room for glyphs that overshoot it,
     so the ink stays inside the element as well as the layout. */
  const overhang = glyphOverhang(look);
  return {
    ...base(id, name, {
      x: content.x,
      y: content.y - overhang,
      width: content.width,
      height: content.height + overhang * 2,
    }),
    type: "text",
    text,
    role,
    ...look,
    color,
  };
}

interface Measured {
  height: number;
  place(x: number, y: number, align: TextLook["align"]): DesignElement;
}

interface CopyColors {
  headline: string;
  body: string;
  ctaFill: string;
  ctaLabel: string;
  accent: string;
}

interface StackOptions {
  zone: Rect;
  align: "left" | "center";
  vAlign: "start" | "center" | "end";
  colors: CopyColors;
  rule?: "above" | "below";
  quoteMark?: boolean;
  /** Overrides the layout's headline limits. */
  headline?: { max: number; maxLines: number };
}

export interface Stack {
  elements: DesignElement[];
  top: number;
  bottom: number;
  headline: FittedText;
}

async function measureCta(
  ctx: Context,
  label: string,
  zoneWidth: number,
  colors: CopyColors,
): Promise<Measured> {
  const { measurer, ref } = ctx;
  const maxSize = px(ref * SIZES.cta.size);
  const minSize = px(ref * SIZES.cta.min);
  const oneLine = await largestFitting(minSize, maxSize, async (size) => {
    const width = await measurer.lineWidth(label, looks.cta(size));
    return width + buttonPaddingX(size) * 2 + 2 <= zoneWidth;
  });

  let fontSize: number;
  let width: number;
  let labelHeight: number;
  if (oneLine !== null) {
    fontSize = oneLine;
    /* Two pixels of slack: the label box is the measured width rounded by
       the layout engine, and a one-pixel shortfall would wrap the label. */
    width =
      (await measurer.lineWidth(label, looks.cta(fontSize))) +
      buttonPaddingX(fontSize) * 2 +
      2;
    labelHeight = lineBox(looks.cta(fontSize));
  } else {
    fontSize = minSize;
    width = zoneWidth;
    labelHeight = await measurer.height(
      label,
      looks.cta(fontSize),
      zoneWidth - buttonPaddingX(fontSize) * 2,
    );
  }
  const height = labelHeight + buttonPaddingY(fontSize) * 2;

  return {
    height,
    place(x, y, align) {
      const left = align === "center" ? x + (zoneWidth - width) / 2 : x;
      const button: ButtonElement = {
        ...base("cta", "Call to action", { x: left, y, width, height }),
        type: "button",
        label,
        fill: colors.ctaFill,
        color: colors.ctaLabel,
        radius: px(height / 2),
        fontSize,
        fontWeight: 600,
      };
      return button;
    },
  };
}

function measuredText(
  id: string,
  name: string,
  role: TextRole,
  text: string,
  look: TextLook,
  color: string,
  width: number,
  height: number,
): Measured {
  return {
    height,
    place: (x, y) =>
      textElement(id, name, role, text, look, color, { x, y, width, height }),
  };
}

/**
 * Headline, subheadline and call to action, fitted to a zone and stacked.
 *
 * The subheadline and button are sized first at their natural sizes, and the
 * headline takes whatever height is left: it is the element a designer
 * scales to the space.
 */
async function copyStack(ctx: Context, options: StackOptions): Promise<Stack> {
  const { spec, ref, measurer } = ctx;
  const { zone, align, colors } = options;
  const layout = options.headline ?? HEADLINE[spec.layout];
  const textAlign = align === "center" ? "center" : "left";
  const gapAfterHeadline = px(ref * 0.03);
  const gapBeforeCta = px(ref * 0.05);

  const rule =
    options.rule !== undefined
      ? {
          width: px(ref * 0.09),
          height: Math.max(4, px(ref * 0.008)),
          gap: px(ref * 0.035),
        }
      : null;

  let quote: Measured | null = null;
  let quoteGap = 0;
  if (options.quoteMark) {
    const look = looks.quote(px(ref * 0.15), textAlign);
    const height = await measurer.height("“", look, zone.width);
    quote = measuredText(
      "quote-mark",
      "Quote mark",
      "body",
      "“",
      look,
      colors.accent,
      zone.width,
      /* The glyph's ink sits in the top half of its line box; the bottom
         half is reclaimed so the mark hangs over the headline instead of
         floating above it. */
      px(height * 0.55),
    );
    quoteGap = px(ref * 0.01);
  }

  const subMin = px(ref * SIZES.subheadline.min);
  const subMax = px(ref * SIZES.subheadline.size);
  const fitSubheadline = async (cap: number) =>
    spec.subheadline
      ? fitText(measurer, {
          text: spec.subheadline,
          look: (size) => looks.body(size, textAlign),
          width: zone.width,
          maxHeight: zone.height * 0.4,
          minSize: subMin,
          maxSize: cap,
          maxLines: 5,
        })
      : null;

  const headlineMax = px(ref * layout.max);
  const fitHeadline = (reserved: number, floor: number) =>
    fitText(measurer, {
      text: spec.headline,
      look: (size) => looks.headline(size, textAlign),
      width: zone.width,
      maxHeight: zone.height - reserved,
      minSize: Math.min(
        headlineMax,
        Math.max(px(ref * SIZES.headlineMin), floor),
      ),
      maxSize: headlineMax,
      maxLines: layout.maxLines,
    });

  const cta = spec.cta
    ? await measureCta(ctx, spec.cta, zone.width, colors)
    : null;

  const reservedFor = (sub: FittedText | null) =>
    (rule ? rule.height + rule.gap : 0) +
    (quote ? quote.height + quoteGap : 0) +
    (sub ? sub.height + gapAfterHeadline : 0) +
    (cta ? cta.height + gapBeforeCta : 0);

  /* Hierarchy before size: a headline smaller than 1.3x its subheadline
     reads from the wrong line first, which is what the flex banner did with
     long copy. When the room cannot hold both, the subheadline steps down
     first; only when it is at its minimum does the floor give way, because
     copy that fits beats copy in the right order that overflows. */
  const subCaps = Array.from(
    new Set([subMax, px((subMax + subMin) / 2), subMin]),
  );
  let sub: FittedText | null = null;
  let headline: FittedText | null = null;
  for (const cap of subCaps) {
    sub = await fitSubheadline(cap);
    headline = await fitHeadline(
      reservedFor(sub),
      Math.ceil((sub?.fontSize ?? 0) * HIERARCHY),
    );
    if (headline.fits) break;
  }
  if (!headline?.fits) headline = await fitHeadline(reservedFor(sub), 0);

  const headlineLook = looks.headline(headline.fontSize, textAlign);
  const items: { measured: Measured; gapAfter: number }[] = [];
  if (quote) items.push({ measured: quote, gapAfter: quoteGap });

  const ruleShape = (x: number, y: number): DesignElement =>
    shapeElement(
      "accent-rule",
      "Accent rule",
      {
        x: align === "center" ? x + (zone.width - (rule?.width ?? 0)) / 2 : x,
        y,
        width: rule?.width ?? 0,
        height: rule?.height ?? 0,
      },
      colors.accent,
      { radius: px((rule?.height ?? 0) / 2) },
    );
  const ruleItem: Measured | null = rule
    ? { height: rule.height, place: (x, y) => ruleShape(x, y) }
    : null;

  if (ruleItem && options.rule === "above") {
    items.push({ measured: ruleItem, gapAfter: rule?.gap ?? 0 });
  }
  items.push({
    measured: measuredText(
      "headline",
      "Headline",
      "headline",
      spec.headline,
      headlineLook,
      colors.headline,
      zone.width,
      headline.height,
    ),
    gapAfter: 0,
  });
  if (ruleItem && options.rule === "below") {
    items[items.length - 1].gapAfter = rule?.gap ?? 0;
    items.push({ measured: ruleItem, gapAfter: 0 });
  }
  if (sub && spec.subheadline) {
    items[items.length - 1].gapAfter = Math.max(
      items[items.length - 1].gapAfter,
      gapAfterHeadline,
    );
    items.push({
      measured: measuredText(
        "subheadline",
        "Subheadline",
        "subheadline",
        spec.subheadline,
        looks.body(sub.fontSize, textAlign),
        colors.body,
        zone.width,
        sub.height,
      ),
      gapAfter: 0,
    });
  }
  if (cta) {
    items[items.length - 1].gapAfter = gapBeforeCta;
    items.push({ measured: cta, gapAfter: 0 });
  }

  const total = items.reduce(
    (sum, item, index) =>
      sum +
      item.measured.height +
      (index < items.length - 1 ? item.gapAfter : 0),
    0,
  );
  const top =
    options.vAlign === "start"
      ? zone.y
      : options.vAlign === "end"
        ? zone.y + zone.height - total
        : zone.y + (zone.height - total) / 2;

  let y = px(top);
  const elements: DesignElement[] = [];
  for (const item of items) {
    elements.push(item.measured.place(zone.x, y, textAlign));
    y += item.measured.height + item.gapAfter;
  }

  return {
    elements,
    top: px(top),
    bottom: px(top + total),
    headline: { ...headline, fits: headline.fits && total <= zone.height },
  };
}

/**
 * The zones copy may use once the logo has its corner.
 *
 * Centred layouts give up the same amount on both sides so the copy stays
 * centred under a corner mark, and try both directions: on a landscape
 * canvas clearing the mark vertically can leave a sliver, while clearing it
 * horizontally costs little.
 */
interface ZoneCandidate {
  zone: Rect;
  /** Multiplies the headline size when choosing between zones. */
  preference: number;
}

function zonesAvoidingLogo(
  ctx: Context,
  zone: Rect,
  symmetric: boolean,
): ZoneCandidate[] {
  const box = ctx.logoBox;
  if (!box) return [{ zone, preference: 1 }];
  const gap = px(ctx.ref * 0.03);
  const overlaps =
    box.x - gap < zone.x + zone.width &&
    box.x + box.width + gap > zone.x &&
    box.y - gap < zone.y + zone.height &&
    box.y + box.height + gap > zone.y;
  if (!overlaps) return [{ zone, preference: 1 }];

  const logoOnTop = box.y + box.height / 2 < ctx.height / 2;
  const logoOnLeft = box.x + box.width / 2 < ctx.width / 2;
  const vertical = logoOnTop
    ? box.y + box.height + gap - zone.y
    : zone.y + zone.height - (box.y - gap);
  const horizontal = logoOnLeft
    ? box.x + box.width + gap - zone.x
    : zone.x + zone.width - (box.x - gap);

  const oneSided = (preference: number): ZoneCandidate[] => [
    {
      preference,
      zone: rect(
        zone.x,
        logoOnTop ? zone.y + vertical : zone.y,
        zone.width,
        zone.height - vertical,
      ),
    },
    {
      preference,
      zone: rect(
        logoOnLeft ? zone.x + horizontal : zone.x,
        zone.y,
        zone.width - horizontal,
        zone.height,
      ),
    },
  ];
  /* A centred layout prefers to stay centred, but not at any price: on a
     square card the mirrored reserve can leave the headline a third of the
     size the one-sided zone allows, and then the one-sided zone wins. */
  const candidates: ZoneCandidate[] = symmetric
    ? [
        {
          preference: 1,
          zone: rect(
            zone.x,
            zone.y + vertical,
            zone.width,
            zone.height - vertical * 2,
          ),
        },
        {
          preference: 1,
          zone: rect(
            zone.x + horizontal,
            zone.y,
            zone.width - horizontal * 2,
            zone.height,
          ),
        },
        ...oneSided(0.8),
      ]
    : oneSided(1);
  return candidates.filter(
    ({ zone: candidate }) =>
      candidate.width > ctx.ref * 0.3 && candidate.height > ctx.ref * 0.2,
  );
}

/** The stack with the biggest headline among the zones that fit; the
 *  biggest headline overall when none does. */
async function bestStack(
  zones: ZoneCandidate[],
  build: (zone: Rect) => Promise<Stack>,
): Promise<{ stack: Stack; zone: Rect }> {
  let best: { stack: Stack; zone: Rect; score: number } | null = null;
  for (const { zone, preference } of zones) {
    const stack = await build(zone);
    const score = stack.headline.fontSize * preference;
    const better =
      !best ||
      (stack.headline.fits && !best.stack.headline.fits) ||
      (stack.headline.fits === best.stack.headline.fits && score > best.score);
    if (better) best = { stack, zone, score };
  }
  if (!best) throw new Error("No zone to place copy in");
  return best;
}

interface Footer {
  elements: DesignElement[];
  /** Top edge of whatever the footer occupies; copy must end above it. */
  top: number;
}

/**
 * Utility lines along the bottom (render/footer.ts). A bar carries its own
 * ground; plain text sits on the design in a colour chosen for what is
 * under it.
 */
async function footer(
  ctx: Context,
  options: {
    band: { x: number; width: number };
    align: "left" | "center";
    ground: string;
  },
): Promise<Footer | null> {
  const { spec, ref, height, width, measurer, palette } = ctx;
  if (!hasFooter(spec)) return null;
  const lines = footerLinesFor(spec).map(keepSeparatorsWithPrecedingWord);
  const isBar = spec.footerStyle === "bar";
  const textAlign = options.align === "center" ? "center" : "left";
  const band = isBar
    ? { x: ctx.margin, width: width - ctx.margin * 2 }
    : options.band;
  const color = isBar
    ? palette.background
    : mostReadableOn(options.ground, [
        palette.foreground,
        palette.background,
        WHITE,
        NEAR_BLACK,
      ]);
  const lineGap = px(ref * 0.006);
  const padY = px(ref * (isBar ? 0.032 : 0.045));

  const fitted = [];
  for (const line of lines) {
    fitted.push(
      await fitText(measurer, {
        text: line,
        look: (size) => looks.footer(size, textAlign),
        width: band.width,
        maxHeight:
          lineBox(looks.footer(px(ref * SIZES.footer.size), textAlign)) * 2,
        minSize: px(ref * SIZES.footer.min),
        maxSize: px(ref * SIZES.footer.size),
        maxLines: 1,
      }),
    );
  }
  /* One size for every line, the smallest any of them needed: a footer whose
     lines are set at different sizes reads as a mistake. */
  const fontSize = Math.min(...fitted.map((f) => f.fontSize));
  const look = looks.footer(fontSize, textAlign);
  const heights = await Promise.all(
    lines.map((line) => measurer.height(line, look, band.width)),
  );
  const content =
    heights.reduce((sum, h) => sum + h, 0) + lineGap * (lines.length - 1);
  const top = isBar ? height - content - padY * 2 : height - padY - content;

  const elements: DesignElement[] = [];
  if (isBar) {
    elements.push(
      shapeElement(
        "footer-bar",
        "Footer bar",
        { x: 0, y: top, width, height: height - top },
        palette.foreground,
      ),
    );
  }
  let y = isBar ? top + padY : top;
  lines.forEach((line, index) => {
    elements.push(
      textElement(
        `footer-${index + 1}`,
        `Footer line ${index + 1}`,
        "footer",
        line,
        look,
        color,
        { x: band.x, y, width: band.width, height: heights[index] },
      ),
    );
    y += heights[index] + lineGap;
  });
  return { elements, top: px(top) };
}

/* A footer line that has to wrap must not start its second line with the
   separator: "Lekki / · Open daily" reads as a typo. A no-break space before
   the separator ties it to the word it follows. */
function keepSeparatorsWithPrecedingWord(line: string): string {
  return line.replace(/ ([·|•–—]) /g, "\u00A0$1 ");
}

function logoElement(ctx: Context): DesignElement | null {
  if (!ctx.logo || !ctx.logoBox) return null;
  return {
    ...base("logo", "Logo", ctx.logoBox),
    type: "logo",
    asset: ctx.logo.asset,
    backing: null,
  };
}

function copyBottom(ctx: Context, foot: Footer | null): number {
  const clearOfFooter = foot ? foot.top - px(ctx.ref * 0.04) : ctx.height;
  return Math.min(ctx.height - ctx.margin, clearOfFooter);
}

interface Built {
  background: string;
  elements: DesignElement[];
}

function copyColorsOn(ctx: Context, ground: "photo" | "flat"): CopyColors {
  const { palette } = ctx;
  const ctaLabel = mostReadableOn(palette.accent, [
    palette.background,
    palette.foreground,
    WHITE,
    NEAR_BLACK,
  ]);
  return ground === "photo"
    ? {
        headline: WHITE,
        body: WHITE,
        ctaFill: palette.accent,
        ctaLabel,
        accent: palette.accent,
      }
    : {
        headline: palette.foreground,
        body: palette.foreground,
        ctaFill: palette.accent,
        ctaLabel,
        accent: palette.accent,
      };
}

async function heroCenter(ctx: Context): Promise<Built> {
  const { width, height, margin, palette, image } = ctx;
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    ground: image ? PHOTO_GROUND : palette.background,
  });
  const zone = rect(
    margin,
    margin,
    width - margin * 2,
    copyBottom(ctx, foot) - margin,
  );
  const { stack } = await bestStack(zonesAvoidingLogo(ctx, zone, true), (z) =>
    copyStack(ctx, {
      zone: z,
      align: "center",
      /* Over a photograph the copy anchors low and the subject keeps the
         upper part of the frame clear, which is where the scrim stays light. */
      vAlign: image ? "end" : "center",
      colors: copyColorsOn(ctx, image ? "photo" : "flat"),
      rule: "above",
      /* Over a photograph the copy shares the frame with the subject, so the
         headline stops a step short of filling it. */
      ...(image ? { headline: HERO_OVER_PHOTO } : {}),
    }),
  );

  const elements: DesignElement[] = [];
  if (image) {
    elements.push(imageElement(image, { x: 0, y: 0, width, height }));
    const copyTop = stack.top / height;
    const rampStart = Math.max(0, copyTop - 0.24);
    const solid = Math.max(rampStart, copyTop - 0.03);
    /* Eased rather than linear: a straight ramp from light to the copy's
       darkness reads as a grey band across the photo. */
    const easing = rampStart + (solid - rampStart) * 0.55;
    elements.push(
      shapeElement(
        "scrim",
        "Scrim",
        { x: 0, y: 0, width, height },
        `linear-gradient(180deg, ${black(0.08)} 0%, ${black(0.08)} ${pct(rampStart)}, ${black(0.26)} ${pct(easing)}, ${black(SCRIM_UNDER_COPY)} ${pct(solid)}, ${black(0.62)} 100%)`,
      ),
    );
  }
  elements.push(...stack.elements);
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

async function splitLeft(ctx: Context): Promise<Built> {
  const { width, height, margin, palette, image } = ctx;
  const column = px(width * 0.52);
  const foot = await footer(ctx, {
    band: { x: margin, width: column - margin * 2 },
    align: "left",
    ground: palette.background,
  });
  const sideBottom = foot && ctx.spec.footerStyle === "bar" ? foot.top : height;
  const zone = rect(
    margin,
    margin,
    column - margin * 2,
    copyBottom(ctx, foot) - margin,
  );
  const { stack } = await bestStack(zonesAvoidingLogo(ctx, zone, false), (z) =>
    copyStack(ctx, {
      zone: z,
      align: "left",
      vAlign: "center",
      colors: copyColorsOn(ctx, "flat"),
      rule: "above",
    }),
  );

  const side = { x: column, y: 0, width: width - column, height: sideBottom };
  const elements: DesignElement[] = [
    image
      ? imageElement(image, side)
      : shapeElement(
          "accent-panel",
          "Colour panel",
          side,
          accentField(palette),
        ),
    ...stack.elements,
  ];
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

/** The banner grows to fit its copy, as the flex layout's does, between these
 *  shares of the canvas height. */
export const BANNER_SHARE = { min: 0.34, max: 0.6 } as const;

async function bannerBottom(ctx: Context): Promise<Built> {
  const { width, height, margin, palette, image } = ctx;
  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "left",
    ground: palette.background,
  });
  const bottom = copyBottom(ctx, foot);
  const maxBand = height * BANNER_SHARE.max;
  const zone = rect(
    margin,
    height - maxBand + margin,
    width - margin * 2,
    bottom - (height - maxBand + margin),
  );
  const { stack } = await bestStack(zonesAvoidingLogo(ctx, zone, false), (z) =>
    copyStack(ctx, {
      zone: z,
      align: "left",
      vAlign: "end",
      colors: copyColorsOn(ctx, "flat"),
      rule: "above",
    }),
  );

  const bandTop = px(
    Math.min(
      height * (1 - BANNER_SHARE.min),
      Math.max(height - maxBand, stack.top - margin),
    ),
  );
  /* The stack was anchored to the bottom of the largest band. When the band
     is held at its minimum share instead, the copy is centred in it so the
     space above and below the copy match. */
  const interiorTop = bandTop + margin;
  const centredTop =
    interiorTop + (bottom - interiorTop - (stack.bottom - stack.top)) / 2;
  const shift = px(Math.min(0, centredTop - stack.top));
  const shifted = stack.elements.map((element) => ({
    ...element,
    y: element.y + shift,
  }));

  const top = { x: 0, y: 0, width, height: bandTop };
  const elements: DesignElement[] = [
    image
      ? imageElement(image, top)
      : shapeElement("accent-panel", "Colour panel", top, accentField(palette)),
    ...shifted,
  ];
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: palette.background, elements };
}

function cardGround(ctx: Context, variant: "quote" | "stat"): string {
  const { palette } = ctx;
  if (variant === "stat") return palette.background;
  /* A quote card needs a ground the card can stand out from. The accent is
     the brand's own second colour; when it is too close to the card a tint of
     the foreground does the job instead. */
  return contrastRatio(palette.accent, palette.background) >= 1.3
    ? palette.accent
    : mixHex(palette.background, palette.foreground, 0.14);
}

async function card(ctx: Context, variant: "quote" | "stat"): Promise<Built> {
  const { width, height, margin, palette, image, ref } = ctx;
  const ground = cardGround(ctx, variant);
  const pad = px(ref * 0.07);

  const foot = await footer(ctx, {
    band: { x: margin, width: width - margin * 2 },
    align: "center",
    ground: image ? PHOTO_GROUND : ground,
  });
  const region = rect(
    margin,
    margin,
    width - margin * 2,
    copyBottom(ctx, foot) - margin,
  );

  const flat = copyColorsOn(ctx, image ? "photo" : "flat");
  const accent = image
    ? contrastRatio(palette.accent, "#4A4A4A") >= 2
      ? palette.accent
      : WHITE
    : contrastRatio(palette.accent, palette.background) >= 2
      ? palette.accent
      : palette.foreground;
  /* A stat is the number: set in the accent when the accent reads as text on
     the card, which display-size type only needs 3:1 for. */
  const headline =
    variant === "stat" &&
    !image &&
    contrastRatio(palette.accent, palette.background) >= 3
      ? palette.accent
      : flat.headline;
  const colors: CopyColors = { ...flat, headline, accent };

  const { stack, zone } = await bestStack(
    zonesAvoidingLogo(ctx, region, true),
    (candidate) =>
      copyStack(ctx, {
        zone: rect(
          candidate.x + pad,
          candidate.y + pad,
          candidate.width - pad * 2,
          candidate.height - pad * 2,
        ),
        align: "center",
        vAlign: "center",
        colors,
        ...(variant === "quote"
          ? { quoteMark: true }
          : { rule: "below" as const }),
      }),
  );

  /* The card hugs its copy but never shrinks below 60% of the room, or a
     short headline sits in a postage stamp on a sea of colour. */
  const content = stack.bottom - stack.top + pad * 2;
  const cardHeight = Math.min(
    zone.height,
    Math.max(content, zone.height * 0.6),
  );
  const cardBox = {
    x: zone.x,
    y: (stack.top + stack.bottom) / 2 - cardHeight / 2,
    width: zone.width,
    height: cardHeight,
  };

  const elements: DesignElement[] = [];
  if (image) {
    const full = { x: 0, y: 0, width, height };
    elements.push(imageElement(image, full));
    elements.push(
      shapeElement(
        "scrim",
        "Scrim",
        full,
        `linear-gradient(180deg, ${black(0.15)} 0%, ${black(0.05)} 35%, ${black(0.68)} 100%)`,
      ),
    );
  }
  elements.push(
    shapeElement(
      "card",
      "Card",
      cardBox,
      image ? black(SCRIM_UNDER_COPY) : palette.background,
      {
        radius: px(ref * 0.04),
        ...(variant === "stat"
          ? {
              borderColor: palette.accent,
              borderWidth: Math.max(3, px(ref * 0.006)),
            }
          : {}),
      },
    ),
  );
  elements.push(...stack.elements);
  if (foot) elements.push(...foot.elements);
  const logo = logoElement(ctx);
  if (logo) elements.push(logo);
  return { background: image ? palette.background : ground, elements };
}

export async function documentFromSpec({
  spec,
  palette,
  canvas,
  image,
  logo,
  measurer,
}: DocumentFromSpecInput): Promise<DesignDocument> {
  const ref = Math.min(canvas.width, canvas.height);
  const box =
    logo && spec.logoPlacement !== "none"
      ? logoBoxIn({
          placement: spec.logoPlacement,
          layout: spec.layout,
          width: canvas.width,
          height: canvas.height,
          aspect: logo.aspect,
        })
      : null;

  const ctx: Context = {
    spec,
    palette,
    width: canvas.width,
    height: canvas.height,
    ref,
    /* Must match the flex layouts' pad and the logo inset, so the mark shares
       a margin with the type. */
    margin: px(ref * 0.08),
    image,
    logo,
    logoBox: box ? rect(box.left, box.top, box.width, box.height) : null,
    measurer,
  };

  const built =
    spec.layout === "split-left"
      ? await splitLeft(ctx)
      : spec.layout === "banner-bottom"
        ? await bannerBottom(ctx)
        : spec.layout === "quote-card"
          ? await card(ctx, "quote")
          : spec.layout === "stat-highlight"
            ? await card(ctx, "stat")
            : await heroCenter(ctx);

  return {
    version: DOCUMENT_VERSION,
    width: canvas.width,
    height: canvas.height,
    background: built.background,
    elements: built.elements,
  };
}
