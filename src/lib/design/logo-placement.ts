import type { DesignSpec } from "@/lib/design/spec";

export type LogoCorner = Exclude<DesignSpec["logoPlacement"], "none">;

/**
 * Whether a logo appears, and where, is not a judgement call — the same brand
 * and the same layout have the same right answer every time. The art director
 * may still suggest a corner, but "none" was an unguarded escape hatch it took
 * routinely, and nothing downstream noticed (KOOS-BUG-022).
 *
 * The one genuinely latent input is whether the BRIEF asked for no logo, which
 * the model answers in `spec.logoFree`. That question was briefly matched here
 * with a regex and it got it backwards: every phrasing that insists the mark be
 * kept — "never omit the logo", "do not remove the logo" — puts a removal verb
 * next to the word logo, and English negation scope is not regex-tractable.
 */

/** The corner each layout leaves free, read off the layout bodies in
 * render/layouts.tsx: split-left fills the left 52% with copy, banner-bottom
 * the lower 38%, and the three centred layouts leave every corner clear. */
const DEFAULT_CORNER: Record<DesignSpec["layout"], LogoCorner> = {
  "hero-center": "top-right",
  "split-left": "top-right",
  "banner-bottom": "top-right",
  "quote-card": "bottom-right",
  "stat-highlight": "bottom-right",
};

export function defaultLogoCornerFor(layout: DesignSpec["layout"]): LogoCorner {
  return DEFAULT_CORNER[layout] ?? "top-right";
}

/**
 * The corners a layout actually leaves free.
 *
 * Overriding only "none" was half a guard. The art director could still name
 * a corner its own layout fills — banner-bottom draws left-aligned copy across
 * the lower band, so bottom-left puts the mark straight on the headline — and
 * that is the same unguarded-model-choice shape as "none", just less obvious.
 * The layout knows where its copy goes; the model's preference is only
 * honoured inside that.
 */
const ALLOWED_CORNERS: Record<DesignSpec["layout"], readonly LogoCorner[]> = {
  // Copy is centred on the full canvas; every corner is clear.
  "hero-center": ["top-left", "top-right", "bottom-left", "bottom-right"],
  // Copy fills the left 52%.
  "split-left": ["top-right", "bottom-right"],
  // Copy fills the lower 38%, left-aligned.
  "banner-bottom": ["top-left", "top-right"],
  // Centred panel; the 13% inset clears it on every side.
  "quote-card": ["top-left", "top-right", "bottom-left", "bottom-right"],
  "stat-highlight": ["top-left", "top-right", "bottom-left", "bottom-right"],
};

export function allowedCornersFor(
  layout: DesignSpec["layout"],
): readonly LogoCorner[] {
  return ALLOWED_CORNERS[layout] ?? ALLOWED_CORNERS["hero-center"];
}

/* Designing a logo or an identity system means the existing mark is the thing
   being replaced. Stamping it into the corner of its own replacement is the
   one case where an automatic logo is actively wrong, and it is a dropdown
   value rather than free text, so it is settled here rather than asked. */
/* The dropdown values are "Logo" and "Brand Identity", but designType is free
   text everywhere downstream — calendar items and AI-written briefs both
   produce their own phrasings, and "Logo Design" got the existing mark stamped
   onto its own replacement. */
const LOGO_WORD =
  "(?:logos?|logotypes?|wordmarks?|brand(?:ing)?\\s+identity|identity)";
const QUALIFIER =
  "(?:new|fresh|initial|first|final|draft|updated?|revised?|\\d+)";
const SUFFIX =
  "(?:design|concepts?|refresh|redesign|rebrand|suite|system|exploration|options?|variants?|package|kit|work)";
const JOIN = "(?:\\s*(?:&|and|\\+|\\/|,)\\s*|\\s+)";

/* Every part optional and repeatable, so the combinations people actually
   type all land: "Logo", "Logo Design", "New logo concepts",
   "Logo & Brand Identity", "brand identity refresh". Anchored at both ends so
   "Logo Reveal Animation" — a video — does not. */
