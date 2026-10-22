import type { DesignContext } from "@/lib/design/context";
import type { ConceptLens } from "@/lib/jobs/directions/concepts";
import {
  COPY_LIMITS,
  COPY_TARGETS,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
} from "@/lib/jobs/directions/schema";
import {
  buildDesignSpecPrompt,
  buildDesignSpecSystemPrompt,
  type DesignSpecPromptOptions,
} from "./design-spec";
import type { BrandSummary } from "./strategy";

/**
 * The art-director prompt for directions: the single-spec prompt, unchanged,
 * plus what makes a pair of directions a pair. Built on top rather than
 * forked so every rule the spec path learned (facts, palette, logo, footer,
 * layout memory) applies here too.
 */

export type DirectionsImageSource = "upload" | "ko";

/** A direction that already exists and the new one must not echo. */
export interface ExistingDirection {
  title: string;
  headline: string;
  layout: string;
}

const t = COPY_TARGETS;

const DIRECTION_RULES = `

You are writing DIRECTIONS: distinct concepts for the same brief, each a complete design spec plus a title, a rationale and the product.

Write to length. Count the words before you answer; text over its limit is rewritten or left off the design:
- "title": 2 to ${t.title.words} words, at most ${t.title.chars} characters.
- "headline": at most ${t.headline.words} words and ${t.headline.chars} characters (hard limit ${COPY_LIMITS.headline}).
- "subheadline": at most ${t.subheadline.words} words and ${t.subheadline.chars} characters (hard limit ${COPY_LIMITS.subheadline}).
- "cta": at most ${t.cta.words} words and ${t.cta.chars} characters (hard limit ${COPY_LIMITS.cta}).
- each footer line: at most ${t.footerLine.chars} characters.
- each reason: 6 to ${t.reason.words} words, at most ${t.reason.chars} characters (hard limit ${COPY_LIMITS.reason}).

Only the brief's facts. Every number, price, time, day, date, count, duration, distance, quantity and claim in the headline, subheadline, cta, footer and reasons must be written in the brief or the brand profile above. Do not add any: no "12 artisans" when the brief says twelve throws, no "seven minutes from your door", no "free delivery", no "award-winning", no "fresh daily" unless the brief says so. A detail the brief did not give is left out, not guessed.

- "title": the concept's name, e.g. "Playful product story" or "Morning ritual". Name the idea, not the brand, and never repeat the headline: the title describes the concept to the client, the headline is the copy on the design.
- "rationale": ${DIRECTION_REASONS_MIN} to ${DIRECTION_REASONS_MAX} reasons, shown to the client on a small card as "why this works". Each reason is 6 to ${t.reason.words} words: one plain sentence, no comma-joined second thought, no explanation tacked on the end. Count the words.
  Every reason must contain at least one specific from the brief, by name: the product, a number, the price, a day, date or time, a place or person the brief names, or the people it is for. Then say what this design does with it.
  Good, at length: "The headline names the almond croissant itself" (7 words). "The ₦2,000 price is in the subheadline" (7). "The button says Order for 8am pickup" (7). "It speaks to commuters on their way to work" (9).
  Too long: "The subheadline carries the price and launch day from the brief so commuters can plan" (15, and it explains twice).
  Not allowed, however true they feel: reasons about colours, the palette, typography, type size, layout, structure, mood or "the brand's voice". They name nothing from the brief, and the layout and colours are settled after you write.
- Write reasons in the client's language about the design itself: never the words "the brief", never a layout id (hero-center, split-left and so on), never a hex code, never "Direction 1" or a mention of these instructions.
- Each reason is about this design alone: never compare it with the other direction.
- A reason may say what the copy says (quote it) and, on the client's own photograph, what it shows. On imagery KO paints, it may say only that the image shows the product: the props, setting, light and angle are painted after you write and nobody checks them. It must never say where anything sits, how big it is, how much of the frame it fills, the crop or angle, or light and contrast ("fills two-thirds of the frame", "on the left", "beside the button", "front and centre", "close three-quarter crop", "glows against the dark ground", "the visual anchor", "dominant", "large", "centred", "behind"). The layout is measured and the image painted after you write, so any such claim is a guess the client will see is false.
- A reason that names a part of the design must be true of that part: say "the subheadline gives the price" only when your subheadline contains the price.
- Never generic praise ("eye-catching", "clean and modern", "stands out", "pops"); a reason that would fit any design is a wasted line.
- "productName": the product the brief names, copied from the brief ("almond croissant"), or "" when the brief names no physical product. "productLook": what that product looks like, concretely enough that a painter who has never seen one paints the right thing: its shape, its layers, its colours, its garnish, how it is served. Use what the brief says and what the product is known to look like; never a different product.
- Each direction follows its own concept below. They must differ in idea, not in wording: a different headline built on a different lead, different supporting copy, a different layout, and a different title. If you could swap their headlines without anyone noticing, they are one direction written twice.
- Every direction has the same brand, the same facts and the same target aspect ratio. Never invent a fact to make a direction different.`;

