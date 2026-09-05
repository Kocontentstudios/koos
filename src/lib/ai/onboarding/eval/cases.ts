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
  expected: Record<
    string,
    {
      contains: string[];
      /* Needles that must be ABSENT. A `contains` anchor alone cannot catch a
         model that fills two related columns with the same list — every
         positive anchor still matches. */
      notContains?: string[];
    }
  >;
  forbidden: string[];
}

export const EXTRACTION_EVAL_CASES: ExtractionEvalCase[] = [
  /* FEAT-018: a brand deck reaches the extractor through documentTranscript,
     so the transcript below is that framing, not a chat. A deck is a harder
     read than a conversation in one specific way — it describes an INDUSTRY as
     well as a brand, and the boilerplate around the facts is exactly what a
     model fills empty columns from. Hence the long forbidden list: everything
     a meal-prep deck makes tempting but never states. */
  {
    id: "document-brand-guidelines",
    transcript: [
      'user: I\'ve uploaded our brand document, "Okra Kitchen Brand Guidelines.pdf". Here is its text.',
      "",
      "OKRA KITCHEN — BRAND GUIDELINES v3",
      "",
      "1. WHO WE ARE",
      "Okra Kitchen is a weekly meal-prep subscription serving Lagos.",
      "We cook Nigerian home food and deliver it ready to eat.",
      "",
      "2. WHO WE SERVE",
      "Busy professionals in Lagos, aged 28 to 45, who work long hours and",
      "want to eat properly without cooking.",
      "",
      "3. VOICE",
      "Warm, plain-spoken, never fussy. We talk like a neighbour, not a chef.",
      "",
      "4. COLOUR",
      "Primary: forest green. Secondary: warm cream.",
      "Accent colours: terracotta, deep charcoal.",
      "",
      "5. TYPOGRAPHY",
      "Headlines are set in Bricolage Grotesque. Body copy is Montserrat.",
      "",
      "6. WHERE WE ARE",
      "Instagram is our main channel. We also post on TikTok and WhatsApp.",
      "We publish three times a week.",
      "",
      "7. ONLINE",
      "okrakitchen.ng",
      "",
      "user: Please take what you can from that document. Only record what it actually says — if it does not cover something, leave that field empty rather than inferring it from the industry.",
    ].join("\n"),
    expected: {
      name: { contains: ["okra kitchen"] },
      offer: { contains: ["meal"] },
      targetAudience: { contains: ["28", "45"] },
      tone: { contains: ["warm"] },
      primaryColor: { contains: ["forest green"] },
      secondaryColor: { contains: ["cream"] },
      additionalColors: { contains: ["terracotta"] },
      /* The field FEAT-018 adds. Both faces are named, so both must survive —
         a model reporting only the headline face has dropped half the answer. */
      brandFont: { contains: ["bricolage", "montserrat"] },
      platforms: { contains: ["instagram", "tiktok"] },
      primaryPlatform: {
        contains: ["instagram"],
        /* The deck names three channels and calls ONE of them main. A model
           that lists all three has answered a different question. */
        notContains: ["tiktok", "whatsapp"],
      },
      postingFrequency: { contains: ["three"] },
      websiteUrl: { contains: ["okrakitchen.ng"] },
    },
    /* None of these appear anywhere in the deck. They are what a meal-prep
       brand USUALLY says, which is precisely the invention this guards. */
    forbidden: [
      "competitors",
      "competitorStrengths",
      "differentiators",
      "stage",
      "primaryGoal",
      "wordsLove",
      "wordsAvoid",
    ],
  },
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
      "platforms",
      "primaryPlatform",
      "postingFrequency",
      "websiteUrl",
      "brandFont",
      // A catch-all is where a model dumps prose it could not place.
      "additionalNotes",
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
    /* KOS-V1-FEAT-017: the three distribution polls. Their sentences all name
       a channel, so the risk is not invention but crosstalk — the primary
       channel landing in `platforms`, or the cadence being read as a channel. */
    id: "distribution-polls",
    transcript: [
      "assistant: Hi! I'm KO. What's the brand called?",
      "user: Okra Kitchen.",
      "assistant: Which channels are you active on today?",
      "user: The channels we are active on: Instagram, TikTok, Email / Newsletter.",
      "assistant: Which of those is your main one?",
      "user: Our main channel is: Instagram.",
      "assistant: And how often do you want to post?",
      "user: We post: 3–4x / week.",
      "assistant: Got it. Do you have a website?",
      "user: Yes, https://okrakitchen.ng",
    ].join("\n\n"),
    expected: {
      name: { contains: ["okra"] },
      /* Anchored on a channel that is in the active list but is NOT the
         primary one: sharing a needle here would let a model that answered
         "Instagram" to both score green while dropping the rest. */
      platforms: { contains: ["tiktok"] },
      primaryPlatform: {
        contains: ["instagram"],
        // One channel, never the list — the other two must not appear here.
        notContains: ["tiktok", "newsletter"],
      },
      // "3–4x" not "3": "3x / week" is a different pill on the same picker.
      postingFrequency: { contains: ["3–4x"] },
      websiteUrl: { contains: ["okrakitchen"] },
    },
    // Nothing here describes the brand itself.
    forbidden: [
      "overview",
      "businessType",
      "stage",
      "targetAudience",
      "offer",
      "primaryGoal",
      "tone",
      "values",
      "wordsLove",
      "wordsAvoid",
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
