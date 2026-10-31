import { describe, expect, it } from "vitest";
import { type BriefFact, factStated, needsFor } from "./brief-facts";

const quantity = (text: string): BriefFact => ({
  kind: "quantity",
  text,
  needs: needsFor("quantity", text),
});

/* A verb or a noun an allowlist did not name in front of a count hid the
   fact, so code drew it again onto another frame. */
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
    [
      "2.1 million litres sold in 2025",
      "In 2025 Aqualoop sold 2.1 million litres",
    ],
    ["10 seats", "Up to 10 seats"],
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
    /* O1 round-1 critic, MEDIUM 10: a cap or a second batch is another
       claim than the brief's exact increment. */
    ["60 more ATMs", "Up to 60 more ATMs"],
    ["60 more ATMs", "Another 60 more ATMs next year after the first 60"],
    [
      "2.1 million litres sold in 2025",
      "In 2024 Aqualoop sold 2.1 million litres",
    ],
    ["2.1 million litres sold in 2025", "Aqualoop sold 2.1 million litres"],
  ])("%s is not stated by %s", (fact, copy) => {
    expect(factStated(quantity(fact), copy)).toBe(false);
  });
});

/* A share after "to" and a group counted per teacher were read as
   unstated, so code drew "12%" onto a frame whose neighbour's headline
   already gave it. */
describe("factStated on a share and on a group per unit", () => {
  it.each([
    ["12%", "Post-harvest loss dropped from 40% to 12%.", true],
    ["12%", "Loss is down to 12%", true],
    ["12%", "12% of tomatoes are lost", true],
    ["12%", "We cut loss by 12%", true],
    ["40%", "Post-harvest loss dropped from 40% to 12%.", false],
    ["12%", "Up to 12% off", false],
    ["12%", "Over 12% of farms", false],
    ["12%", "12% to 15% of the crop", false],
    ["12%", "112% growth", false],
    ["Groups of 8 per teacher", "Every teacher takes groups of 8", true],
    ["Groups of 8 per teacher", "Groups of 8 per teacher", true],
    ["Groups of 8 per teacher", "Groups of 8", false],
    ["Groups of 8 per teacher", "Every class takes groups of 8", false],
    ["Groups of 8 per teacher", "Every teacher takes groups of 18", false],
  ] as const)("%s in %j is %s", (text, copy, stated) => {
    expect(factStated(quantity(text), copy)).toBe(stated);
  });
});
