/**
 * The deliverable FORMAT, derived from a free-text design-type label.
 *
 * `designType` is free text at every boundary — a form select, a label the
 * chat model invented, or whatever a row stored months ago — and it reached
 * the art director as one unstructured prompt line. Nothing downstream could
 * branch on it, so a YouTube thumbnail and a business card were briefed
 * identically (KOOS-AI-001 §1.1).
 *
 * Deliberately NOT a strict enum at the boundary: tightening `designType`
 * would reject rows already stored and labels the chat path writes. The label
 * stays free, and this maps it onto something the pipeline can reason about.
 *
 * Format answers "what is it and how is it read". The CATEGORY — what the
 * design is selling — is a separate axis and lives in
 * src/lib/ai/design-training/playbooks.ts.
 */

export const DESIGN_FORMATS = [
  "social-post",
  "carousel",
  "flyer",
  "poster",
  "banner",
  "thumbnail",
  "presentation",
  "logo",
  "print-collateral",
  "motion",
  "product-ui",
  "other",
] as const;

export type DesignFormat = (typeof DESIGN_FORMATS)[number];

export interface FormatRules {
  /** Headline budget in words, from reading distance and canvas share. */
  headlineWords: number;
  /** Whether the deliverable is inherently more than one page. */
  multiPage: boolean;
  /** Whether the still-image renderer can actually produce this. A motion
   *  brief or a packaging dieline cannot be a flat composite, and the pipeline
   *  must be able to say so rather than quietly returning a poster. */
  generatable: boolean;
  /** Format-specific art direction, injected into the brief and spec prompts. */
  guidance: string;
}

/* Ordered: the first pattern that matches wins, so the more specific ones come
   first. "instagram carousel" must not be read as a social post. */
const PATTERNS: [RegExp, DesignFormat][] = [
  [/carousel|multi[- ]?slide|swipe/i, "carousel"],
  [/thumbnail/i, "thumbnail"],
  [/banner|header|cover|billboard/i, "banner"],
  [/flyer|e-?flyer|handbill/i, "flyer"],
  [/poster/i, "poster"],
  [/presentation|slide deck|pitch deck|deck/i, "presentation"],
  [/brand identity|logo|wordmark|monogram/i, "logo"],
  [/business card|packaging|label|sticker|brochure|print/i, "print-collateral"],
  [/motion|video editing|animation|reel|gif/i, "motion"],
  [/ui\/?ux|website|web design|app design|landing page/i, "product-ui"],
  [
    /social|instagram|facebook|linkedin|twitter|\big\b|story|post/i,
    "social-post",
  ],
];

export function resolveDesignFormat(
  label: string | null | undefined,
): DesignFormat {
  const text = (label ?? "").trim();
  if (!text) return "other";
  for (const [pattern, format] of PATTERNS) {
    if (pattern.test(text)) return format;
  }
  return "other";
}

const RULES: Record<DesignFormat, FormatRules> = {
  "social-post": {
    headlineWords: 8,
    multiPage: false,
    generatable: true,
    guidance:
      "Read on a phone while scrolling. One dominant message, high contrast, and copy that survives being seen at thumbnail size before it is opened.",
  },
  carousel: {
    headlineWords: 7,
    multiPage: true,
    generatable: true,
    guidance:
      "A sequence: the first frame earns the swipe, the middle frames carry one point each, the last frame carries the action. Frames share a type system and palette so they read as one set.",
  },
  flyer: {
    headlineWords: 10,
    multiPage: false,
    generatable: true,
    guidance:
      "Denser than a social post and often read at arm's length. Dates, venue and contact details are information, not decoration, and belong in a stable lower zone.",
  },
  poster: {
    headlineWords: 12,
    multiPage: false,
    generatable: true,
    guidance:
      "Read at distance first, up close second. One statement legible across a room, then supporting detail for whoever steps closer.",
  },
  banner: {
    headlineWords: 6,
    multiPage: false,
    generatable: true,
    guidance:
      "Wide and shallow. Copy sits on one side with the subject on the other; a centred stack wastes the shape. Very short headline, one action.",
  },
  thumbnail: {
    headlineWords: 4,
    multiPage: false,
    generatable: true,
    guidance:
      "Seen at a few hundred pixels wide beside competing thumbnails. Three or four very large words, one face or object, extreme contrast. Detail is wasted here.",
  },
  presentation: {
    headlineWords: 10,
    multiPage: true,
    generatable: false,
    guidance:
      "A deck is a sequence of slides with a master layout. The still-image renderer produces one frame, so treat a request for this as a single title slide and say so.",
  },
  logo: {
    headlineWords: 3,
    multiPage: false,
    generatable: false,
    guidance:
      "A mark is identity work, not a composition. It needs vector output and human iteration; a generated raster is a sketch at best.",
  },
  "print-collateral": {
    headlineWords: 8,
    multiPage: false,
    generatable: false,
    guidance:
      "Print needs bleed, trim, CMYK and a dieline. A screen-resolution RGB composite is not a printable artefact.",
  },
  motion: {
    headlineWords: 6,
    multiPage: false,
    generatable: false,
    guidance:
      "Motion needs frames over time. A still renderer can only offer a key frame, which is not the deliverable that was asked for.",
  },
  "product-ui": {
    headlineWords: 8,
    multiPage: true,
    generatable: false,
    guidance:
      "Interface design needs real components, states and content. A generated picture of a screen is a mood board, not a design.",
  },
  other: {
    headlineWords: 8,
    multiPage: false,
    generatable: true,
    guidance:
      "Format unrecognised. Apply the general rules: one dominant message, clear reading order, and copy sized for the canvas.",
  },
};

export function formatRules(format: DesignFormat): FormatRules {
  return RULES[format];
}

/** Format guidance as a prompt block, or empty when nothing useful to add. */
export function formatBlock(format: DesignFormat): string {
  const rules = RULES[format];
  return [
    `Deliverable format: ${format}.`,
    rules.guidance,
    `Keep the headline to roughly ${rules.headlineWords} words or fewer.`,
  ].join(" ");
}
