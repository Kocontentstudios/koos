import type { DesignContext } from "@/lib/design/context";
import type { ConceptLens } from "@/lib/jobs/directions/concepts";
import {
  DIRECTION_REASON_MAX,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
  DIRECTION_TITLE_MAX,
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

const DIRECTION_RULES = `

You are writing DIRECTIONS: distinct concepts for the same brief, each a complete design spec plus:
- "title": the concept's name, 2 to 4 words, at most ${DIRECTION_TITLE_MAX} characters, e.g. "Playful product story" or "Editorial arch frame". Name the idea, not the brand, and never repeat the headline: the title describes the concept to the client, the headline is the copy on the design.
- "rationale": ${DIRECTION_REASONS_MIN} to ${DIRECTION_REASONS_MAX} reasons, shown to the client as "why this works". Each is ONE short sentence of at most 10 words, about 70 characters and never over ${DIRECTION_REASON_MAX}, with no second clause after a dash or comma. Each names one concrete choice in THIS design and the thing from the brief it answers, using the brief's own words: the product, the offer, the price, the date, the audience, the occasion. Never generic praise ("eye-catching", "clean and modern", "stands out", "pops"); a reason that would fit any design is a wasted line.
- The client reads the rationale, so write it in their language: never a layout id (hero-center, split-left and so on), never a hex code, never "Direction 1" or a mention of these instructions. Say "the price sits beside the button", not "stat-highlight puts the price first".
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
    'Imagery: KO paints a separate text-free background image for each direction from its "backgroundPrompt".',
    "Give each direction its own scene that serves its concept: a different subject, viewpoint or treatment, never the same scene relit.",
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
