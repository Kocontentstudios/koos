import { describe, expect, it } from "vitest";
import { factStated, settleBriefFacts } from "./brief-facts";
import { factLedger } from "./claims";
import { settleFacts } from "./fact-writer";

/*
 * Round 21, against the round-8 live critic
 * (/tmp/feat-033/critique/u3-live-verdict-round8.md). Finding 1: a price's
 * qualifier ("from", "starting at", "starting from", "up to", "only",
 * "just") is part of the price fact. Storefront s1 printed "₦18,000 each"
 * for "Hand-tied bouquets from ₦18,000 each" and was counted delivered.
 */

const STOREFRONT =
  "We reopen on Saturday 12 December after a full refit. Hand-tied bouquets from ₦18,000 each, with same-day delivery across Lekki. Open daily 9am to 7pm at 22 Admiralty Way, Lekki Phase 1. Call 0815 220 9031 to order.";
const ANKARA = "Ankara from ₦6,500 a yard, 40 prints in stock at Balogun.";

const priceOf = (brief: string, said: string) => {
  const fact = settleBriefFacts([{ kind: "price", text: said }], brief, {})
    .facts[0];
  if (!fact) throw new Error(`no price fact for ${said}`);
  return fact;
};

describe("finding 1: a price keeps the qualifier the brief puts before it", () => {
  it("takes the brief's 'from' into the fact when the reader left it off", () => {
    expect(priceOf(STOREFRONT, "₦18,000 each").text).toBe("from ₦18,000 each");
    expect(priceOf(ANKARA, "₦6,500 a yard").text).toBe("from ₦6,500 a yard");
  });

  it.each([
    [
      "Gowns starting at ₦45,000 each.",
      "₦45,000 each",
      "starting at ₦45,000 each",
    ],
    [
      "Gowns starting from ₦45,000 each.",
      "₦45,000 each",
      "starting from ₦45,000 each",
    ],
    [
      "Save up to ₦10,000 per order.",
      "₦10,000 per order",
      "up to ₦10,000 per order",
    ],
    ["Jollof only ₦2,500 a plate.", "₦2,500 a plate", "only ₦2,500 a plate"],
    ["Jollof just ₦2,500 a plate.", "₦2,500 a plate", "just ₦2,500 a plate"],
    [
      "Jollof from just ₦2,500 a plate.",
      "₦2,500 a plate",
      "from just ₦2,500 a plate",
    ],
  ])("%s", (brief, said, text) => {
    expect(priceOf(brief, said).text).toBe(text);
  });

  it("leaves a price with no qualifier, and a 'from' that is not before it", () => {
    expect(
      priceOf("Croissants ₦2,000 each, from Monday.", "₦2,000 each").text,
    ).toBe("₦2,000 each");
  });

  it("storefront s1: '₦18,000 each' on the address line does not state it", () => {
    const fact = priceOf(STOREFRONT, "₦18,000 each");
    expect(
      factStated(fact, {
        headline: "We're Back — Reopen With Us This Saturday",
        subheadline:
          "Reopening Saturday 12 December — hand-tied bouquets delivered same day across Lekki.",
        cta: "Order by Phone",
        footerLines: [
          "₦18,000 each · 22 Admiralty Way, Lekki Phase 1",
          "Open daily 9am to 7pm",
          "Call 0815 220 9031",
        ],
      }),
    ).toBe(false);
    expect(
      factStated(
        fact,
        "From ₦18,000 each, with same-day delivery across Lekki.",
      ),
    ).toBe(true);
  });

  it.each([
    ["₦6,500 a yard", false],
    ["Ankara from ₦6,500", false],
    ["From ₦6,500 a yard", true],
    ["Ankara prints from ₦6,500 per yard", true],
  ])("Ankara: %s states it: %s", (copy, stated) => {
    expect(factStated(priceOf(ANKARA, "₦6,500 a yard"), copy)).toBe(stated);
  });

  it("fails closed, then the fact writer writes the qualifier in", async () => {
    const fact = priceOf(STOREFRONT, "₦18,000 each");
    const asked: string[][] = [];
    const out = await settleFacts({
      directions: [
        {
          headline: "We're back this Saturday",
          subheadline: "Hand-tied bouquets, delivered same day across Lekki.",
          cta: "Order by Phone",
          footerLines: ["₦18,000 each · 22 Admiralty Way, Lekki Phase 1"],
          footerStyle: "text" as const,
        },
      ],
      facts: [fact],
      ledger: factLedger([STOREFRONT]),
      writer: async ({ requests }) => {
        asked.push(requests.flatMap((r) => r.missing));
        return [
          {
            id: 0,
            subheadline:
              "Hand-tied bouquets from ₦18,000 each, delivered same day across Lekki.",
            footerLines: ["22 Admiralty Way, Lekki Phase 1"],
          },
        ];
      },
      claimCheck: async () => [],
      briefText: STOREFRONT,
      title: "",
    });
    expect(asked[0]).toEqual(["from ₦18,000 each"]);
    expect(out.leftOff).toEqual([]);
    expect(factStated(fact, out.directions[0])).toBe(true);
  });
});
