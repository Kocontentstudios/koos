import type { ExtractionEvalCase } from "./cases";

/**
 * Cases for the PDF-as-file-part reader (KOOS-V1-FEAT-031).
 *
 * `pages` are the lines pdfFixture draws; `transcript` is unused by this
 * runner and carries the same text only so the shared deterministic scorer can
 * take these cases unchanged.
 *
 * The cases are shaped like a brand deck rather than a conversation, because
 * that is what users attach: a cover page, a boilerplate page about the
 * industry, and the facts scattered across both. The forbidden list is the
 * part that matters — a deck invites a model to describe the MARKET and file
 * it as the brand's own positioning.
 */
export interface ScannedPdfEvalCase extends ExtractionEvalCase {
  pages: string[];
  fileName: string;
  conversation?: string;
}

const okraPages = [
  "OKRA KITCHEN",
  "Brand Guidelines 2026",
  "",
  "WHO WE ARE",
  "A Lagos meal-prep brand cooking for busy professionals",
  "who would rather not cook on a Tuesday night.",
  "",
  "THE MARKET",
  "Nigerian food delivery is crowded and discount-led.",
  "Most competitors lead on speed and price.",
  "",
  "OUR VOICE",
  "Warm, direct, never corporate. We never say 'synergy'.",
  "",
  "COLOUR",
  "Primary: forest green. Secondary: warm cream.",
];

export const SCANNED_PDF_EVAL_CASES: ScannedPdfEvalCase[] = [
  {
    id: "deck-no-text-layer",
    fileName: "Okra Kitchen Brand Guidelines.pdf",
    pages: okraPages,
    transcript: okraPages.join("\n"),
    expected: {
      name: { contains: ["okra kitchen"] },
      overview: { contains: ["meal"] },
      targetAudience: { contains: ["professional"] },
      tone: { contains: ["warm"], notContains: ["forest green"] },
      primaryColor: { contains: ["forest green"] },
      wordsAvoid: { contains: ["synergy"] },
    },
    /* The deck describes the industry, not this brand's rivals by name, and
       never states a goal or a posting cadence. Filling them is invention the
       user would confirm without noticing. */
    forbidden: ["competitors", "primaryGoal", "postingFrequency", "website"],
  },
  {
    /* The chat is context, not a competing source: the deck says nothing about
       channels and the user has. Both belong on the profile. */
    id: "deck-plus-chat",
    fileName: "Okra Kitchen Brand Guidelines.pdf",
    pages: okraPages,
    conversation:
      "user: We're mainly on Instagram, posting about twice a week.",
    transcript: `${okraPages.join("\n")}\nuser: We're mainly on Instagram, posting about twice a week.`,
    expected: {
      name: { contains: ["okra kitchen"] },
      primaryColor: { contains: ["forest green"] },
      platforms: { contains: ["instagram"] },
    },
    forbidden: ["competitors", "primaryGoal"],
  },
];
