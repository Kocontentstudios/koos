import { describe, expect, it } from "vitest";
import { type BriefFact, factStated, needsFor } from "./brief-facts";

const quantity = (text: string): BriefFact => ({
  kind: "quantity",
  text,
  needs: needsFor("quantity", text),
});

/* Arc round-4 critic, HIGH 2: a verb or a noun the allowlist did not name
   in front of a count hid the fact, so code drew it again onto another
   frame. */
describe("factStated on a quantity in an ordinary sentence", () => {
  it.each([
    ["done in 20 minutes", "Heel replacement done in 20 minutes"],
    ["done in 20 minutes", "Heels done in 20 minutes"],
    ["done in 20 minutes", "It is done in 20 minutes"],
    ["done in 20 minutes", "Heel replacement, done in 20 minutes"],
    ["60 more ATMs", "This round deploys 60 more ATMs"],
    ["60 more ATMs", "We add 60 more ATMs"],
    ["60 more ATMs", "The round funds 60 more ATMs"],
    [
      "2.1 million litres sold in 2025",
      "Aqualoop sold 2.1 million litres in 2025",
    ],
    ["2.1 million litres sold in 2025", "2.1 million litres sold in 2025"],
    ["12 places", "We hold 12 places a term"],
    ["1,140 farmers", "Already 1,140 farmers rent from us"],
  ])("%s is stated by %s", (fact, copy) => {
    expect(factStated(quantity(fact), copy)).toBe(true);
  });

  it.each([
    ["10 seats", "Over 10 seats sold"],
    ["10 seats", "Nearly 10 seats left"],
    ["60 more ATMs", "About 60 more ATMs"],
    ["20 customers", "The first 20 customers get a gift"],
    ["12 places", "Fewer than 12 places"],
    ["12 places", "At least 12 places"],
    ["16 places", "16 places to see around Ibadan"],
    ["60 more ATMs", "160 more ATMs"],
  ])("%s is not stated by %s", (fact, copy) => {
    expect(factStated(quantity(fact), copy)).toBe(false);
  });
});
