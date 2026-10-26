import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  dropFooterRepeats,
  type FactCopy,
  factStated,
  phoneRegions,
  type ReadFact,
  redundantFooterItems,
  settleBriefFacts,
  withoutLooseRepeats,
} from "./brief-facts";
import { settleBriefRead } from "./brief-read";

/* The round-5 code critic's settle, coverage and footer probes
   (r5-settle.log, r5-spare*.log, r5-footer.log, job probes K1 to K14) and
   the round-5 live critic's footer findings, each a regression test. */

const settle = (brief: string, read: ReadFact[], product = "") =>
  settleBriefFacts(read, brief, {
    region: phoneRegions(brief, "NG"),
    product,
  });
const texts = (facts: BriefFact[]) => facts.map((f) => f.text);

const copy = (over: Partial<FactCopy> = {}): FactCopy => ({
  headline: "Fresh from the oven",
  subheadline: "Layered by hand",
  cta: "Order now",
  footerLines: [],
  footerStyle: "none",
  ...over,
});

describe("a price grows only by its unit (round-5 break 1)", () => {
  it.each([
    [
      "K4",
      "Almond croissants ₦4,500 a box for the first 50 customers.",
      "₦4,500 a box",
      "₦4,500 a box",
    ],
    [
      "C1",
      "₦4,500 a slice for the first 50 customers.",
      "₦4,500 a slice",
      "₦4,500 a slice",
    ],
    ["C3", "Tickets ₦5,000 for Saturday's show.", "₦5,000", "₦5,000"],
    ["C4", "Only ₦3,000 an amazing deal", "₦3,000", "₦3,000"],
    ["C5", "₦2,000 per 2 hours", "₦2,000", "₦2,000 per 2 hours"],
    ["a seat", "₦35,000 a seat, 8 seats.", "₦35,000", "₦35,000 a seat"],
    ["for two", "Small box ₦4,500 for two.", "₦4,500", "₦4,500 for two"],
    [
      "a set",
      "Cups ₦9,500 each, or NGN 34,000 for a set of four.",
      "NGN 34,000",
      "NGN 34,000 for a set of four",
    ],
    [
      "fintech",
      "Send money with zero transfer fees for your first month.",
      "zero transfer fees",
      "zero transfer fees",
    ],
  ])("%s", (_label, brief, read, drawn) => {
    const { facts } = settle(brief, [{ kind: "price", text: read }]);
    expect(texts(facts)).toEqual([drawn]);
  });

  /* Round-5 live critic: "Zero transfer fees for your" printed in a
     footer. A reading that ends on a dangling word is trimmed back to
     what it says. */
  it("never keeps a fact that ends mid-phrase", () => {
    const { facts } = settle(
      "Send money with zero transfer fees for your first month.",
      [{ kind: "price", text: "zero transfer fees for your" }],
    );
    expect(texts(facts)).toEqual(["zero transfer fees"]);
  });
});

describe("the brief's own words are whole words (round-5 break 3)", () => {
  it("K2: 2pm is not inside 12pm", () => {
    const read = settle("Doors open 12pm Saturday at the studio.", [
      { kind: "time", text: "2pm" },
      { kind: "day", text: "Saturday" },
    ]);
    expect(texts(read.facts)).toEqual(["Saturday"]);
    expect(read.dropped[0]).toMatchObject({ text: "2pm" });
    expect(texts(read.unread)).toEqual(["2pm"]);
  });

  it("A2: 4,500 is not inside ₦14,500", () => {
    const read = settle("Cakes now ₦14,500 a box. Pickup Lekki.", [
      { kind: "price", text: "4,500 a box" },
    ]);
    expect(read.facts).toEqual([]);
    expect(texts(read.unread)).toEqual(["4,500 a box"]);
  });

  it("A3: 50 made is not inside 150 made", () => {
    const read = settle("Only 150 made, ₦25,000 each.", [
      { kind: "quantity", text: "50 made" },
      { kind: "price", text: "₦25,000 each" },
    ]);
    expect(texts(read.facts)).toEqual(["₦25,000 each"]);
  });

  it.each([
    ["G1", "Our steamed matcha latte, ₦3,000.", "tea"],
    ["K11", "Launch our new cold brew at a lower price.", "ice"],
  ])("%s: an offering is never part of a word", (_label, brief, phrase) => {
    const read = settleBriefRead(
      { facts: [], offering: { kind: "product", phrase }, people: [] },
      brief,
      "NG",
    );
    expect(read.offering).toBeNull();
  });

  it("G3: Ada is not Adaeze", () => {
    const read = settleBriefRead(
      { facts: [], offering: null, people: ["Ada"] },
      "Join Adaeze Obi for the class.",
      "NG",
    );
    expect(read.people).toEqual([]);
  });
});

