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
    forbidden: [
      "competitors",
      "primaryColor",
      "secondaryColor",
      "additionalColors",
      "wordsAvoid",
    ],
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
      "competitorStrengths",
      "differentiators",
      "primaryColor",
      "secondaryColor",
      "additionalColors",
    ],
  },
  {
    id: "colors-and-personality",
    transcript: [
      "assistant: What does the brand stand for?",
      "user: Sustainability above all, and we never use the word 'cheap'.",
      "assistant: Any visual direction?",
      "user: Our primary colour is forest green, secondary is cream, and we also use terracotta and a bit of gold. We love the word 'crafted'.",
      "assistant: Who else is in your space?",
      "user: Mostly Zara Home, but we're handmade and they aren't.",
    ].join("\n\n"),
    expected: {
      values: { contains: ["sustainab"] },
      wordsAvoid: { contains: ["cheap"] },
      wordsLove: { contains: ["crafted"] },
      primaryColor: { contains: ["green"] },
      secondaryColor: { contains: ["cream"] },
      additionalColors: { contains: ["terracotta"] },
      competitors: { contains: ["zara"] },
      differentiators: { contains: ["handmade"] },
    },
    forbidden: ["name", "stage", "primaryGoal"],
  },
  {
    /* KOS-V1-FEAT-013. The chips answer KO by inserting a formatted user turn
       rather than free prose, so the extractor has to read that shape back out
       correctly. If formatChipSelection's wording and this drift apart, the
       user's taps stop reaching their profile and nothing else would catch it. */
    id: "chip-selections",
    transcript: [
      "assistant: Hi! I'm KO. What's the brand called?",
      "user: Okra Kitchen.",
      "assistant: Nice. How would you describe your brand's tone?",
      "user: Our brand voice is: Bold, Warm, Playful.",
      "assistant: Got it. Any words or phrases to avoid?",
      "user: Words and phrases to avoid: Synergy, Cheap, Guaranteed.",
    ].join("\n\n"),
    expected: {
      name: { contains: ["okra"] },
      tone: { contains: ["bold"] },
      wordsAvoid: { contains: ["synergy"] },
    },
    // Nothing in this transcript touches the rest of the profile.
    forbidden: [
      "overview",
      "businessType",
      "stage",
      "targetAudience",
      "offer",
      "primaryGoal",
      "values",
      "wordsLove",
      "brandStyle",
      "competitors",
      "competitorStrengths",
      "differentiators",
      "primaryColor",
      "secondaryColor",
      "additionalColors",
    ],
  },
  {
    /* KOS-V1-FEAT-016. The two competitor polls produce mirror-image sentences
       that land in DIFFERENT columns, and the only thing separating them is
       the field descriptions in extraction.ts. Swapping them is the failure
       that matters: the strategy prompt then tells the strategist to avoid
       competing where the brand's own advantage lies. */
    id: "competitor-poll-directions",
    transcript: [
      "assistant: Hi! I'm KO. What's the brand called?",
      "user: Okra Kitchen.",
      "assistant: Who else is in the space?",
      "user: Mostly Cocoa Bloom and The Lagos Pantry.",
      "assistant: What does your brand do differently or better than them?",
      "user: What we do better than competitors: Bespoke service, Local expertise.",
      "assistant: And what are those competitors genuinely good at?",
      "user: What our competitors are strong at: Bigger budget, Wider reach.",
    ].join("\n\n"),
    expected: {
      name: { contains: ["okra"] },
      competitors: { contains: ["cocoa bloom"] },
      differentiators: { contains: ["bespoke"] },
      competitorStrengths: { contains: ["budget"] },
    },
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
      "primaryColor",
      "secondaryColor",
      "additionalColors",
    ],
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
