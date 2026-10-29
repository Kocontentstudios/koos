import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  detailHeldElsewhere,
  factStated,
  needsFor,
} from "./brief-facts";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

/* The round-9 code critic's false negatives (r9-verifier.log): correct
   copy the round-9 verifier refused. */

describe("round-9 false negatives are held again (finding 5)", () => {
  it.each([
    ["FN4: aged is ages", "age", "Ages 8+", "For kids aged 8+"],
    ["FN7: a colon's label", "quantity", "8 seats", "Seats: 8"],
    [
      "FN8: more is not a word of the count",
      "quantity",
      "20 spots",
      "Just 20 more spots",
    ],
    [
      "FN15: only after a colon",
      "quantity",
      "100 tickets",
      "Tickets: only 100",
    ],
    ["an age's label", "age", "Ages 8+", "Ages: 8+"],
  ] as const)("%s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(true);
  });

  it.each([
    [
      "a label with a competing noun",
      "quantity",
      "8 seats",
      "Seats: 8 flavours",
    ],
    ["a label is a word beside the number", "age", "18+ only", "Flavours: 18+"],
    [
      "a label across a comma is not a label",
      "quantity",
      "8 seats",
      "Seats, 8",
    ],
    ["another word's label", "quantity", "8 seats", "Tables: 8"],
    [
      "a colon after the number",
      "quantity",
      "20 spots",
      "Only 20 left: spots for Saturday",
    ],
  ] as const)("%s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(false);
  });

  it("D13: www. is part of a web address, not a different one", () => {
    const copy = (subheadline: string) => ({
      headline: "Kemi",
      subheadline,
      cta: "Order",
      footerLines: [],
    });
    expect(
      detailHeldElsewhere(
        "Visit kemicakes.com",
        copy("Order at www.kemicakes.com"),
      ),
    ).toBe(true);
    expect(
      detailHeldElsewhere(
        "Visit kemicakes.com",
        copy("Order at shop.kemicakes.com"),
      ),
    ).toBe(false);
  });
});