describe("near-verbatim spans are found, or recorded (round-5 break 4)", () => {
  it("K1: a phone read with spaces for the brief's dashes", () => {
    const { facts } = settle("Almond croissants. WhatsApp 0803-555-0142.", [
      { kind: "contact", text: "WhatsApp 0803 555 0142" },
    ]);
    expect(texts(facts)).toEqual(["WhatsApp 0803-555-0142"]);
  });

  it("a phone read without its spaces", () => {
    const { facts } = settle("WhatsApp 0803 555 0142 to order.", [
      { kind: "contact", text: "08035550142" },
    ]);
    expect(texts(facts)).toEqual(["WhatsApp 0803 555 0142"]);
  });

  it("A4: an ordinal the brief does not write", () => {
    const { facts } = settle("Class on Saturday 15 November, 10am.", [
      { kind: "date", text: "Saturday 15th November" },
    ]);
    expect(texts(facts)).toEqual(["Saturday 15 November"]);
  });

  it("A6: a unit the reader rephrased", () => {
    const { facts } = settle("₦4,500 per slice, Saturdays only.", [
      { kind: "price", text: "₦4,500 a slice" },
    ]);
    expect(texts(facts)).toEqual(["₦4,500 per slice"]);
  });

  it("A7: a phone a digit out is the brief's number, never the reader's", () => {
    const read = settle("Call 0803 555 0142.", [
      { kind: "contact", text: "Call 0803 555 0143" },
    ]);
    expect(texts(read.facts)).toEqual(["Call 0803 555 0142"]);
    expect(read.unread).toEqual([]);
  });

  it("records a span with a number it cannot place as unread, never drawn", () => {
    const read = settle("Book a seat for the masterclass.", [
      { kind: "date", text: "Friday 5 December" },
    ]);
    expect(read.facts).toEqual([]);
    expect(texts(read.unread)).toEqual(["Friday 5 December"]);
  });
});

describe("a contact span is one fact per number (round-5 break 5)", () => {
  it("K13: two numbers, both kept", () => {
    const { facts } = settle("Call 0803 555 0142, 0805 555 0199", [
      { kind: "contact", text: "Call 0803 555 0142, 0805 555 0199" },
    ]);
    expect(texts(facts)).toEqual(["Call 0803 555 0142", "0805 555 0199"]);
  });

  it("keeps the channel of a second number", () => {
    const { facts } = settle("Call 0803 555 0142 or WhatsApp 0805 555 0199.", [
      { kind: "contact", text: "Call 0803 555 0142 or WhatsApp 0805 555 0199" },
    ]);
    expect(texts(facts)).toEqual([
      "Call 0803 555 0142",
      "WhatsApp 0805 555 0199",
    ]);
  });

  it("reads what the reader glued after the number as its own fact", () => {
    const { facts } = settle("WhatsApp 0803 555 0142, 1-2 spots left.", [
      { kind: "contact", text: "WhatsApp 0803 555 0142, 1-2 spots left" },
    ]);
    expect(texts(facts)).toEqual(["WhatsApp 0803 555 0142", "1-2 spots left"]);
  });
});

describe("every phone in the brief is a fact (round-5 break 2)", () => {
  it("E1: the reader returned nothing", () => {
    const read = settle(
      "Strawberry mille-feuille, ₦4,500 a slice. WhatsApp 0803 555 0142.",
      [],
    );
    expect(texts(read.facts)).toEqual(["WhatsApp 0803 555 0142"]);
    expect(read.phonesAdded).toEqual(["WhatsApp 0803 555 0142"]);
  });

  it("E2: the reader omitted only the phone", () => {
    const read = settle(
      "Strawberry mille-feuille, ₦4,500 a slice. WhatsApp 0803 555 0142.",
      [{ kind: "price", text: "₦4,500 a slice" }],
    );
    expect(texts(read.facts)).toEqual([
      "₦4,500 a slice",
      "WhatsApp 0803 555 0142",
    ]);
  });

  it("a Ghana number in a Lagos brand's brief that names Accra", () => {
    const read = settle("Pop-up in Accra. Call 024 412 3456.", []);
    expect(texts(read.facts)).toEqual(["Call 024 412 3456"]);
  });

  it("is still found when the reader is down", () => {
    const read = settleBriefRead(
      null,
      "Order on WhatsApp 0803 555 0142.",
      "NG",
    );
    expect(texts(read.facts)).toEqual(["WhatsApp 0803 555 0142"]);
  });
});

