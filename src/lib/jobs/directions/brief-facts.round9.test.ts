import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
} from "./brief-facts";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

/* The round-8 code critic's verifier probes (r8-verifier.log N1 to N12):
   an age or a count is stated only beside its own words, on their side. */

describe("a number is compared on the same side of the same words", () => {
  it.each([
    [
      "N1: a count of flavours is not an age",
      "age",
      "Ages 8+",
      "Choose from 8+ flavours",
    ],
    [
      "N2: years of baking is not an age",
      "age",
      "18+ only",
      "18+ years of baking",
    ],
    [
      "N3: seats 8 days ahead is not 8 seats",
      "quantity",
      "8 seats",
      "Book your seats 8 days ahead",
    ],
    [
      "N4: spots 20 minutes away is not 20 spots",
      "quantity",
      "20 spots",
      "Spots 20 minutes from Yaba",
    ],
    [
      "a mark is never a neighbour on its own",
      "age",
      "18+ only",
      "Strictly 18+ cocktails",
    ],
    ["an exact age is not an age and up", "age", "Ages 8+", "Ages 8 welcome"],
    ["an age and up is not an exact count", "quantity", "8 seats", "8+ seats"],
  ] as const)("%s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(false);
  });

  it.each([
    ["N5", "age", "Ages 8+", "Ages 8+ welcome"],
    ["N6", "quantity", "50 guests", "50 guests max"],
    ["N7", "age", "ages 5-12", "Kids & teens, ages 5-12"],
    [
      "N8: the range survives a '&' before it",
      "age",
      "Kids & teens ages 5-12",
      "For ages 5-12",
    ],
    ["N9", "quantity", "12 pieces", "12 pieces"],
    ["N10: a month either side", "date", "5 December", "December 5"],
    ["N11", "date", "Saturday 5 December", "Sat, Dec 5"],
    ["N12", "quantity", "only 20 spots left", "20 spots left"],
    ["'and up' is the mark", "age", "Ages 8+", "Ages 8 and up"],
    ["'and up' in the fact", "age", "ages 16 and up", "Ages 16+"],
    ["an age with nothing beside it", "age", "18+ only", "18+ only"],
    [
      "a bare age standing alone (round-9 FN2)",
      "age",
      "18+ only",
      "Strictly 18+",
    ],
  ] as const)("%s", (_label, kind, text, copy) => {
    expect(factStated(fact(kind, text), copy)).toBe(true);
  });
});
