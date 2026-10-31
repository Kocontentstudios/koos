import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  factStated,
  needsFor,
  rivalledFacts,
  settleBriefFacts,
  withPricesBeside,
} from "./brief-facts";
import { formTokensOf } from "./fact-forms";

const price = (text: string): BriefFact => ({
  kind: "price",
  text,
  needs: needsFor("price", text),
});

const copy = (
  headline: string,
  subheadline = "",
  footerLines: string[] = [],
) => ({ headline, subheadline, cta: "Come to the bar", footerLines });

const CAFE =
  "Our cold brew flight is on: three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500. Weekdays 8am to 6pm at the bar, 9 Akinola Street, Yaba. Ask for oat milk.";
const [TASTERS, BOTTLE] = withPricesBeside([
  price("three 150ml tasters for ₦6,000"),
  price("a 1-litre bottle and two glasses for ₦15,500"),
]);

const stated = (facts: BriefFact[], c: ReturnType<typeof copy>) =>
  facts.map((f) => factStated(f, c));

/* Round-22 live run, cafe: the footer "Flight ₦6,000 · Bottle ₦15,500" and
   every writer rewrite that listed both prices were refused, each price
   read as the other's rival, and the second direction failed unnamed.
   The orchestrator applying Oluwaseyi's "of its kind" ruling of
   2026-10-28 to prices, as round 18 did to counts: two items' prices are
   not two values of one price. */
describe("round 23: a price list of different items is not a choice", () => {
  it("states both cafe prices on one footer line, each beside its own item", () => {
    expect(
      stated(
        [TASTERS, BOTTLE],
        copy("The Cold Brew Flight", "", [
          "Three tasters ₦6,000 · Bottle and two glasses ₦15,500",
        ]),
      ),
    ).toEqual([true, true]);
    expect(
      stated(
        [TASTERS, BOTTLE],
        copy("The Cold Brew Flight", "", [
          "Three tasters for ₦6,000 · Bottle and two glasses for ₦15,500",
        ]),
      ),
    ).toEqual([true, true]);
  });

  it("takes the writer's round-22 rewrite it refused: the brief's own sentence", () => {
    const rewrite = copy(
      "Your cold brew flight awaits",
      "Try three 150ml tasters for ₦6,000, or go for a 1-litre bottle and two glasses for ₦15,500.",
    );
    expect(stated([TASTERS, BOTTLE], rewrite)).toEqual([true, true]);
    expect(rivalledFacts([TASTERS, BOTTLE], rewrite)).toEqual([]);
  });

  it("the live footer is no longer read as a choice, and states neither for what it leaves out", () => {
    const live = copy("Your cold brew flight awaits", "", [
      "Flight ₦6,000 · Bottle ₦15,500",
    ]);
    expect(rivalledFacts([TASTERS, BOTTLE], live)).toEqual([]);
    /* "Flight ₦6,000" leaves out "three tasters" and "Bottle ₦15,500"
       "two glasses": every form carries the whole fact (Oluwaseyi's
       ruling, round 11), which this round does not touch. */
    expect(stated([TASTERS, BOTTLE], live)).toEqual([false, false]);
  });

  it.each([
    ["a second amount for the same item", "Three tasters ₦6,000 or ₦5,000"],
    ["a plain number", "Three tasters ₦6,000 · 15,500"],
    ["an amount bound to no item", "Three tasters ₦6,000 · ₦15,500"],
    [
      "the other item in the same clause",
      "Three tasters ₦6,000 or bottle and two glasses ₦15,500",
    ],
    [
      "the other amount given to its own item",
      "Three tasters ₦6,000 · Three tasters ₦15,500",
    ],
  ])("still refuses %s", (_why, line) => {
    expect(factStated(TASTERS, copy("The Cold Brew Flight", "", [line]))).toBe(
      false,
    );
  });

  it("refuses a tier list unless the brief prices both tiers, each with its own tier word", () => {
    const adults = price("₦6,000 per adult");
    expect(
      factStated(
        adults,
        copy("Family day", "", ["₦6,000 per adult · ₦3,000 per child"]),
      ),
    ).toBe(false);
    expect(
      factStated(
        adults,
        copy("Family day", "", ["₦6,000 per adult · Kids 3,000"]),
      ),
    ).toBe(false);
    const [both] = withPricesBeside([adults, price("₦3,000 per child")]);
    expect(
      factStated(
        both,
        copy("Family day", "", ["₦6,000 per adult · ₦3,000 per child"]),
      ),
    ).toBe(true);
    expect(
      factStated(both, copy("Family day", "", ["₦6,000 per adult · ₦3,000"])),
    ).toBe(false);
  });

  it("refuses an unbound fact beside another brief price", () => {
    const [box] = withPricesBeside([
      price("₦25,000"),
      price("₦15,000 per child"),
    ]);
    expect(
      factStated(
        box,
        copy("Valentine box", "", ["₦25,000 · ₦15,000 per child"]),
      ),
    ).toBe(false);
  });

  it("refuses two prices of one item the brief prices twice (textile store)", () => {
    const [yard] = withPricesBeside([
      price("₦6,500 a yard"),
      price("₦38,000 for 5 yards"),
    ]);
    expect(
      factStated(
        yard,
        copy("Reopening", "", ["₦6,500 a yard · ₦38,000 for 5 yards"]),
      ),
    ).toBe(false);
  });

  it("settles every price with an amount with the brief's other such prices", () => {
    const { facts } = settleBriefFacts(
      [
        { kind: "price", text: "three 150ml tasters for ₦6,000" },
        { kind: "price", text: "a 1-litre bottle and two glasses for ₦15,500" },
        { kind: "time", text: "8am to 6pm" },
      ],
      CAFE,
      {},
    );
    const prices = facts.filter((f) => f.kind === "price");
    expect(prices.map((f) => f.pricedBeside)).toEqual([
      ["a 1-litre bottle and two glasses for ₦15,500"],
      ["three 150ml tasters for ₦6,000"],
    ]);
    expect(facts.find((f) => f.kind === "time")?.pricedBeside).toBeUndefined();
  });
});