describe("smaller round-5 breaks", () => {
  it("B2: two readings of one price take its two places", () => {
    const { facts } = settle(
      "Small box ₦4,500 for two. Delivery ₦4,500 per trip.",
      [
        { kind: "price", text: "₦4,500" },
        { kind: "price", text: "₦4,500" },
      ],
    );
    expect(texts(facts)).toEqual(["₦4,500 for two", "₦4,500 per trip"]);
  });

  it("an address is not cut on a weekday in its own name", () => {
    const { facts } = settle("Find us at Shop 4, Sunday Market, Ikeja.", [
      { kind: "place", text: "Shop 4, Sunday Market, Ikeja" },
    ]);
    expect(texts(facts)).toEqual(["Shop 4, Sunday Market, Ikeja"]);
  });

  it("F6: the digit groups of a phone above do not repeat it", () => {
    expect(
      redundantFooterItems(
        copy({
          headline: "Open 8am, 0803 orders",
          subheadline: "555 slices sold, 142 reviews",
          cta: "WhatsApp us",
          footerLines: ["WhatsApp 0803 555 0142"],
        }),
      ),
    ).toEqual([]);
  });
});

describe("footer repeats read for meaning (round-5 live critic)", () => {
  it("a 20-min call is the 20-minute call", () => {
    const facts = settle(
      "Monthly bookkeeping. Book a free 20-minute call on 0701 888 2210.",
      [{ kind: "offer", text: "free 20-minute call" }],
    ).facts;
    const out = dropFooterRepeats(
      [
        copy({
          headline: "Books closed by the 5th",
          cta: "Book a free call",
          footerLines: ["Book a free 20-min call: 0701 888 2210"],
          footerStyle: "text",
        }),
      ],
      facts,
    );
    expect(out.directions[0].footerLines).toEqual([
      "Book a free 20-min call: 0701 888 2210",
    ]);
  });

  it("12–6pm is 12pm to 6pm", () => {
    expect(
      redundantFooterItems(
        copy({
          headline: "The jade coat",
          subheadline: "Thu–Sun 12–6pm",
          footerLines: ["Ikoyi studio · 12pm to 6pm"],
        }),
      ),
    ).toEqual(["12pm to 6pm"]);
  });

  /* Round 7: a bare headline amount is not the price; the footer's
     price with its unit is, and stays. */
  it("keeps a footer price with its unit under a bare headline amount", () => {
    const facts = settle("Strawberry mille-feuille, ₦4,500 a slice.", [
      { kind: "price", text: "₦4,500 a slice" },
    ]).facts;
    const out = dropFooterRepeats(
      [
        copy({
          headline: "₦4,500.",
          footerLines: ["₦4,500 a slice"],
          footerStyle: "text",
        }),
      ],
      facts,
    );
    expect(out.directions[0].footerLines).toEqual(["₦4,500 a slice"]);
  });

  /* Event s0: "WhatsApp 0816 333 9025 · ₦35,000" beside "8 seats". */
  it("a footer price is drawn with its unit", () => {
    const facts = settle("Masterclass ₦35,000 a seat, 8 seats only.", [
      { kind: "price", text: "₦35,000" },
      { kind: "quantity", text: "8 seats" },
    ]).facts;
    const detached = copy({
      headline: "Laminate like a pro",
      subheadline: "8 seats only",
      footerLines: ["WhatsApp 0816 333 9025 · ₦35,000"],
      footerStyle: "text",
    });
    expect(factStated(facts[0], detached)).toBe(false);
  });
});

describe("withoutLooseRepeats", () => {
  it("drops an item that mostly repeats the copy above, never a fact", () => {
    const facts = settle("Classes at our Yaba studio, Saturday 9am.", [
      { kind: "day", text: "Saturday" },
      { kind: "time", text: "9am" },
    ]).facts;
    const out = withoutLooseRepeats(
      copy({
        headline: "Stretch in Yaba",
        subheadline: "Saturday at 9am",
        footerLines: ["Yaba studio · Saturday 9am"],
        footerStyle: "text",
      }),
      facts,
    );
    expect(out.footerLines).toEqual([]);
  });

  it("keeps an item whose words carry a fact the copy above does not", () => {
    const facts = settle("Send money to 20 African countries.", [
      { kind: "quantity", text: "20 African countries" },
    ]).facts;
    const out = withoutLooseRepeats(
      copy({
        headline: "Zero fees. 20 countries.",
        footerLines: ["20 African countries"],
        footerStyle: "text",
      }),
      facts,
    );
    expect(out.footerLines).toEqual(["20 African countries"]);
  });
});

