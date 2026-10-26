import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  dropFooterRepeats,
  type FactCopy,
  factStated,
  isFragment,
  type ReadFact,
  settleBriefFacts,
  timeOnPhoneLine,
} from "./brief-facts";
import { coverFactsOf, settleBriefRead } from "./brief-read";

/* The round-6 code critic's probes (r6-footer.log P1 to P2b, r6-greedy,
   r6-opay) and the round-6 live critic's findings, each a regression test
   of the literal verifier (Oluwaseyi's ruling, round 7). */

const settle = (brief: string, read: ReadFact[]) =>
  settleBriefFacts(read, brief, { region: "NG" }).facts;

const copy = (over: Partial<FactCopy>): FactCopy => ({
  headline: "",
  footerLines: [],
  footerStyle: "text",
  ...over,
});

const onDesign = (facts: BriefFact[], design: FactCopy) =>
  facts.filter((f) => factStated(f, design)).map((f) => f.text);

describe("a price is its currency, amount and unit in one place", () => {
  it("P1: a count above never stands for the footer price", () => {
    const facts = settle(
      "Join 2,000 happy customers. Chin chin jars ₦2,000 each. WhatsApp 0803 555 0142.",
      [
        { kind: "quantity", text: "2,000 happy customers" },
        { kind: "price", text: "₦2,000 each" },
        { kind: "contact", text: "WhatsApp 0803 555 0142" },
      ],
    );
    const design = copy({
      headline: "2,000 happy customers can't be wrong",
      subheadline: "Crunchy chin chin jars, fried fresh.",
      cta: "Order now",
      footerLines: ["₦2,000 each · WhatsApp 0803 555 0142"],
    });
    const { directions } = dropFooterRepeats([design], facts);
    expect(directions[0].footerLines).toEqual([
      "₦2,000 each · WhatsApp 0803 555 0142",
    ]);
    expect(
      factStated(facts[1], {
        ...design,
        footerLines: ["WhatsApp 0803 555 0142"],
      }),
    ).toBe(false);
  });

  it("P1b: a count with the price's number is not the price", () => {
    const facts = settle(
      "Our 50th week of baking! Cookies ₦50 a piece this Saturday only.",
      [
        { kind: "price", text: "₦50 a piece" },
        { kind: "day", text: "Saturday" },
      ],
    );
    const { directions } = dropFooterRepeats(
      [
        copy({
          headline: "50 weeks of cookies",
          subheadline: "Celebrate with us this Saturday.",
          footerLines: ["₦50 a piece"],
        }),
      ],
      facts,
    );
    expect(directions[0].footerLines).toEqual(["₦50 a piece"]);
  });

  it("is not stated without its unit (live critic: ₦18,000 per split unit)", () => {
    const [price] = settle(
      "AC servicing in Gbagada and Ikeja, ₦18,000 per split unit.",
      [{ kind: "price", text: "₦18,000 per split unit" }],
    );
    expect(price.text).toBe("₦18,000 per split unit");
    expect(
      factStated(
        price,
        copy({ subheadline: "Gas top-up and full check, ₦18,000." }),
      ),
    ).toBe(false);
    expect(
      factStated(price, copy({ footerLines: ["₦18,000 per split unit"] })),
    ).toBe(true);
  });

  it("is not stated across two places", () => {
    const [price] = settle("Cups ₦9,500 each.", [
      { kind: "price", text: "₦9,500 each" },
    ]);
    expect(
      factStated(
        { ...price, needs: [...price.needs, "^cup"] },
        copy({ headline: "Cups", footerLines: ["₦9,500"] }),
      ),
    ).toBe(false);
  });
});

describe("an offer or condition is its whole span", () => {
  it("P2: three places in four is not the offer", () => {
    const facts = settle(
      "Free delivery to Lekki, Ajah and Ikoyi this week. Cakes ₦15,000.",
      [
        { kind: "offer", text: "Free delivery to Lekki, Ajah and Ikoyi" },
        { kind: "price", text: "₦15,000" },
      ],
    );
    const { directions } = dropFooterRepeats(
      [
        copy({
          headline: "Cakes at your door",
          subheadline: "Free delivery across Lekki and Ajah this week.",
          footerLines: ["Free delivery to Lekki, Ajah and Ikoyi · ₦15,000"],
        }),
      ],
      facts,
    );
    expect(directions[0].footerLines.join(" ")).toContain("Ikoyi");
  });

  it("P2b: a condition said with the wrong item is not said", () => {
    const facts = settle(
      "Masterclass Saturday. Bring your own apron, knife and laptop. ₦20,000.",
      [
        { kind: "day", text: "Saturday" },
        { kind: "condition", text: "Bring your own apron, knife and laptop" },
        { kind: "price", text: "₦20,000" },
      ],
    );
    const design = copy({
      headline: "Cook like a pro",
      subheadline: "Saturday masterclass. Bring an apron, knife and notebook.",
      footerLines: ["Bring your own apron, knife and laptop · ₦20,000"],
    });
    const { directions } = dropFooterRepeats([design], facts);
    expect(directions[0].footerLines.join(" ")).toContain("laptop");
  });
});

