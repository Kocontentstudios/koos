import { describe, expect, it } from "vitest";
import {
  brandSetting,
  briefFacts,
  coverBriefFacts,
  type FactCopy,
  factStated,
} from "./brief-facts";

const BAKERY =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";
const WORKSHOP =
  "Kids' croissant-making workshop this Saturday, 10am to 12pm at our Lekki shop. ₦15,000 per child, ages 7 to 12, only 8 spots. Book on WhatsApp 0803 555 0142.";
const ZOBO =
  "New this weekend: chilled zobo hibiscus cooler with ginger and pineapple, ₦1,800 for a 500ml bottle. Grab one with any pastry before noon.";
const TEXTILE =
  "Announce the autumn aso-oke collection, launching 3 November. Twelve new throws and cushions in rust and indigo, each woven by one artisan in Iseyin.";

const copy = (over: Partial<FactCopy> = {}): FactCopy => ({
  headline: "Little bakers wanted",
  footerLines: [],
  footerStyle: "none",
  ...over,
});

describe("briefFacts", () => {
  it("finds the bakery brief's price, day and time", () => {
    expect(briefFacts(BAKERY).map((f) => [f.kind, f.text])).toEqual([
      ["price", "₦4,500"],
      ["day", "Monday"],
      ["time", "7am"],
    ]);
  });

  /* Round-2 live run: both designs dropped the day, the time, the ages and
     the place. */
  it("finds every fact a parent needs in the workshop brief", () => {
    expect(briefFacts(WORKSHOP).map((f) => [f.kind, f.text])).toEqual([
      ["day", "This Saturday"],
      ["time", "10am to 12pm"],
      ["place", "Lekki"],
      ["price", "₦15,000"],
      ["age", "ages 7 to 12"],
      ["quantity", "8 spots"],
      ["contact", "WhatsApp 0803 555 0142"],
    ]);
  });

  it("finds a relative day, a size and a cut-off time", () => {
    expect(briefFacts(ZOBO).map((f) => f.text)).toEqual([
      "This weekend",
      "₦1,800",
      "500ml",
      "before noon",
    ]);
  });

  it('keeps a count whole across "and"', () => {
    expect(briefFacts(TEXTILE).map((f) => f.text)).toContain(
      "Twelve new throws and cushions",
    );
  });

  it("keeps a date's day of the month with it", () => {
    const [date] = briefFacts(TEXTILE);
    expect(date.text).toBe("3 November");
    expect(factStated(date, "Out in November")).toBe(false);
    expect(factStated(date, "Out 3 Nov")).toBe(true);
  });

  it("finds nothing in a brief with no hard facts", () => {
    expect(briefFacts("Wish our customers a happy new month")).toEqual([]);
  });
});

describe("factStated", () => {
  const [price, day, time] = briefFacts(BAKERY);

  it("accepts the fact in any spelling", () => {
    expect(factStated(price, "Just N4,500")).toBe(true);
    expect(factStated(price, "₦4.5k a slice")).toBe(true);
    expect(factStated(day, "From Mon")).toBe(true);
    expect(factStated(time, "Pickup 7:00 AM")).toBe(true);
  });

  it("refuses a different value", () => {
    expect(factStated(price, "₦45,000")).toBe(false);
    expect(factStated(day, "From Tuesday")).toBe(false);
    expect(factStated(time, "Pickup 7pm")).toBe(false);
  });

  it("needs both ends of a range and the whole number", () => {
    const facts = briefFacts(WORKSHOP);
    const range = facts.find((f) => f.kind === "time");
    const contact = facts.find((f) => f.kind === "contact");
    expect(range && factStated(range, "From 10am")).toBe(false);
    expect(range && factStated(range, "10am–12pm")).toBe(true);
    expect(contact && factStated(contact, "WhatsApp us")).toBe(false);
    expect(contact && factStated(contact, "WhatsApp 08035550142")).toBe(true);
  });
});

describe("coverBriefFacts", () => {
  it("draws what a direction left out into its footer", () => {
    const { directions, coverage } = coverBriefFacts(
      [
        copy({
          subheadline: "Croissants from scratch, ₦15,000",
          cta: "Book now",
        }),
      ],
      WORKSHOP,
    );
    expect(directions[0].footerLines).toEqual([
      "This Saturday · 10am to 12pm · Lekki · Ages 7 to 12",
      "8 spots · WhatsApp 0803 555 0142",
    ]);
    expect(directions[0].footerStyle).toBe("text");
    expect(coverage.leftOff).toEqual([]);
    expect(coverage.stated[0]).toHaveLength(coverage.facts.length);
  });

  it("leaves a direction that states everything alone", () => {
    const whole = copy({
      headline: "Strawberry mille-feuille, ₦4,500",
      subheadline: "From Monday, pickup from 7am",
    });
    const { directions, coverage } = coverBriefFacts([whole], BAKERY);
    expect(directions[0]).toBe(whole);
    expect(coverage.added).toEqual([]);
  });

  it("records what will not fit, and why, instead of overfilling", () => {
    const full = copy({
      footerLines: ["Crumb & Co.", "Lekki", "Open daily"],
      footerStyle: "bar",
    });
    const { directions, coverage } = coverBriefFacts([full], BAKERY);
    expect(directions[0].footerLines).toHaveLength(3);
    expect(coverage.leftOff).toEqual([
      {
        direction: 0,
        fact: "₦4,500",
        reason: "the footer has no room left for it",
      },
      {
        direction: 0,
        fact: "Monday",
        reason: "the footer has no room left for it",
      },
      {
        direction: 0,
        fact: "7am",
        reason: "the footer has no room left for it",
      },
    ]);
  });

  it("fills what room there is before leaving facts off", () => {
    const { directions, coverage } = coverBriefFacts(
      [copy({ footerLines: ["One", "Two"], footerStyle: "bar" })],
      WORKSHOP,
    );
    expect(directions[0].footerLines).toHaveLength(3);
    expect(coverage.leftOff.length).toBeGreaterThan(0);
    expect(coverage.leftOff.length).toBeLessThan(briefFacts(WORKSHOP).length);
  });
});

describe("brandSetting", () => {
  /* Round-2 live run: a Lagos bakery's pastry on a European street. */
  it("sets a scene where the brand is", () => {
    expect(
      brandSetting(BAKERY, [
        "Neighbourhood bakery in Lekki, Lagos, baking French pastry.",
      ]),
    ).toBe("Lekki, Lagos");
  });

  it("adds a place the brief names to the brand's", () => {
    expect(
      brandSetting("A pop-up at Landmark Centre", ["A bakery in Lagos"]),
    ).toBe("Landmark Centre, Lagos");
  });

  it("names no place when neither does", () => {
    expect(
      brandSetting("Launch our tote", ["Handwoven bags for modern homes."]),
    ).toBe(null);
  });
});
