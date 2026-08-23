/**
 * Eval cases for conversational brand extraction.
 *
 * Each case is a transcript plus what a careful reader should take from it:
 * `expected` fields the transcript states or clearly implies, and `forbidden`
 * fields it never mentions. The second half is the point — the failure that
 * actually hurts is KO inventing a brand's values or competitors and the user
 * confirming them onto their profile without noticing.
 *
 * `contains` holds lowercase substrings the extracted value must include.
 * These are factual anchors from the transcript, so they are checked
 * deterministically rather than sent to a judge.
 */

export interface ExtractionEvalCase {
  id: string;
  transcript: string;
  expected: Record<string, { contains: string[] }>;
  forbidden: string[];
}

export const EXTRACTION_EVAL_CASES: ExtractionEvalCase[] = [
  {
    id: "lagos-loom-rich",
    transcript: [
      "assistant: Hi! I'm KO. Tell me about your brand.",
      "user: We're Lagos Loom. We make handwoven aso-oke bags.",
      "assistant: Lovely. Who are they for?",
      "user: Nigerian women aged 25 to 40 who want heritage with modern style.",
      "assistant: And how should the brand sound?",
      "user: Warm and confident. We're about a year old, still early stage.",
      "assistant: What are you trying to achieve this year?",
      "user: Mostly growing Instagram sales. It's retail e-commerce.",
    ].join("\n\n"),
    expected: {
      name: { contains: ["lagos loom"] },
      offer: { contains: ["aso-oke"] },
      targetAudience: { contains: ["25", "40"] },
      tone: { contains: ["warm"] },
      stage: { contains: ["early"] },
      primaryGoal: { contains: ["instagram"] },
      businessType: { contains: ["retail"] },
    },
    forbidden: ["competitors", "primaryColor", "secondaryColor", "wordsAvoid"],
  },
  {
    id: "sparse-two-facts",
    transcript: [
      "assistant: Hi! I'm KO. Tell me about your brand.",
      "user: It's called Okra Kitchen. That's honestly all I've got right now.",
    ].join("\n\n"),
    expected: { name: { contains: ["okra kitchen"] } },
    // A near-empty transcript is where invention is most tempting.
    forbidden: [
      "overview",
      "businessType",
      "stage",
      "targetAudience",
      "offer",
      "tone",
      "primaryGoal",
      "values",
      "wordsLove",
      "wordsAvoid",
      "brandStyle",
      "competitors",
      "differentiators",
      "primaryColor",
      "secondaryColor",
    ],
  },
  {
    id: "colors-and-personality",
    transcript: [
      "assistant: What does the brand stand for?",
      "user: Sustainability above all, and we never use the word 'cheap'.",
      "assistant: Any visual direction?",
      "user: Our primary colour is forest green. We love the word 'crafted'.",
      "assistant: Who else is in your space?",
      "user: Mostly Zara Home, but we're handmade and they aren't.",
    ].join("\n\n"),
    expected: {
      values: { contains: ["sustainab"] },
      wordsAvoid: { contains: ["cheap"] },
      wordsLove: { contains: ["crafted"] },
      primaryColor: { contains: ["green"] },
      competitors: { contains: ["zara"] },
      differentiators: { contains: ["handmade"] },
    },
    forbidden: ["name", "stage", "primaryGoal"],
  },
];

/**
 * Recall is the headline number: the whole promise is "you don't fill the form
 * by hand", and a miss puts a field back on the user. Invention is scored
 * separately and held near zero — a wrong value confirmed onto a brand profile
 * is worse than a blank one, because the user has no reason to doubt it.
 */
export const EXTRACTION_EVAL_THRESHOLDS = {
  minRecall: 0.8,
  minValueAccuracy: 0.85,
  maxInventedPerCase: 1,
};
