import { generateObject } from "ai";
import type { DesignCategory } from "@/lib/ai/design-training/playbooks";
import {
  buildDirectionsPrompt,
  buildDirectionsSystemPrompt,
  buildRedraftPrompt,
  type DirectionsImageSource,
  type ExistingDirection,
} from "@/lib/ai/prompts/design-directions";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import type { DesignContext } from "@/lib/design/context";
import { type ConceptLens, lensReasons } from "./concepts";
import { finalizeDirection, groundingFacts } from "./finalize";
import { forceDistinctLayouts } from "./layouts";
import { repairDirectionsText } from "./repair";
import {
  type DirectionDraft,
  type DirectionSpec,
  directionsResponseSchema,
} from "./schema";
import {
  type ComparableDirection,
  contentStems,
  type DirectionOverlap,
  directionOverlap,
  isNearDuplicate,
} from "./text-overlap";

/** Two full specs plus their rationale. The single-spec cap (4000) was set
 *  because Bedrock's default truncated one spec mid-JSON. */
const DIRECTIONS_MAX_OUTPUT_TOKENS = 8000;

/* Bedrock's per-image ceiling for Claude is 3.75 MB. A larger upload is still
   used in the design; the art director just writes without seeing it. */
export const ART_DIRECTOR_IMAGE_MAX_BYTES = 3_500_000;

export interface PriorDirection
  extends ExistingDirection,
    ComparableDirection {}

export interface DraftDirectionsInput {
  context: DesignContext;
  imageSource: DirectionsImageSource;
  /** The uploaded photograph, shown to the art director when it fits. */
  image: { bytes: Uint8Array; contentType: string } | null;
  /** One lens per direction to write. */
  lenses: ConceptLens[];
  category: DesignCategory;
  recentLayouts: string[];
  memorySummary?: string;
  /** Directions that already exist (regenerating one of a pair). */
  existing?: PriorDirection[];
}

export interface DraftDirectionsResult {
  directions: DirectionSpec[];
  /** What the model returned before finalising, for the eval. */
  drafts: DirectionDraft[];
  /** Directions whose layout the forcing rule changed. */
  layoutsForced: number;
  /** A near-duplicate was found and one direction was written again. */
  redrafted: boolean;
  /** The closest pair after any redraft, new against new and new against
   *  existing. Null when there is nothing to compare. */
  overlap: DirectionOverlap | null;
  modelCalls: number;
}

function brandFacts(brand: BrandSummary): (string | null | undefined)[] {
  return [
    brand.name,
    brand.overview,
    brand.businessType,
    brand.targetAudience,
    brand.offer,
    brand.tone,
    brand.primaryGoal,
    brand.values,
    brand.wordsLove,
    brand.brandStyle,
    brand.differentiators,
  ];
}

function closestPair(
  fresh: ComparableDirection[],
  existing: ComparableDirection[],
  options: Parameters<typeof directionOverlap>[2],
): {
  overlap: DirectionOverlap;
  later: number;
  other: ComparableDirection;
} | null {
  let worst: {
    overlap: DirectionOverlap;
    later: number;
    other: ComparableDirection;
  } | null = null;
  fresh.forEach((direction, i) => {
    const others = [...existing, ...fresh.slice(0, i)];
    for (const other of others) {
      const overlap = directionOverlap(other, direction, options);
      if (!worst || overlap.max > worst.overlap.max) {
        worst = { overlap, later: i, other };
      }
    }
  });
  return worst;
}

function sharedWords(
  a: ComparableDirection,
  b: ComparableDirection,
  ignore: ReadonlySet<string>,
): string[] {
  const copy = (d: ComparableDirection) =>
    contentStems([d.headline, d.subheadline, d.cta].join(" "), ignore);
  const other = copy(b);
  return [...copy(a)].filter((s) => other.has(s)).slice(0, 8);
}

/**
 * Writes the directions: one structured call for all of them, then the
 * deterministic rules that make them a usable set.
 *
 *  1. Every draft is brought inside the contract (finalize.ts).
 *  2. If any two say the same thing (text-overlap.ts), the later one is
 *     written again, once, with the overlap named. This is the only second
 *     call, and it buys a pair of real alternatives instead of one design
 *     drawn twice; the eval measures how often the first call already passes.
 *  3. Layouts are forced apart (layouts.ts), last, because a redraft can
 *     propose a new layout.
 */
