import { describe, expect, it } from "vitest";
import { buildTitlePrompt, cleanGeneratedTitle } from "./title";

describe("cleanGeneratedTitle", () => {
  it("strips quotes/markdown and trailing punctuation", () => {
    expect(cleanGeneratedTitle('"30-Day Launch Awareness Content Plan."')).toBe(
      "30-Day Launch Awareness Content Plan",
    );
  });

  it("strips leading heading markers and smart quotes", () => {
    expect(cleanGeneratedTitle("## “Instagram Carousel Plan”")).toBe(
      "Instagram Carousel Plan",
    );
  });

  it("collapses whitespace and caps at 80 chars", () => {
    const long = `A ${"very ".repeat(40)}long title`;
    const cleaned = cleanGeneratedTitle(long);
    expect(cleaned).not.toBeNull();
    expect((cleaned as string).length).toBeLessThanOrEqual(80);
    expect(cleaned).not.toMatch(/\s{2,}/);
  });

  it("returns null for empty output", () => {
    expect(cleanGeneratedTitle("  \n ")).toBeNull();
  });
});

describe("buildTitlePrompt", () => {
  it("includes both message texts, truncated", () => {
    const prompt = buildTitlePrompt("plan my launch", "here is a plan");
    expect(prompt).toContain("plan my launch");
    expect(prompt).toContain("here is a plan");
    expect(buildTitlePrompt("x".repeat(2000), "y").length).toBeLessThan(1500);
  });
});