/* The critics' price rows with two amounts in one field (rounds 11, 16,
   17), each scored with the worst case beside it: every other amount on
   the design taken as a brief price for the words next to it. A row
   labelled refused stays refused; fail-open stays 0. */
describe("round 23: the critics' two-amount price rows never fail open", () => {
  function worstCase(fact: BriefFact, field: string): BriefFact {
    const own = formTokensOf(fact.text).find((t) => t.kind === "money")?.key;
    const tokens = formTokensOf(field);
    const beside = tokens.flatMap((t, i) => {
      if (t.kind !== "money" || t.key === own) return [];
      const near = (from: number, to: number) =>
        tokens
          .slice(Math.max(0, from), to)
          .filter((x) => x.kind === "word")
          .map((x) => x.text);
      return [[...near(i - 3, i), t.text, ...near(i + 1, i + 4)].join(" ")];
    });
    return { ...fact, pricedBeside: beside };
  }

  it.each([
    ["r11 M6", "₦4,500 a slice", "₦4,500 / $3 a slice"],
    ["r16 B23", "₦4,500", "₦4,500 or ₦6,000"],
    ["r16 K11", "₦25,000", "₦20,000 or ₦25,000"],
    ["r17 X5", "₦6,000", "Three shots, ₦6,000, or ₦5,000"],
    ["r17 P3", "₦4,500", "₦4,500 or 6k"],
    ["r17 P10", "₦6,000", "4,500 or ₦6,000"],
    ["r17 K30", "₦38,000", "₦38,000 or 3 for ₦100,000"],
    ["r19 tier", "₦6,000", "Adults ₦6,000 · Kids 3,000"],
    ["r19 tier 2", "₦6,000 regular", "₦6,000 regular, 4,500 students"],
  ])("%s stays refused", (_id, text, field) => {
    const fact = worstCase(price(text), field);
    expect(factStated(fact, copy("Offer", field))).toBe(false);
  });
});
