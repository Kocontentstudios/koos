import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  factStated,
  settleBriefFacts,
  withVenueOrBrand,
} from "./brief-facts";

/* Round-8 eval at 33090f8, cafe-photo-upload run b: "our Yaba bar" was
   left off both directions, which said "Brew Lab, Yaba" and "Brew Lab
   Yaba", and the rewrite was refused as stating nothing more. */

const cafeBrief =
  "Our new single-origin espresso flight is here: three shots for ₦6,000, every weekday from 8am at our Yaba bar. Walk in, no booking needed.";
const placeOf = (brief: string, text: string) => {
  const { facts } = settleBriefFacts([{ kind: "place", text }], brief, {
    region: "NG",
  });
  expect(facts).toHaveLength(1);
  return facts[0] as BriefFact;
};

describe("a place named with a venue noun", () => {
  const bar = placeOf(cafeBrief, "our Yaba bar");
  const held = withVenueOrBrand([bar], "Brew Lab")[0];

  it.each([
    ["Brew Lab, Yaba", true],
    ["Brew Lab Yaba", true],
    ["Yaba bar", true],
    ["Walk in at our Yaba bar.", true],
    ["in Surulere and Yaba", false],
    ["Brew Lab, Ikeja", false],
    ["Ikeja bar", false],
    ["Brew Lab", false],
  ] as const)('"%s" states it: %s', (copy, stated) => {
    expect(factStated(held, copy)).toBe(stated);
  });

  it("is not stated by the brand and place without the brand known", () => {
    expect(factStated(bar, "Brew Lab, Yaba")).toBe(false);
    expect(factStated(bar, "Yaba bar")).toBe(true);
  });

  it("leaves a place with no venue noun as it was", () => {
    const shop = placeOf(
      "Reopening at Shop 12, Balogun Market, Lagos Island.",
      "Shop 12, Balogun Market, Lagos Island",
    );
    expect(withVenueOrBrand([shop], "Iya Basira")[0]).toEqual(shop);
  });
});

describe("an address keeps every number and street word", () => {
  const brief =
    "Latte art masterclass on Sunday 9 November at our Yaba bar, 12 Herbert Macaulay Way.";
  const address = withVenueOrBrand(
    [placeOf(brief, "our Yaba bar, 12 Herbert Macaulay Way")],
    "Brew Lab",
  )[0];

  it.each([
    ["Brew Lab, 12 Herbert Macaulay Way, Yaba", true],
    ["Our Yaba bar, 12 Herbert Macaulay Way", true],
    ["Brew Lab, Herbert Macaulay Way, Yaba", false],
    ["Brew Lab, 12 Macaulay Way, Yaba", false],
    ["12 Herbert Macaulay Way, Yaba", false],
  ] as const)('"%s" states it: %s', (copy, stated) => {
    expect(factStated(address, copy)).toBe(stated);
  });
});
