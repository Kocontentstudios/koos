// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FactWriter } from "./fact-writer";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { settleBriefFacts, sharedFooterLines, withoutSharedFooterLines } =
  await import("./brief-facts");
const { factLedger } = await import("./claims");
const { copyProblems, headlineFault, settleFacts } = await import(
  "./fact-writer"
);
const { headlineInTheWay } = await import("./brief-facts");

/* Round-9 live critic, fashion: the pair's three footer lines were word
   for word the same, and the pair a mirror of one split. */
const FASHION =
  "The Ire wrap dress in sage silk with pearl buttons, ₦78,000, sizes 8 to 16, only 15 made. Fittings at 3 Raymond Njoku Street, Ikoyi, Tuesday to Saturday, 11am to 6pm.";
const facts = settleBriefFacts(
  [
    { kind: "price", text: "₦78,000" },
    { kind: "quantity", text: "only 15 made" },
    { kind: "place", text: "3 Raymond Njoku Street, Ikoyi" },
    { kind: "time", text: "11am to 6pm" },
  ],
  FASHION,
  { region: "NG" },
).facts;
const ledger = factLedger([FASHION]);
const footer = [
  "Priced at ₦78,000 · Only 15 made",
  "3 Raymond Njoku Street, Ikoyi",
  "Tue – Sat · 11am to 6pm",
];
const s0 = {
  headline: "The Ire Wrap Dress",
  subheadline: "Sage silk, pearl buttons. Sizes 8 to 16.",
  cta: "Book a Fitting",
  footerLines: footer,
  footerStyle: "text" as const,
};
const s1 = {
  headline: "One Dress, Every Room",
  subheadline:
    "The Ire wrap dress — sage silk and pearl buttons, sizes 8 to 16.",
  cta: "Reserve Your Size",
  footerLines: [...footer],
  footerStyle: "text" as const,
};
const passing = async () => [];

describe("round 22, finding 4: two directions never ship one footer", () => {
  it("finds the lines a later design draws word for word", () => {
    expect(sharedFooterLines(s1, [s0])).toEqual(footer);
    expect(
      sharedFooterLines({ footerLines: ["3 raymond njoku street ikoyi."] }, [
        s0,
      ]),
    ).toEqual(["3 raymond njoku street ikoyi."]);
    expect(sharedFooterLines(s0, [])).toEqual([]);
  });

  it("asks the later design to differ them, and takes a rewrite that does", async () => {
    const writer = vi.fn<FactWriter>(async () => [
      {
        id: 1,
        subheadline: s1.subheadline,
        footerLines: [
          "₦78,000, and only 15 made",
          "Fittings at 3 Raymond Njoku Street, Ikoyi",
          "Tuesday to Saturday, 11am to 6pm",
        ],
      },
    ]);
    const out = await settleFacts({
      directions: [s0, s1],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: FASHION,
      title: "",
    });
    const asked = writer.mock.calls[0]?.[0].requests ?? [];
    expect(asked.map((r) => r.id)).toEqual([1]);
    expect(asked[0].problems).toContainEqual(
      expect.stringContaining(
        'the footer line "3 Raymond Njoku Street, Ikoyi" is word for word the other design\'s',
      ),
    );
    expect(out.directions[0]).toEqual(s0);
    expect(sharedFooterLines(out.directions[1], [out.directions[0]])).toEqual(
      [],
    );
  });

  it("drops a shared line only where its facts are stated elsewhere", () => {
    const priced = {
      ...s1,
      subheadline: "Only 15 made, at ₦78,000. Sage silk with pearl buttons.",
    };
    const out = withoutSharedFooterLines([s0, priced], facts);
    expect(out.directions[1].footerLines).toEqual([
      "3 Raymond Njoku Street, Ikoyi",
      "Tue – Sat · 11am to 6pm",
    ]);
    expect(out.directions[0]).toEqual(s0);
    expect(out).toMatchObject({ dropped: 1, kept: 2 });
    expect(withoutSharedFooterLines([s0, s1], facts)).toMatchObject({
      dropped: 0,
      kept: 3,
    });
  });
});

/* Round-9 live critic, cafe s1: "Three Tasters. ₦6,000." over a
   subheadline giving ₦6,000 again. The writer was told; its fix, a
   headline naming the cold brew flight, was refused for sharing no word
   with the old one, and the repeat shipped. */
describe("round 22, finding 5c: the subheadline never repeats the headline's price", () => {
  const CAFE =
    "Our cold brew flight is on: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Weekdays 8am to 6pm at the bar, 9 Akinola Street, Yaba. Ask for oat milk.";
  const cafeFacts = [
    ...settleBriefFacts(
      [
        { kind: "price", text: "three 150ml tasters for ₦6,000" },
        { kind: "price", text: "a 1-litre bottle and two glasses for ₦15,500" },
      ],
      CAFE,
      { region: "NG" },
    ).facts,
    {
      kind: "product" as const,
      text: "cold brew flight",
      needs: ["^cold", "^brew", "^flight"],
    },
  ];
  const s1 = {
    headline: "Three Tasters. ₦6,000.",
    subheadline:
      "Cold brew flight: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
    cta: "Ask for oat milk",
    footerLines: ["Weekdays 8am to 6pm", "At the bar, 9 Akinola Street, Yaba"],
    footerStyle: "text" as const,
  };

  it("tells the writer, and lets the headline move", () => {
    expect(copyProblems(s1)).toContainEqual(
      expect.stringContaining("the subheadline repeats the headline's price"),
    );
    expect(headlineInTheWay(s1, cafeFacts)).toBe(true);
  });

  it("takes a headline that moves onto the offering's name", () => {
    const after = {
      ...s1,
      headline: "The Cold Brew Flight",
      subheadline:
        "Three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
    };
    expect(headlineFault(s1, after, cafeFacts, factLedger([CAFE]))).toBeNull();
  });

  it("still refuses a headline that drops the idea for words of its own", () => {
    const after = { ...s1, headline: "Slow Mornings, Cold Cups" };
    expect(headlineFault(s1, after, cafeFacts, factLedger([CAFE]))).toMatch(
      /drops the headline's idea/,
    );
  });
});