/* Oluwaseyi's decision, round 6: a fact the headline, subheadline or
   button already states is left out of the footer; each fact still
   appears once. Round-6 eval: the judge read footer repeats on four in ten
   directions. */
describe("footers drop facts stated above", () => {
  const brief =
    "Weekend yoga retreat, ₦120,000 per person, 16 places. Book at stillwater.ng.";
  const facts = () =>
    settle(brief, [
      { kind: "price", text: "₦120,000 per person" },
      { kind: "quantity", text: "16 places" },
      { kind: "contact", text: "stillwater.ng" },
    ]).facts;

  it("drops a footer item whose fact the copy above states", () => {
    const out = dropFooterRepeats(
      [
        copy({
          headline: "Step away this December",
          subheadline: "A small-group retreat, 16 places.",
          cta: "stillwater.ng",
          footerLines: ["₦120,000 per person · 16 places", "stillwater.ng"],
          footerStyle: "text",
        }),
      ],
      facts(),
    );
    expect(out.directions[0].footerLines).toEqual(["₦120,000 per person"]);
  });
});

/* Round-6 live run, cafe: "₦15,500 bottle & 2 glasses" was not taken for
   "a 1-litre bottle and two glasses for ₦15,500". */
describe("a price stated without the size it is for", () => {
  const fact = () =>
    settle(
      "Three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
      [{ kind: "price", text: "a 1-litre bottle and two glasses for ₦15,500" }],
    ).facts[0];

  it("is stated with the count and the things, without the size", () => {
    expect(
      factStated(fact(), copy({ footerLines: ["₦15,500 bottle & 2 glasses"] })),
    ).toBe(true);
  });

  it("is not stated without the count or the thing", () => {
    expect(factStated(fact(), copy({ footerLines: ["₦15,500 bottle"] }))).toBe(
      false,
    );
    expect(
      factStated(fact(), copy({ footerLines: ["₦15,500 for two glasses"] })),
    ).toBe(false);
  });
});

describe("footer repeats, round 6d", () => {
  it("drops an item too short to say anything and one that reads 'pick up' as 'pickup'", () => {
    const out = withoutLooseRepeats(
      copy({
        headline: "The Ofe kimono jacket",
        subheadline: "Sizes S to L. Order ahead, pick up from Monday.",
        footerLines: ["S – L · Order ahead for pickup"],
        footerStyle: "text",
      }),
      [],
    );
    expect(out.footerLines).toEqual([]);
  });
});

describe("footer repeats, round 6f", () => {
  it("drops an item whose numbers the rest of the copy gives and that states no fact", () => {
    const facts = settle("Three 150ml tasters for ₦6,000.", [
      { kind: "price", text: "Three 150ml tasters for ₦6,000" },
    ]).facts;
    const out = withoutLooseRepeats(
      copy({
        headline: "The Cold Brew Flight",
        footerLines: ["₦6,000 flight", "Three 150ml tasters for ₦6,000"],
        footerStyle: "text",
      }),
      facts,
    );
    expect(out.footerLines).toEqual(["Three 150ml tasters for ₦6,000"]);
  });
});

/* Round 7 (Oluwaseyi's ruling): an offer or condition is stated only
   whole; three words in four lost "Ikoyi" (round-6 code critic, P2). */
describe("an inclusion is stated only whole", () => {
  const fact = () =>
    settle("Shared room and all meals included.", [
      { kind: "offer", text: "Shared room and all meals included" },
    ]).facts[0];

  it("is not stated in other words", () => {
    expect(
      factStated(fact(), copy({ subheadline: "Meals and a shared room." })),
    ).toBe(false);
  });

  it("is stated whole, & and incl. read as words", () => {
    expect(
      factStated(
        fact(),
        copy({ footerLines: ["Shared room & all meals incl."] }),
      ),
    ).toBe(true);
  });
});

describe("footer dedupe reads & as and, incl. as included", () => {
  it("keeps one of two spellings of one item", () => {
    expect(
      redundantFooterItems(
        copy({
          footerLines: [
            "All milk & beans incl.",
            "All milk and beans included",
          ],
        }),
      ),
    ).toEqual(["All milk and beans included"]);
  });
});
