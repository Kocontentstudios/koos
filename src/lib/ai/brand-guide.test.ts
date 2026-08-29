import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { brandGuideSchema, synthesizeBrandGuide } from "@/lib/ai/brand-guide";

const GUIDE = {
  toneSpectrum: ["Warm to cool: warm", "Formal to casual: casual"],
  dos: ["Lead with craft", "Name the maker", "Keep it short"],
  donts: ["Never say cheap", "Avoid hype", "No padding"],
  writingStyleRules: [
    "Active voice",
    "One idea per sentence",
    "No exclamations",
  ],
  vocabularyGuardrails: ["Use handwoven", "Never cheap", "Say considered"],
  exampleLines: ["Woven by hand.", "Built to last."],
};

const BRAND = {
  name: "Lagos Loom",
  overview: "Handwoven bags",
  tone: "Bold, Warm",
  wordsAvoid: "cheap",
};

describe("synthesizeBrandGuide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue({ object: GUIDE });
  });

  it("returns the synthesized guide", async () => {
    expect(await synthesizeBrandGuide(BRAND)).toEqual(GUIDE);
  });

  it("puts what is known about the brand in the prompt", async () => {
    await synthesizeBrandGuide(BRAND);

    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Lagos Loom");
    expect(prompt).toContain("Handwoven bags");
    expect(prompt).toContain("Bold, Warm");
    expect(prompt).toContain("cheap");
  });

  it("leaves out fields the brand never answered", async () => {
    await synthesizeBrandGuide({ name: "Bare Co" });

    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toBe("Brand: Bare Co");
  });

  /* The guide is an enrichment fired after the response. Onboarding must
     finish whether or not the model cooperates. */
  it("returns null rather than throwing when the model fails", async () => {
    generateObject.mockRejectedValue(new Error("provider down"));
    expect(await synthesizeBrandGuide(BRAND)).toBeNull();
  });

  it("caps its own output so one guide cannot run away", async () => {
    await synthesizeBrandGuide(BRAND);
    expect(generateObject.mock.calls[0][0].maxOutputTokens).toBe(2000);
  });
});

describe("brandGuideSchema", () => {
  it("accepts a complete guide", () => {
    expect(brandGuideSchema.safeParse(GUIDE).success).toBe(true);
  });

  it("rejects a guide missing a section", () => {
    const { dos, ...rest } = GUIDE;
    expect(brandGuideSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a section too thin to be useful", () => {
    expect(
      brandGuideSchema.safeParse({ ...GUIDE, dos: ["only one"] }).success,
    ).toBe(false);
  });

  /* Bedrock compiles this into a decoding grammar and counts optional or
     nullable properties as union-typed params, capped at 16. Required fields
     use none, so this must stay free of them. */
  it("uses no optional or nullable properties", () => {
    for (const field of Object.values(brandGuideSchema.shape)) {
      expect(field.safeParse(undefined).success).toBe(false);
      expect(field.safeParse(null).success).toBe(false);
    }
  });
});
