import { describe, expect, it } from "vitest";
import { clampText, finalizeDirection, groundingFacts } from "./finalize";
import {
  DIRECTION_REASON_MAX,
  DIRECTION_TITLE_MAX,
  type DirectionDraft,
  directionSpecSchema,
} from "./schema";

const draft: DirectionDraft = {
  layout: "hero-center",
  headline: "Fresh croissants every morning",
  subheadline: "Baked before sunrise",
  cta: "Order now",
  footerStyle: "none",
  footerLines: [],
  palette: { background: "#FFF4E6", foreground: "#3B2416", accent: "#C2410C" },
  logoPlacement: "top-right",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "a bakery counter",
  backgroundTreatment: "photographic",
  nativePrompt: "a bakery poster",
  aspectRatio: "1:1",
  title: "Morning bake story",
  rationale: [
    "Leads with the croissant, the product commuters come in for",
    "Warm palette echoes the bakery's ovens",
  ],
};

const facts = groundingFacts([
  "Promote our croissants to commuters on their way to work",
  "Crumb & Co. bakery",
]);

const options = {
  aspectRatio: "4:5" as const,
  facts,
  fallbackReasons: [
    "Croissant leads, the first thing a food post has to land",
    "The image does the selling and the copy names what it shows",
  ],
  fallbackTitle: "croissant",
};

describe("clampText", () => {
  it("leaves text within the limit alone, whitespace collapsed", () => {
    expect(clampText("  Playful   product story ", 40)).toBe(
      "Playful product story",
    );
  });

  it("cuts at a clause break, never mid-word", () => {
    const text =
      "Leads with the almond croissant, the product commuters actually queue for every morning";
    const out = clampText(text, 60);
    expect(out).toBe("Leads with the almond croissant");
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it("never ends on a word that leaves the sentence hanging", () => {
    const out = clampText(
      "Price and day in the subheadline answer the commuter's two questions at a glance.",
      90 - 10,
    );
    expect(out).toBe(
      "Price and day in the subheadline answer the commuter's two questions",
    );
  });

  it("falls back to a word boundary when the clause break is too early", () => {
    const text =
      "Bold, an oversized headline sets the price where commuters see it first thing";
    const out = clampText(text, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(text.startsWith(out)).toBe(true);
    expect(text.charAt(out.length)).toBe(" ");
  });
});

describe("finalizeDirection", () => {
  it("draws every direction on the canvas the user asked for", () => {
    expect(finalizeDirection(draft, options).aspectRatio).toBe("4:5");
  });

  it("brings over-long titles and reasons inside the contract", () => {
    const out = finalizeDirection(
      {
        ...draft,
        title: "An extremely long concept title that rambles on and on",
        rationale: [
          "Leads with the croissant, which is the single product that commuters on their way to work queue for",
          "Warm palette echoes the bakery's ovens and the golden colour of laminated pastry in the morning light",
        ],
      },
      options,
    );
    expect(out.title.length).toBeLessThanOrEqual(DIRECTION_TITLE_MAX);
    for (const reason of out.rationale) {
      expect(reason.length).toBeLessThanOrEqual(DIRECTION_REASON_MAX);
    }
    expect(directionSpecSchema.safeParse(out).success).toBe(true);
  });

  it("drops filler while two real reasons remain", () => {
    const out = finalizeDirection(
      {
        ...draft,
        rationale: [
          "Eye-catching and modern, it stands out",
          ...draft.rationale,
        ],
      },
      options,
    );
    expect(out.rationale).toEqual(draft.rationale);
  });

  it("prefers reasons that name the brief when two or more do", () => {
    const out = finalizeDirection(
      {
        ...draft,
        rationale: [
          "Big type reads well as a thumbnail",
          "Leads with the croissant itself",
          "Speaks to commuters on their way to work",
        ],
      },
      options,
    );
    expect(out.rationale).toEqual([
      "Leads with the croissant itself",
      "Speaks to commuters on their way to work",
    ]);
  });

  it("shows whole reasons before ones it had to shorten", () => {
    const long =
      "Leads with the croissant, which is the single product that commuters on their way to work queue for";
    const out = finalizeDirection(
      {
        ...draft,
        rationale: [
          long,
          "Speaks to commuters on their way to work",
          "Warm ground echoes the bakery's ovens",
        ],
      },
      options,
    );
    expect(out.rationale).toEqual([
      "Speaks to commuters on their way to work",
      "Warm ground echoes the bakery's ovens",
    ]);
  });

  it("drops reasons that read out the spec", () => {
    const out = finalizeDirection(
      {
        ...draft,
        rationale: [
          "Split-left keeps the croissant beside the copy",
          "Leads with the croissant itself",
          "Speaks to commuters on their way to work",
        ],
      },
      options,
    );
    expect(out.rationale.some((r) => /split-left/i.test(r))).toBe(false);
  });

  it("keeps filler rather than fall below two reasons", () => {
    const out = finalizeDirection(
      {
        ...draft,
        rationale: ["Eye-catching and modern", "Clean and modern look"],
      },
      options,
    );
    expect(out.rationale).toHaveLength(2);
  });

  it("tops a single reason up from the lens", () => {
    const out = finalizeDirection(
      { ...draft, rationale: ["Leads with the croissant"] },
      options,
    );
    expect(out.rationale).toEqual([
      "Leads with the croissant",
      options.fallbackReasons[0],
    ]);
  });

  it("removes duplicate reasons and caps the list at four", () => {
    const out = finalizeDirection(
      {
        ...draft,
        rationale: [
          "One croissant reason",
          "one croissant reason",
          "Two commuters reason",
          "Three bakery reason",
          "Four work reason",
          "Five morning reason",
        ],
      },
      options,
    );
    expect(out.rationale).toHaveLength(4);
    expect(new Set(out.rationale.map((r) => r.toLowerCase())).size).toBe(4);
  });

  it("uses the lens lead when the title came back empty", () => {
    expect(finalizeDirection({ ...draft, title: "   " }, options).title).toBe(
      "croissant",
    );
  });
});

describe("groundingFacts", () => {
  it("lets a reason about the date or the price count when the brief has one", () => {
    const f = groundingFacts(["Panel on Friday 14 March at 4pm, ₦5,000 entry"]);
    expect(f.has("date")).toBe(true);
    expect(f.has("price")).toBe(true);
    const none = groundingFacts(["Eid Mubarak to our customers"]);
    expect(none.has("date")).toBe(false);
    expect(none.has("price")).toBe(false);
  });

  it("leaves out design vocabulary any rationale could use", () => {
    const f = groundingFacts([
      "Our brand colours and logo on a croissant post",
    ]);
    expect(f.has("brand")).toBe(false);
    expect(f.has("logo")).toBe(false);
    expect(f.has("croissant")).toBe(true);
  });
});
