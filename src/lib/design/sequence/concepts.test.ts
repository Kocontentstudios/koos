import { describe, expect, it } from "vitest";
import { textsOverlap } from "./arc";
import { conceptsIn, withConcepts } from "./concepts";
import { echoesHook } from "./outline-flags";

describe("concepts: one thing said in other words", () => {
  it("reads every way of saying the reader pays nothing as one concept", () => {
    for (const text of [
      "120 students learn to code for free",
      "At no cost to families",
      "Families pay nothing",
      "Free of charge for every student",
      "Fully sponsored places",
      "No enrolment fee",
      "Zero-cost lessons",
    ]) {
      expect(conceptsIn(text), text).toEqual(new Set(["nocost"]));
    }
  });

  it("never reads free as without", () => {
    for (const text of [
      "Products free of sulphates",
      "A sugar-free sauce",
      "Free from preservatives",
      "Free-range eggs",
    ]) {
      expect(conceptsIn(text), text).toEqual(new Set());
    }
  });

  it("makes a body point that repeats the hook's promise an echo", () => {
    expect(
      echoesHook(
        { point: "120 students learn to code for free every term" },
        { point: "At no cost to families" },
        { free: new Set() },
      ),
    ).toBe(true);
    expect(
      echoesHook(
        { point: "120 students learn to code every term" },
        { point: "Taught by volunteer engineers from the community" },
        { free: new Set() },
      ),
    ).toBe(false);
  });

  it("lets claims that share only the concept's wording overlap", () => {
    expect(
      textsOverlap(
        "Farmers rent crates at no upfront cost",
        "Farmers pay nothing upfront for crates",
      ),
    ).toBe(true);
    expect(withConcepts("Book free")).toBe("Book nocost");
  });
});