const LOGO_IS_THE_DELIVERABLE = new RegExp(
  `^\\s*(?:${QUALIFIER}${JOIN})*${LOGO_WORD}(?:${JOIN}(?:${LOGO_WORD}|${SUFFIX}))*\\s*$`,
  "i",
);

export function logoIsTheDeliverable(
  designType: string | null | undefined,
): boolean {
  return Boolean(designType && LOGO_IS_THE_DELIVERABLE.test(designType.trim()));
}

/**
 * Whether the model's claim that the brief asked for no logo is corroborated.
 *
 * Three stricter guards were tried here and all three were wrong, in ways that
 * are worth recording because the next person will be tempted by them again:
 *
 *  - Matching removal phrasings with a regex read "never omit the logo" as
 *    "omit the logo".
 *  - Asking the model to quote its evidence and testing containment did the
 *    same by another route, since "omit the logo" IS a substring of that
 *    sentence.
 *  - Requiring the quote to begin a clause fixed those and broke the common
 *    case instead: "Please design this with no logo" and "Create a logo-free
 *    version" both quote from mid-sentence, so ten of thirteen genuine
 *    requests were overridden and the mark stamped on anyway. Worse, the
 *    outcome depended on how much context the model happened to quote.
 *
 * Whether a sentence asks for removal is a question about negation scope in
 * English. It is not settleable here, which is why the model answers it. What
 * this can do is refuse an UNSUPPORTED claim — a quote that is not in the
 * brief at all is an invention, and that is the shape a hallucination takes.
 *
 * The real protection is not this function: it is that a deliberate omission
 * is now announced to the user, with the words it relied on, so a wrong answer
 * is visible and correctable rather than a logo that silently vanished.
 */

/* Long enough to be an instruction rather than a fragment. At six characters
   "the logo", "logo is" and even "prominent" all passed, so a hallucinated
   claim could point at any brief that mentions a logo at all — and the user
   was then shown "prominent" as their alleged instruction. */
const MIN_QUOTE_CHARS = 14;

/* And it has to contain a word that could express removal. This does not
   settle negation scope — "never omit the logo" still contains "omit" — but it
   refuses evidence too thin to BE evidence, which is the whole job here. The
   model still decides; this only rejects a claim with nothing behind it. */
const REMOVAL_WORD =
  /\b(?:no|without|omit|exclude|remove|drop|skip|free|off|none|un-?branded|don'?t|do\s+not|never)\b/i;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function briefAskedForNoLogo(
  briefText: string | null | undefined,
  quote: string | null | undefined,
): boolean {
  const claim = quote?.trim();
  if (!claim || claim.length < MIN_QUOTE_CHARS) return false;
  if (!REMOVAL_WORD.test(claim)) return false;
  const brief = briefText?.trim();
  if (!brief) return false;
  return normalise(brief).includes(normalise(claim));
}

/**
 * The final say on logo placement. The model's choice is honoured only when it
 * picked a corner; "none" is treated as an absent answer, not as a decision,
 * because the prompt never gave it grounds to suppress the brand's own mark.
 */
export function resolveLogoPlacement({
  modelChoice,
  hasLogo,
  layout,
  logoFree,
}: {
  modelChoice: DesignSpec["logoPlacement"];
  hasLogo: boolean;
  layout: DesignSpec["layout"];
  logoFree: boolean;
}): DesignSpec["logoPlacement"] {
  if (!hasLogo || logoFree) return "none";
  return modelChoice !== "none" &&
    allowedCornersFor(layout).includes(modelChoice)
    ? modelChoice
    : defaultLogoCornerFor(layout);
}

/* Inset from the plate edge, matched to the 8% padding the copy already uses
   so the mark shares a margin with the type rather than sitting closer to the
   edge than anything else on the plate.

   The two card layouts draw an inner panel starting at that same 8%, and the
   logo used to sit at 5% — so it straddled the panel edge and landed on the
   centred copy. Inside the panel's own padding is the only corner those
   layouts actually leave free. */