export async function draftDirections({
  context,
  imageSource,
  image,
  lenses,
  category,
  recentLayouts,
  memorySummary,
  existing = [],
}: DraftDirectionsInput): Promise<DraftDirectionsResult> {
  const hasLogo = Boolean(context.brand?.logoUrl);
  const showImage =
    image !== null && image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  const system = buildDirectionsSystemPrompt(context.brandSummary, hasLogo, {
    memorySummary,
    recentLayouts,
  });
  const facts = groundingFacts([
    context.briefText,
    context.title,
    context.designType,
    ...brandFacts(context.brandSummary),
  ]);
  const ignore = contentStems(context.brandSummary.name);
  const briefWords = contentStems(
    [context.briefText, context.title].filter(Boolean).join(" "),
  );
  const overlapOptions = {
    compareScenes: imageSource === "ko",
    ignore,
    briefWords,
  };
  let modelCalls = 0;

  async function ask(prompt: string, count: number, withImage: boolean) {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: directionsResponseSchema(count),
      system,
      maxOutputTokens: DIRECTIONS_MAX_OUTPUT_TOKENS,
      experimental_repairText: repairDirectionsText,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...(withImage && image
              ? [
                  {
                    type: "image" as const,
                    image: image.bytes,
                    mediaType: image.contentType,
                  },
                ]
              : []),
          ],
        },
      ],
    });
    return object.directions;
  }

  /* Seeing the photograph improves the copy; it is never a reason to lose the
     design. A provider that refuses image parts gets the text-only brief. */
  async function askWithImageFallback(
    buildPrompt: (attached: boolean) => string,
    count: number,
  ) {
    if (!showImage) return ask(buildPrompt(false), count, false);
    try {
      return await ask(buildPrompt(true), count, true);
    } catch (err) {
      console.error("art director could not take the photograph", err);
      return ask(buildPrompt(false), count, false);
    }
  }

  const finalize = (draft: DirectionDraft, lens: ConceptLens) =>
    finalizeDirection(draft, {
      aspectRatio: context.aspectRatio,
      facts,
      fallbackReasons: lensReasons(lens, category),
      fallbackTitle: lens.lead,
    });

  const drafts = await askWithImageFallback(
    (attached) =>
      buildDirectionsPrompt(context, {
        lenses,
        imageSource,
        imageAttached: attached,
        existing,
      }),
    lenses.length,
  );
  const directions = drafts.map((draft, i) => finalize(draft, lenses[i]));

  let redrafted = false;
  let worst = closestPair(directions, existing, overlapOptions);
  if (worst && isNearDuplicate(worst.overlap)) {
    const { later, other } = worst;
    const lens = lenses[later];
    const tooCloseTo = [
      ...existing,
      ...directions.filter((_, i) => i !== later),
    ].map((d) => ({
      title: d.title,
      headline: d.headline,
      layout: d.layout,
    }));
    try {
      const [again] = await askWithImageFallback(
        (attached) =>
          buildRedraftPrompt(context, {
            lens,
            imageSource,
            imageAttached: attached,
            tooCloseTo,
            sharedWords: sharedWords(
              directions[later],
              other,
              new Set([...ignore, ...briefWords]),
            ),
          }),
        1,
      );
      const candidate = finalize(again, lens);
      const trial = directions.map((d, i) => (i === later ? candidate : d));
      const retried = closestPair(trial, existing, overlapOptions);
      /* Kept only if it actually moved apart. A redraft that came back just
         as close is no better, and the original at least passed the gate of
         being the model's first answer to the full brief. */
      if (retried && retried.overlap.max < worst.overlap.max) {
        directions[later] = candidate;
        worst = retried;
        redrafted = true;
      }
    } catch (err) {
      console.error("direction redraft failed; keeping the first draft", err);
    }
  }

  const forced = forceDistinctLayouts(
    directions.map((d) => d.layout),
    recentLayouts,
    existing.map((d) => d.layout),
  );
  let layoutsForced = 0;
  const settled = directions.map((d, i) => {
    if (forced[i] === d.layout) return d;
    layoutsForced += 1;
    return { ...d, layout: forced[i] };
  });

  return {
    directions: settled,
    drafts,
    layoutsForced,
    redrafted,
    overlap: worst?.overlap ?? null,
    modelCalls,
  };
}
