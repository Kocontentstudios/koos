import { describe, expect, it } from "vitest";
import type { BrandGuide } from "@/lib/ai/brand-guide";
import {
  brandCodexFilename,
  type CodexBrand,
  toBrandCodexMarkdown,
} from "@/lib/brand-codex";

const BRAND: CodexBrand = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke bags",
  businessType: "E-commerce / Product",
  stage: "Early",
  targetAudience: "Young professionals in Lagos",
  tone: "Bold, Warm",
  values: "Craft, honesty",
  wordsLove: "handwoven, considered",
  wordsAvoid: "cheap, mass-produced",
  brandStyle: "Minimalist",
  primaryColor: "#3A2A1F",
  additionalColors: ["#D4B8A0"],
  platforms: ["Instagram", "TikTok"],
};

const GUIDE: BrandGuide = {
  toneSpectrum: ["Playful to serious: leans warm", "Formal to casual: casual"],
  dos: ["Lead with the craft", "Name the maker", "Keep sentences short"],
  donts: ["Never say cheap", "Avoid hype", "Don't pad with adjectives"],
  writingStyleRules: [
    "Active voice",
    "One idea per sentence",
    "No exclamations",
  ],
  vocabularyGuardrails: [
    "Use handwoven, not homemade",
    "Never use cheap",
    "Say considered, not curated",
  ],
  exampleLines: ["Woven by hand in Lagos.", "Built to outlast the season."],
};

describe("toBrandCodexMarkdown", () => {
  it("titles the document after the brand", () => {
    expect(toBrandCodexMarkdown(BRAND, GUIDE)).toMatch(
      /^# Lagos Loom — Brand Codex/,
    );
  });

  it("carries every captured field through", () => {
    const md = toBrandCodexMarkdown(BRAND, GUIDE);
    for (const value of [
      "Handwoven aso-oke bags",
      "Young professionals in Lagos",
      "Bold, Warm",
      "cheap, mass-produced",
      "Minimalist",
      "#3A2A1F",
      "Instagram, TikTok",
    ]) {
      expect(md).toContain(value);
    }
  });

  it("renders the guide under its own heading", () => {
    const md = toBrandCodexMarkdown(BRAND, GUIDE);
    expect(md).toContain("## Voice & Messaging Guide");
    expect(md).toContain("### Tone spectrum");
    expect(md).toContain("### Vocabulary guardrails");
    expect(md).toContain("- Never say cheap");
    expect(md).toContain("- Woven by hand in Lagos.");
  });

  /* The guide is an enrichment fired after the fact. A brand whose synthesis
     failed still has a Codex worth downloading. */
  it("omits the guide section entirely when there is none", () => {
    const md = toBrandCodexMarkdown(BRAND, null);
    expect(md).not.toContain("Voice & Messaging Guide");
    expect(md).toContain("Handwoven aso-oke bags");
  });

  /* Unlike the admin export, which keeps nulls because a missing answer is
     information to an operator. This is the user's own document, and blank
     rows read as an unfinished product. */
  it("drops unanswered fields rather than printing empty labels", () => {
    const md = toBrandCodexMarkdown({ name: "Bare Co" }, null);
    expect(md).toBe("# Bare Co — Brand Codex\n");
  });

  it("drops a section when every field in it is blank", () => {
    const md = toBrandCodexMarkdown(
      { name: "X", overview: "Something", competitors: "   " },
      null,
    );
    expect(md).toContain("## Overview");
    expect(md).not.toContain("## Market");
  });

  it("skips empty entries inside a list", () => {
    const md = toBrandCodexMarkdown(
      { name: "X", platforms: ["Instagram", "  ", ""] },
      null,
    );
    expect(md).toContain("**Active on:** Instagram");
  });

  it("drops a list that is empty after cleaning", () => {
    const md = toBrandCodexMarkdown({ name: "X", platforms: ["  "] }, null);
    expect(md).not.toContain("## Platforms");
  });

  it("ends with exactly one newline", () => {
    expect(toBrandCodexMarkdown(BRAND, GUIDE).endsWith("\n")).toBe(true);
    expect(toBrandCodexMarkdown(BRAND, GUIDE).endsWith("\n\n")).toBe(false);
  });
});

describe("brandCodexFilename", () => {
  it("slugs the brand name", () => {
    expect(brandCodexFilename("Lagos Loom")).toBe("lagos-loom-brand-codex.md");
  });

  it("strips punctuation and collapses separators", () => {
    expect(brandCodexFilename("Soyeè.ng — Modest!")).toBe(
      "soye-ng-modest-brand-codex.md",
    );
  });

  it("falls back when the name has nothing usable", () => {
    expect(brandCodexFilename("!!!")).toBe("brand-brand-codex.md");
    expect(brandCodexFilename("   ")).toBe("brand-brand-codex.md");
  });

  it("caps a very long name", () => {
    const name = brandCodexFilename("a".repeat(200));
    expect(name.length).toBeLessThanOrEqual(60 + "-brand-codex.md".length);
  });

  /* The codex is what a brand takes away from onboarding. A question the user
     answered but that never appears in it reads as the answer being lost. */
  it("carries both sides of the competitor picture", () => {
    const codex = toBrandCodexMarkdown(
      {
        ...BRAND,
        competitors: "Cocoa Bloom",
        differentiators: "Bespoke service",
        competitorStrengths: "Bigger budget",
      },
      GUIDE,
    );
    expect(codex).toContain("What sets us apart");
    expect(codex).toContain("Bespoke service");
    expect(codex).toContain("Where competitors lead");
    expect(codex).toContain("Bigger budget");
  });
});
