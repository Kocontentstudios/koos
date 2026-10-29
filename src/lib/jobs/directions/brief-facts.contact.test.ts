import { describe, expect, it } from "vitest";
import { detailHeldElsewhere } from "./brief-facts";

/* The round-8 code critic's drop-guard probes D10 and D12
   (r8-verifier.log): a contact the guard could not read, and one it read
   inside a longer one. Both made the item droppable as said elsewhere. */

const copy = (headline: string, subheadline: string, cta: string) => ({
  headline,
  subheadline,
  cta,
  footerLines: [],
});

describe("a contact is held only where it is written whole", () => {
  it.each([
    [
      "D10: any top-level domain",
      "Visit kemicakes.xyz",
      copy("Kemi cakes", "Fresh daily", "Visit"),
    ],
    [
      "D10: a two-part domain",
      "Visit kemi.com.gh",
      copy("Kemi", "Fresh daily", "Visit"),
    ],
    [
      "D12: a handle inside a longer one",
      "DM @kemi",
      copy("Kemi", "DM @kemicakes for orders", "Order"),
    ],
    [
      "D12: a domain inside a longer one",
      "Shop adabags.ng",
      copy("Ada", "Visit shopadabags.ng", "Shop now"),
    ],
    [
      "D12: a domain with more after it",
      "Shop adabags.ng",
      copy("Ada", "Visit adabags.ng.example", "Shop now"),
    ],
  ])("%s", (_label, item, design) => {
    expect(detailHeldElsewhere(item, design)).toBe(false);
  });

  it.each([
    [
      "the handle as written",
      "DM @kemi",
      copy("Kemi", "DM @kemi for orders", "Order"),
    ],
    [
      "the handle at a sentence end",
      "DM @kemi",
      copy("Kemi", "Orders: DM @kemi.", "Order"),
    ],
    [
      "the domain in any case",
      "Visit kemicakes.xyz",
      copy("Kemi", "Order at KemiCakes.xyz", "Order"),
    ],
  ])("holds %s", (_label, item, design) => {
    expect(detailHeldElsewhere(item, design)).toBe(true);
  });
});
