/**
 * Eval cases for campaign strategy generation.
 *
 * The feature's promise is one chat = one campaign, focused on a single goal,
 * product, offer, event or message. The failure that hurts is a strategy that
 * quietly merges everything the user mentioned into a catch-all "brand
 * awareness" plan — the chat still looks like a campaign chat, but the card
 * names nothing the user can act on.
 *
 * `nameAnchors` are lowercase substrings the campaign name must carry — any
 * one of them counts, since they are phrasings of the same topic.
 * `objectiveAnchors` is a list of GROUPS: one group per fact the objective must
 * keep, holding every acceptable phrasing of that fact. A group scores once
 * when any of its alternates appears, so the metric measures whether the fact
 * survived, not which words the model chose.
 * `strayTopics` are subjects mentioned in passing that must NOT reach the
 * campaign name — that is the mixing failure, checked deterministically rather
 * than sent to a judge.
 */

export interface StrategyEvalCase {
  id: string;
  brand: {
    name: string;
    overview: string;
    targetAudience: string;
    tone: string;
  };
  transcript: string;
  nameAnchors: string[];
  objectiveAnchors: string[][];
  strayTopics: string[];
}

const LAGOS_LOOM = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke bags, sold online to Nigerian women.",
  targetAudience:
    "Nigerian women aged 25-40 who want heritage with modern style.",
  tone: "Warm and confident.",
};

export const STRATEGY_EVAL_CASES: StrategyEvalCase[] = [
  {
    id: "single-product-launch",
    brand: LAGOS_LOOM,
    transcript: [
      "assistant: What are we building a campaign around?",
      "user: We're launching the Ìtàn tote, our first laptop-sized aso-oke bag.",
      "assistant: What does success look like?",
      "user: 200 pre-orders in the first month. It's the whole point.",
      "assistant: Anything else I should know?",
      "user: Launch is early October. Price is 85,000 naira.",
    ].join("\n\n"),
    nameAnchors: ["ìtàn", "itan", "tote"],
    objectiveAnchors: [["pre-order", "preorder", "pre order"], ["200"]],
    strayTopics: [],
  },
  {
    id: "seasonal-offer",
    brand: LAGOS_LOOM,
    transcript: [
      "assistant: What are we building a campaign around?",
      "user: Detty December. We want to run a gifting push through December.",
      "assistant: What's the goal?",
      "user: Clear the bag inventory before the year ends — sell 500 units.",
    ].join("\n\n"),
    nameAnchors: ["december", "gift"],
    objectiveAnchors: [["500"], ["sell", "clear", "move"]],
    strayTopics: [],
  },
  {
    /* The mixing case. The user mentions three things; only the one they say
       to focus on may become the campaign. A strategy naming the podcast or
       the hiring push has merged separate campaigns into one chat. */
    id: "one-campaign-from-many-topics",
    brand: LAGOS_LOOM,
    transcript: [
      "assistant: What are we building a campaign around?",
      "user: A few things going on. We're hiring two weavers, we might start a podcast, and we're opening our first physical store in Yaba.",
      "assistant: Which one should this campaign be about?",
      "user: The Yaba store opening. That's the one that matters this quarter.",
      "assistant: What does success look like?",
      "user: 1000 people through the door in the opening week.",
    ].join("\n\n"),
    nameAnchors: ["yaba", "store"],
    objectiveAnchors: [["1000"], ["opening", "open week", "first week"]],
    strayTopics: ["podcast", "hiring", "weaver"],
  },
  {
    /* A vague brief still has to resolve to ONE campaign with a nameable
       focus, not a general always-on content plan. */
    id: "vague-brief-must-still-focus",
    brand: LAGOS_LOOM,
    transcript: [
      "assistant: What are we building a campaign around?",
      "user: We want more people to know the bags are handwoven by real weavers, not factory made.",
      "assistant: What does success look like?",
      "user: More saves and shares on Instagram, honestly. Awareness.",
    ].join("\n\n"),
    nameAnchors: [
      "handwoven",
      "hand-woven",
      "woven",
      "weav",
      "loom",
      "craft",
      "artisan",
    ],
    // The transcript states two facts: how success is measured, and what the
    // campaign is about. "Awareness" is not a third fact — demanding the literal
    // word would penalize a model for writing a measurable objective instead.
    objectiveAnchors: [
      ["instagram", "save", "share", "engagement"],
      ["handwoven", "woven", "weaver", "craft", "artisan", "hand"],
    ],
    strayTopics: [],
  },
];

export const STRATEGY_EVAL_THRESHOLDS = {
  /** Every case must name its campaign after the topic the chat settled on. */
  minNameFocus: 1,
  minObjectiveFocus: 0.75,
  /** A campaign name carrying a topic the user set aside is a mixing failure. */
  maxMixedPerCase: 0,
  /** Long enough to be specific, short enough for the card and the sidebar. */
  maxNameLength: 60,
};
