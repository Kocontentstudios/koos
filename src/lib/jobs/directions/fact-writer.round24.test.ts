// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FactWriter } from "./fact-writer";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { aboveRepeats, needsFor, settleBriefFacts } = await import(
  "./brief-facts"
);
const { factLedger } = await import("./claims");
const { settleFacts } = await import("./fact-writer");

/*
 * Round-23 live run, cafe s1: "Three Tasters. ₦6,000." over a subheadline
 * giving ₦6,000 again. Both writer rewrites are replayed as the model wrote
 * them (critique-23 usage row, factRewritesRefused). The second took the
 * headline off the price and added "at the bar", and was refused only for
 * its address line matching the sibling's word for word, so the repeat
 * shipped.
 */
const CAFE =
  "Our cold brew flight is on: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Weekdays 8am to 6pm at the bar, 9 Akinola Street, Yaba. Ask for oat milk.";
const facts = [
  ...settleBriefFacts(
    [
      { kind: "price", text: "three 150ml tasters for ₦6,000" },
      { kind: "price", text: "a 1-litre bottle and two glasses for ₦15,500" },
      { kind: "time", text: "8am to 6pm" },
      { kind: "place", text: "at the bar, 9 Akinola Street, Yaba" },
    ],
    CAFE,
    { region: "NG" },
  ).facts,
  {
    kind: "product" as const,
    text: "cold brew flight",
    needs: needsFor("product", "cold brew flight"),
  },
];
const ledger = factLedger([CAFE]);
const s0 = {
  headline: "The Cold Brew Flight Is On",
  subheadline:
    "Three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Ask for oat milk.",
  cta: "Come In",
  footerLines: ["Weekdays 8am to 6pm", "At the bar, 9 Akinola Street, Yaba"],
  footerStyle: "text" as const,
};
const s1 = {
  headline: "Three Tasters. ₦6,000.",
  subheadline:
    "A cold brew flight — three 150ml tasters for ₦6,000, or go long with the 1-litre bottle.",
  cta: "Ask for oat milk",
  footerLines: ["Weekdays 8am to 6pm", "9 Akinola Street, Yaba"],
  footerStyle: "text" as const,
};
const LIVE_REWRITES = [
  {
    headline: "The Cold Brew Flight Is On",
    subheadline:
      "A cold brew flight at the bar — order the 1-litre bottle and two glasses for ₦15,500.",
    footerLines: [
      "Three tasters ₦6,000 · Bottle and two glasses ₦15,500",
      "Weekdays 8am to 6pm",
      "9 Akinola Street, Yaba",
    ],
  },
  {
    headline: "Cold Brew Flight, Three Ways.",
    subheadline:
      "Go long with a 1-litre bottle and two glasses for ₦15,500, or start with the flight.",
    footerLines: [
      "Three tasters ₦6,000 · Bottle and two glasses ₦15,500",
      "Open weekdays 8am to 6pm",
      "At the bar, 9 Akinola Street, Yaba",
    ],
  },
];

async function replay() {
  let call = 0;
  const writer: FactWriter = async () => {
    const rewrite = LIVE_REWRITES[call++];
    return rewrite ? [{ id: 1, ...rewrite }] : [];
  };
  return settleFacts({
    directions: [s0, s1],
    facts,
    ledger,
    writer,
    claimCheck: async () => [],
    briefText: CAFE,
    title: "Cold brew flight",
    asks: (id) => id === 1,
  });
}

describe("round 24: a shared footer line never outweighs a fixed repeat", () => {
  it("cafe s1: takes the rewrite that moves the headline off ₦6,000", async () => {
    expect(aboveRepeats(s1)).toEqual([
      "the subheadline repeats the headline's price",
    ]);
    const settled = await replay();
    const shipped = settled.directions[1];
    expect(shipped.headline).toBe("Cold Brew Flight, Three Ways.");
    expect(aboveRepeats(shipped)).toEqual([]);
    /* The echo of the subheadline's bottle price is left off; the line
       shared with the sibling ships, to be counted or dropped later. */
    expect(shipped.footerLines).toEqual([
      "Three tasters ₦6,000",
      "Open weekdays 8am to 6pm",
      "At the bar, 9 Akinola Street, Yaba",
    ]);
    expect(
      settled.leftOff.filter((l) => l.direction === 1).map((l) => l.fact),
    ).toEqual([]);
  });

  it("still refuses a rewrite whose only change is a line shared with the sibling", async () => {
    const writer: FactWriter = async () => [
      {
        id: 1,
        subheadline: s1.subheadline,
        footerLines: [
          "Weekdays 8am to 6pm",
          "At the bar, 9 Akinola Street, Yaba",
        ],
      },
    ];
    const plain = {
      ...s1,
      headline: "The Flight Is Poured",
      subheadline:
        "A cold brew flight — three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
      footerLines: ["Weekdays 8am to 6pm", "At the bar, 9 Akinola St, Yaba"],
    };
    const settled = await settleFacts({
      directions: [s0, plain],
      facts,
      ledger,
      writer,
      claimCheck: async () => [],
      briefText: CAFE,
      title: "Cold brew flight",
      asks: (id) => id === 1,
      attempts: 1,
    });
    expect(settled.directions[1].footerLines).toEqual(plain.footerLines);
  });
});
