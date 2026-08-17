import type { AspectRatio } from "../types";
import { toGoogleAspectRatio } from "../types";

export interface DesignEvalCase {
  id: string;
  prompt: string;
  aspectRatio: AspectRatio;
  /** Copy the model must render legibly, or null for the text-free plate
   * route, where any rendered lettering is a failure rather than a pass. */
  expectedText: string | null;
}

/**
 * Briefs chosen to exercise the parts of the adapter that can silently break:
 * every supported aspect ratio, the 4:5 substitution, short and long copy, and
 * the text-free plate path the composite renderer depends on.
 */
export const DESIGN_EVAL_CASES: DesignEvalCase[] = [
  {
    id: "square-wordmark",
    prompt:
      "Bold poster with the single word 'LAUNCH' in large clean sans-serif " +
      "capitals, centred on a deep teal background, minimal, high contrast.",
    aspectRatio: "1:1",
    expectedText: "LAUNCH",
  },
  {
    id: "portrait-substituted-ratio",
    prompt:
      "Social post reading exactly 'SPRING SALE' in large sans-serif capitals " +
      "on a warm coral background, clean layout, generous margins.",
    aspectRatio: "4:5",
    expectedText: "SPRING SALE",
  },
  {
    id: "landscape-two-line",
    prompt:
      "Wide banner with the headline 'OPEN TODAY' in bold sans-serif " +
      "capitals on a charcoal background, minimal, centred.",
    aspectRatio: "16:9",
    expectedText: "OPEN TODAY",
  },
  {
    id: "story-vertical",
    prompt:
      "Vertical story graphic reading exactly 'NEW DROP' in heavy sans-serif " +
      "capitals on a muted olive background, plenty of negative space.",
    aspectRatio: "9:16",
    expectedText: "NEW DROP",
  },
  {
    id: "text-free-plate",
    prompt:
      "Abstract soft gradient background texture in muted blue and grey, " +
      "smooth, no text, no lettering, no logos, no words of any kind.",
    aspectRatio: "1:1",
    expectedText: null,
  },
];

/** A run must clear these to pass. Structural checks are definitional, so they
 * allow no failures; legibility is model behaviour and is allowed to wobble. */
export const EVAL_THRESHOLDS = {
  structuralPassRate: 1.0,
  textLegibilityPassRate: 0.8,
};

const RATIO_VALUES: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

/**
 * The pixel ratio a case should actually come back as, accounting for the
 * substitution Google's enum forces on 4:5.
 */
export function expectedPixelRatio(aspectRatio: AspectRatio): number {
  const served = toGoogleAspectRatio(aspectRatio);
  const value = RATIO_VALUES[served];
  if (!value) throw new Error(`No pixel ratio known for "${served}"`);
  return value;
}

export const RATIO_TOLERANCE = 0.03;