export function buildDirectionsSystemPrompt(
  brand: BrandSummary,
  hasLogo: boolean,
  options: DesignSpecPromptOptions = {},
): string {
  return `${buildDesignSpecSystemPrompt(brand, hasLogo, options)}${DIRECTION_RULES}`;
}

function imageBlock(source: DirectionsImageSource, attached: boolean): string {
  if (source === "upload") {
    return [
      "Imagery: the client supplied their own photograph, and every direction is built around it. It fills the image area of whichever layout you choose; no image will be generated.",
      attached
        ? "The photograph is attached. Choose layouts that show its subject well, write copy that fits what is actually in it, and never describe something it does not show."
        : "The photograph is not shown to you. Write copy that does not depend on its exact contents.",
      'Set "backgroundPrompt" to a one-line description of the supplied photograph and "backgroundTreatment" to "photographic".',
    ].join(" ");
  }
  return [
    'Imagery: KO paints a separate text-free image for each direction from its "backgroundPrompt", led by "productLook".',
    "When the brief names a product, every direction's image shows that product, recognisably, as its subject: the backgroundPrompt describes the product itself first (from productLook), then the setting. Give each direction its own scene that serves its concept: a different viewpoint, setting or treatment of the same product, never a different product and never the same scene relit.",
  ].join(" ");
}

function lensBlock(lenses: ConceptLens[]): string {
  return lenses
    .map(
      (lens, i) =>
        `Direction ${i + 1} concept: ${lens.instruction} Layouts that suit it: ${lens.suits.join(", ")}.`,
    )
    .join("\n");
}

function avoidBlock(existing: ExistingDirection[]): string | null {
  if (existing.length === 0) return null;
  const listed = existing
    .map(
      (d) =>
        `- "${d.title}": headline "${d.headline}", layout ${d.layout}. Do not use the ${d.layout} layout.`,
    )
    .join("\n");
  return `These directions already exist for this brief. The new one must be a different idea from each, with a different headline, title and layout:\n${listed}`;
}

export function buildDirectionsPrompt(
  context: DesignContext,
  {
    lenses,
    imageSource,
    imageAttached,
    existing = [],
  }: {
    lenses: ConceptLens[];
    imageSource: DirectionsImageSource;
    imageAttached: boolean;
    existing?: ExistingDirection[];
  },
): string {
  const count = lenses.length;
  return [
    buildDesignSpecPrompt(context),
    `Return exactly ${count} direction${count === 1 ? "" : "s"} in "directions", in this order.`,
    lensBlock(lenses),
    avoidBlock(existing),
    imageBlock(imageSource, imageAttached),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The second chance for a direction that came back as a copy of another. */
export function buildRedraftPrompt(
  context: DesignContext,
  {
    lens,
    imageSource,
    imageAttached,
    tooCloseTo,
    sharedWords,
  }: {
    lens: ConceptLens;
    imageSource: DirectionsImageSource;
    imageAttached: boolean;
    tooCloseTo: ExistingDirection[];
    sharedWords: string[];
  },
): string {
  const shared =
    sharedWords.length > 0
      ? ` It repeated these words: ${sharedWords.join(", ")}.`
      : "";
  return [
    buildDesignSpecPrompt(context),
    `Your last direction was the same idea as one that already exists.${shared} Write ONE new direction, returned as the only entry in "directions".`,
    `Concept: ${lens.instruction} Layouts that suit it: ${lens.suits.join(", ")}.`,
    avoidBlock(tooCloseTo),
    "Keep the repeated words out of the headline unless the brief cannot be stated without them, and give it a title that shares no word with the others.",
    imageBlock(imageSource, imageAttached),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** One field the fit pass asks the model to rewrite. */
export interface FitRequest {
  id: string;
  /** What the field is, in words: "headline", "reason". */
  field: string;
  text: string;
  limit: number;
  problems: string[];
}

/**
 * The single rewrite the model gets for fields it wrote over their limit or
 * with a fact the brief does not hold. Rewriting keeps the meaning; cutting
 * the string would leave a clause hanging on the client's design.
 */
export function buildFitPrompt(
  context: DesignContext,
  requests: FitRequest[],
): string {
  const listed = requests
    .map(
      (r) =>
        `- id "${r.id}" (${r.field}, at most ${r.limit} characters): "${r.text}"\n  Problem: ${r.problems.join("; ")}.`,
    )
    .join("\n");
  return [
    "Some fields you wrote cannot go on the design as they are. Rewrite each one so it keeps its meaning and its job, and fix every problem listed.",
    `The brief: ${context.briefText ?? ""}`.trim(),
    context.title ? `Its title: ${context.title}` : null,
    "Rules: stay within the character limit with room to spare; state only facts the brief or the brand gives (no numbers, prices, times, days, counts, durations or claims it does not hold); a reason never says where anything sits, how big it is, or how light falls on it; finish every sentence, with no trailing dash, comma or ellipsis.",
    listed,
    'Return every id once in "fixes", with the rewritten text.',
  ]
    .filter(Boolean)
    .join("\n\n");
}
