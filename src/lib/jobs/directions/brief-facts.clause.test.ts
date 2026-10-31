import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
  redundantFooterItems,
} from "./brief-facts";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

/* The round-9 code critic's verifier probes (r9-verifier.log): a number's
   words are read in its own clause. */

describe("a number's words are in its own clause (break 1)", () => {
  it.each([
    ["FP1", "age", "Ages 8+", "Fun for all ages, 8+ flavours"],
    ["FP2", "age", "Ages 8+", "Fun for all ages: 8+ flavours to try"],
    ["FP13", "age", "Ages 8+", "All ages, 8 and up flavours"],
    ["across a semicolon", "age", "Ages 8+", "Fun for all ages; 8+ flavours"],
    ["across a spaced dash", "age", "Ages 8+", "All ages - 8+ flavours"],
    ["across an em dash", "age", "Ages 8+", "All ages—8+ flavours"],
    ["across a full stop", "quantity", "8 seats", "Book seats. 8 flavours"],
  ] as const)("%s: %s is not stated by %s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(false);
  });

  it.each([
    ["the same clause", "age", "Ages 8+", "Fun for ages 8+, all flavours"],
    ["a closing full stop", "age", "Ages 8+", "Ages 8+."],
    ["a thousands comma", "quantity", "1,500 seats", "1,500 seats left"],
    ["a spaced range dash", "age", "ages 5-12", "For ages 5 – 12"],
    ["a clock colon", "time", "7:30pm", "Doors at 7:30pm"],
    [
      "FN1: across a comma, with no word of its own",
      "age",
      "18+ only",
      "Adults only, 18+",
    ],
  ] as const)("%s: %s is stated by %s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(true);
  });
});

describe("a footer age is a repeat only of the same age above (J4)", () => {
  const footerUnder = (subheadline: string) =>
    redundantFooterItems({
      headline: "Ice cream social",
      subheadline,
      cta: "Book a table",
      footerLines: ["Ages 8+"],
    });

  it.each([
    "This Saturday. Fun for all ages, 8+ flavours.",
    "Our social is back for all ages: 8+ flavours to try.",
  ])("is not a repeat under %j", (subheadline) => {
    expect(footerUnder(subheadline)).toEqual([]);
  });

  it("is a repeat under the age itself", () => {
    expect(footerUnder("Fun for ages 8+, this Saturday.")).toEqual(["Ages 8+"]);
  });
});
