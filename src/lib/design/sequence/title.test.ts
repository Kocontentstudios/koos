import { describe, expect, it } from "vitest";
import { cleanTitle, isCleanTitle, settledTitle, titleLeaks } from "./title";

describe("cleanTitle", () => {
  it.each([
    ["Roasted in-house — version A", "Roasted in-house"],
    ["Reserve your bottle — Version B", "Reserve your bottle"],
    ["Shirts and repairs too — version B (P1)", "Shirts and repairs too"],
    ["The price (version 2)", "The price"],
    ["Where to find us: Option A", "Where to find us"],
    ["Made by hand (B2)", "Made by hand"],
    ["Who it is for v2", "Who it is for"],
  ])("takes the planner's label off %j", (title, clean) => {
    expect(cleanTitle(title)).toBe(clean);
  });

  it.each([
    "Take a seat",
    "Options for every budget",
    "Draft beer on tap",
    "V-neck tees",
    "Version history explained",
    "The B2B plan",
  ])("leaves a real name alone: %j", (title) => {
    expect(cleanTitle(title)).toBe(title);
    expect(titleLeaks(title)).toEqual([]);
  });
});

describe("isCleanTitle", () => {
  it("refuses a label, an empty title and one past the card's room", () => {
    expect(isCleanTitle("The price — version A")).toBe(false);
    expect(isCleanTitle("Generous portions (P3)")).toBe(false);
    expect(isCleanTitle("  ")).toBe(false);
    expect(
      isCleanTitle("A very long title that runs well past what a card shows"),
    ).toBe(false);
    expect(isCleanTitle("Where to find us")).toBe(true);
  });
});

describe("settledTitle", () => {
  it("keeps the proposed title cleaned, else the one the frame had", () => {
    expect(settledTitle("Roasted weekly — version B", "Roasting")).toBe(
      "Roasted weekly",
    );
    expect(settledTitle("version A", "Roasting")).toBe("Roasting");
    expect(settledTitle("", "Generous portions — Version A")).toBe(
      "Generous portions",
    );
  });
});