export function logoInsetPx(
  layout: DesignSpec["layout"],
  width: number,
  height: number,
): number {
  const reference = Math.min(width, height);
  const margin = 0.08 * reference;
  /* The card layouts draw an inner panel starting at 8% of the WIDTH, and at a
     landscape ratio that edge sits further in than a margin keyed to the
     shorter side — so the mark has to clear the panel in the panel's own
     units, then keep its own margin inside it. */
  return layout === "quote-card" || layout === "stat-highlight"
    ? 0.08 * width + 0.05 * reference
    : margin;
}

/** Slot the mark is fitted into, as fractions of the canvas WIDTH. Wide enough
 * for a 2:1 wordmark, tall enough that a square mark still reads. */
export const LOGO_BOX = { width: 0.22, height: 0.12 } as const;

/**
 * The mark's own box inside that slot, at its own proportions.
 *
 * The slot is a fixed rectangle and most marks are not that shape, so drawing
 * a backing plate on the slot left a slab of bare colour hanging off one side
 * of a square mark — a patch rather than a rescue. Fitting the aspect first
 * means the plate is the mark's own footprint.
 */
/* A mark thinner than this is in the corner and unreadable. At 0.22 wide a
   20:1 wordmark draws 8px tall on a 16:9 canvas — correct aspect, right
   corner, no fault, and nothing anyone can see. */
const MIN_MARK_HEIGHT = 0.03;
/** How far the slot may widen to give a very elongated mark usable height. */
const MAX_MARK_WIDTH = 0.34;

export function logoMarkBox(
  aspect: number,
  slot: { width: number; height: number } = LOGO_BOX,
): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let width = Math.min(slot.width, slot.height * safe);
  /* Widen rather than stay thin. Preserves the ratio either way — this only
     chooses how much of the corner the mark is allowed to take. */
  if (width / safe < MIN_MARK_HEIGHT) {
    width = Math.min(MAX_MARK_WIDTH, MIN_MARK_HEIGHT * safe);
  }
  return { width, height: width / safe };
}

/** True when the mark is so elongated that even the widened box leaves it
 *  below a readable height. Reported rather than shipped silently. */
export function markIsTooThin(aspect: number): boolean {
  const box = logoMarkBox(aspect);
  return box.height < MIN_MARK_HEIGHT || box.width < MIN_MARK_HEIGHT;
}

/**
 * Where the mark will land, in pixels, for a given canvas.
 *
 * Shared by the renderer that draws it and the contrast check that reads what
 * is underneath it — two places that must not disagree about where the logo
 * is, or the check measures the wrong part of the picture.
 */
export function logoBoxIn({
  placement,
  layout,
  width,
  height,
  aspect,
}: {
  placement: DesignSpec["logoPlacement"];
  layout: DesignSpec["layout"];
  width: number;
  height: number;
  /** The mark's own proportions. Omit for the whole slot. */
  aspect?: number;
}): { left: number; top: number; width: number; height: number } | null {
  if (placement === "none") return null;
  /* Sized off the SHORTER side, not the width. Keying everything to width
     makes a landscape canvas give the mark a slot 21% of its height, which at
     16:9 reaches into the centred headline on every layout the table calls
     clear. The shorter side is what "a twelfth of the picture" should mean. */
  const reference = Math.min(width, height);
  const inset = logoInsetPx(layout, width, height);

  /* The MARK's rectangle, not the slot it sits in, whenever the caller knows
     the aspect. The renderer anchors the mark to its corner, so a square mark
     in a 0.22 x 0.12 slot leaves 45% of that slot as bare ground — and a
     contrast reading over the slot is a reading of pixels the mark never
     covers. It reported 0.349 where the truth under the mark was 0.0012. */
  const mark = aspect === undefined ? LOGO_BOX : logoMarkBox(aspect);
  const boxWidth = mark.width * reference;
  const boxHeight = mark.height * reference;

  return {
    left: placement.endsWith("left") ? inset : width - inset - boxWidth,
    top: placement.startsWith("top") ? inset : height - inset - boxHeight,
    width: boxWidth,
    height: boxHeight,
  };
}
