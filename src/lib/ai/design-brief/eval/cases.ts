import { sectionNamesFor } from "@/lib/ai/prompts/brief-structures";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { DESIGN_FORMATS, type DesignFormat } from "@/lib/design/formats";
import type { BriefCaseExpectation, BriefThresholds } from "./score";

/**
 * Conversations the brief generator has to read, one per format family that
 * used to share a template.
 *
 * Written as real design-request chats, because that is what the step
 * receives. The expectations name the format the label must resolve to and the
 * headings the routed structure owns — not the wording of the brief, which is
 * the model's to write.
 */

export const BRIEF_EVAL_BRAND: BrandSummary = {
  name: "Ekaete Foods",
  overview: "Family-run Nigerian kitchen selling frozen soups and small chops",
  businessType: "Food & beverage",
  targetAudience: "Lagos professionals who cook at the weekend",
  tone: "warm, direct, proudly local",
  brandStyle:
    "Deep green and cream, generous white space, real food photography",
  primaryColor: "#1F5C3A",
  secondaryColor: "#F3EADF",
};

/**
 * EVERY heading the format declares is required, and every heading only
 * another format declares is forbidden.
 *
 * Hand-listing three of eight headings let a brief carrying three sections
 * score a clean structure. Deriving both sets means adding a section to a
 * format automatically widens what the eval demands, and a section borrowed
 * from another format is automatically a failure.
 */
function expectations(
  id: string,
  expectedFormat: DesignFormat,
  conversation: string,
  extra: { expectsGap?: boolean } = {},
): BriefCaseExpectation {
  const own = sectionNamesFor(expectedFormat);
  const ownLower = new Set(own.map((name) => name.toLowerCase()));
  /* Every heading any OTHER format declares. Hand-listing a subset meant a
     brief could borrow a section nobody had thought to list. */
  const foreign = [
    ...new Set(DESIGN_FORMATS.flatMap((format) => sectionNamesFor(format))),
  ].filter((name) => !ownLower.has(name.toLowerCase()));

  return {
    id,
    conversation,
    expectedFormat,
    requiredSections: own,
    forbiddenSections: foreign,
    ...extra,
  };
}

/**
 * Measured 2026-10-05: `resolveDesignFormat` run free on the raw conversation
 * text scores 6 of these 10. The four it gets wrong — packaging, unnamed
 * poster, decoy keyword, no keyword — are what the identification step is paid
 * for, and the paid lane has to beat that baseline, not match it.
 */
export const BRIEF_EVAL_CASES: BriefCaseExpectation[] = [
  expectations(
    "flyer-missing-number",
    "flyer",
    /* The failure the training system's missing-information rule exists for:
       the user asks for a detail and never supplies its value. */
    [
      "user: I need a flyer for our Saturday market stall",
      "assistant: What should it say, and where is the stall?",
      "user: Egusi and jollof trays, 10am to 4pm at Lekki Phase 1. Put our phone number on it so people can pre-order.",
    ].join("\n"),
    { expectsGap: true },
  ),
  expectations(
    "thumbnail",
    "thumbnail",
    [
      "user: thumbnail for the YouTube video about how we make egusi",
      "assistant: What is the hook?",
      "user: that it takes 20 minutes, not two hours",
    ].join("\n"),
  ),
  expectations(
    "banner",
    "banner",
    [
      "user: we need a website banner for the December delivery window",
      "assistant: What is the offer?",
      "user: free delivery in Lagos on orders over 50k, ends 20 December",
    ].join("\n"),
  ),
  expectations(
    "carousel",
    "carousel",
    [
      "user: a carousel explaining how our frozen soups are made",
      "assistant: How many slides?",
      "user: five — sourcing, cooking, cooling, packing, delivery",
    ].join("\n"),
  ),
  expectations(
    "social-post",
    "social-post",
    [
      "user: an Instagram post announcing we now deliver to Ikeja",
      "assistant: Anything else to include?",
      "user: put our handle and the order line on it",
    ].join("\n"),
    /* The order line is asked for and never given, and this is the format
       whose footer the renderer draws most often. */
    { expectsGap: true },
  ),
  expectations(
    "packaging-not-generatable",
    "print-collateral",
    /* The renderer makes one flat still image. A label is not that, and the
       brief has to say so rather than quietly briefing a poster. */
    [
      "user: we need the label design for the new 1kg egusi pouch",
      "assistant: What has to appear on it?",
      "user: the name, net weight, ingredients and our logo",
    ].join("\n"),
  ),
  /* The cases above all name the deliverable in the user's own words, which
     measures resolveDesignFormat on a label copied out of
     DESIGN_TYPE_OPTIONS — something a free gate test already covers. The two
     below are what identification actually exists for. */
  expectations(
    "unnamed-poster",
    "poster",
    [
      "user: we're doing a tasting evening at the shop on the 14th and I want something for the wall",
      "assistant: Where will it go up, and how big?",
      "user: A2 in the window and a few around the estate, so people can read it walking past",
    ].join("\n"),
  ),
  expectations(
    "changed-mind",
    "carousel",
    [
      "user: I need a flyer for the new soup range",
      "assistant: What should it say?",
      "user: actually make it a carousel instead, four slides, one soup per slide",
      "assistant: Understood.",
      "user: yes four slides",
    ].join("\n"),
  ),
  /* Two cases a keyword scan gets WRONG, so this lane measures identification
     rather than a label the user already typed. resolveDesignFormat on the raw
     conversation answers "poster" for the first (the decoy matches before the
     Instagram pattern) and "other" for the second (no pattern matches at all). */
  expectations(
    "decoy-keyword",
    "social-post",
    [
      "user: I want to announce the Ikeja branch opening",
      "assistant: Where will it run?",
      "user: just Instagram. Don't make it look like a poster — something simple for the feed",
    ].join("\n"),
  ),
  expectations(
    "no-keyword",
    "social-post",
    [
      "user: we're hiring two delivery riders",
      "assistant: Where do you want to put the word out?",
      "user: on our WhatsApp status and the feed, nothing printed",
    ].join("\n"),
  ),
];

/**
 * Format resolution and structure are deterministic given the label, so they
 * are held at 1.0 — a miss there is a routing bug, not model variance. The
 * headline budget is 0.8 because "roughly N words" is a judgement and one
 * long headline in six is not a regression.
 */
export const BRIEF_EVAL_THRESHOLDS: BriefThresholds = {
  minFormatCorrect: 1,
  minStructureClean: 1,
  minWithinBudget: 0.8,
  minProductionNotes: 1,
  minSlidesCoherent: 1,
};