describe("hours keep their numbers and are never a phone's", () => {
  it("r6-greedy: hours glued to a phone keep 9 and 5", () => {
    const read = settleBriefRead(
      {
        facts: [{ kind: "contact", text: "Call 08035550142, 9-5 weekdays" }],
        offering: { kind: "service", phrase: "Phone repairs" },
        people: [],
      } as never,
      "Phone repairs while you wait. Call 08035550142, 9-5 weekdays.",
      "NG",
    );
    const facts = coverFactsOf(read);
    const hours = facts.find((f) => f.text === "9-5 weekdays");
    expect(hours?.kind).toBe("time");
    expect(hours?.needs).toEqual(expect.arrayContaining(["=9", "=5"]));
    const design = copy({
      headline: "Fixed while you wait",
      subheadline: "Phone repairs, open weekdays.",
      cta: "Call us",
      footerLines: ["Call 08035550142 · 9-5 weekdays"],
    });
    expect(factStated(hours as BriefFact, design)).toBe(false);
    expect(
      factStated(hours as BriefFact, {
        ...design,
        footerLines: ["Call 08035550142", "9-5 weekdays"],
      }),
    ).toBe(true);
  });

  it("live critic, event s0: class hours on the phone's line are not stated", () => {
    const facts = settle("Bootcamp 9am to 4pm. Call 0705 919 2284.", [
      { kind: "time", text: "9am to 4pm" },
      { kind: "contact", text: "Call 0705 919 2284" },
    ]);
    const glued = copy({
      headline: "Sourdough bootcamp",
      footerLines: ["Call/WhatsApp 0705 919 2284 · 9am to 4pm"],
    });
    expect(timeOnPhoneLine(glued.footerLines[0])).toBe(true);
    expect(onDesign(facts, glued)).toEqual(["Call 0705 919 2284"]);
    expect(timeOnPhoneLine("Call 0705 919 2284")).toBe(false);
  });
});

describe("a backstop number keeps the brief's own lead word", () => {
  it("r6-opay: an Opay account is never a bare number", () => {
    const read = settleBriefRead(
      {
        facts: [
          { kind: "price", text: "₦12,000" },
          { kind: "contact", text: "@adabags" },
        ],
        offering: { kind: "product", phrase: "Ankara tote bags" },
        people: [],
      } as never,
      "Ankara tote bags ₦12,000. Pay by transfer to Opay 8035550142 (Ada Bags), then DM @adabags to confirm.",
      "NG",
    );
    expect(read.phonesAdded).toEqual(["Opay 8035550142"]);
  });

  it("keeps a channel word as before", () => {
    const read = settleBriefRead(
      null,
      "Order on WhatsApp 0803 555 0142.",
      "NG",
    );
    expect(read.phonesAdded).toEqual(["WhatsApp 0803 555 0142"]);
  });
});

describe("the offering is a fact every direction states", () => {
  it("live critic, cafe s1: a direction that never names the lunch is short", () => {
    const read = settleBriefRead(
      {
        facts: [
          {
            kind: "price",
            text: "a flat white and a chicken suya wrap for ₦8,900",
          },
        ],
        offering: {
          kind: "product",
          phrase: "flat white and a chicken suya wrap",
        },
        people: [],
      } as never,
      "Lunch at the bar, Mon to Fri 12 to 3pm: a flat white and a chicken suya wrap for ₦8,900.",
      "NG",
    );
    const facts = coverFactsOf(read);
    expect(facts[0]).toMatchObject({ kind: "product" });
    const design = copy({
      headline: "Lunch sorted for ₦8,900",
      subheadline: "Lunch at the bar",
    });
    expect(onDesign(facts, design)).toEqual([]);
  });
});

describe("fragments", () => {
  it.each(["Two", "10am", "₦18,000", "for your"])(
    "%s is a fragment",
    (item) => {
      expect(isFragment(item)).toBe(true);
    },
  );

  it.each(["Two senior React engineers", "Open 9am to 4pm", "Free Wi-Fi"])(
    "%s is not",
    (item) => {
      expect(isFragment(item)).toBe(false);
    },
  );
});

describe("footer items compared with each other", () => {
  it("live critic, cafe s0: 'Free Wi-Fi' beside 'Free Wi-Fi for lunch guests' goes", () => {
    const { directions } = dropFooterRepeats(
      [
        copy({
          headline: "Lunch at the bar",
          footerLines: [
            "22 Herbert Macaulay Way, Yaba · Free Wi-Fi for lunch guests",
            "Mon – Fri 12 – 3 pm • Free Wi-Fi",
          ],
        }),
      ],
      [],
    );
    expect(directions[0].footerLines).toEqual([
      "22 Herbert Macaulay Way, Yaba · Free Wi-Fi for lunch guests",
      "Mon – Fri 12 – 3 pm",
    ]);
  });
});
