import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  brandRegion,
  brandSetting,
  dropFooterRepeats,
  type FactCopy,
  factStated,
  factsMissing,
  type ReadFact,
  redundantFooterItems,
  settleBriefFacts,
} from "./brief-facts";

const settle = (brief: string, read: ReadFact[], product = "") =>
  settleBriefFacts(read, brief, { region: "NG", product });
const texts = (facts: BriefFact[]) => facts.map((f) => [f.kind, f.text]);

const copy = (over: Partial<FactCopy> = {}): FactCopy => ({
  headline: "Little bakers wanted",
  footerLines: [],
  footerStyle: "none",
  ...over,
});

describe("settleBriefFacts: the reader's spans, held to the brief", () => {
  /* Round-4 live critic: "9 Bourdillon Road, Thursday" was printed beside
     the real address on both fashion directions. */
  it("ends an address before the weekday after it", () => {
    const brief =
      "Only 15 made. Ikoyi studio at 9 Bourdillon Road, Thursday to Sunday 12pm to 6pm.";
    const { facts } = settle(brief, [
      { kind: "place", text: "9 Bourdillon Road, Thursday" },
      { kind: "day", text: "Thursday to Sunday" },
      { kind: "time", text: "12pm to 6pm" },
      { kind: "quantity", text: "Only 15 made" },
    ]);
    expect(texts(facts)).toEqual([
      ["quantity", "Only 15 made"],
      ["place", "9 Bourdillon Road"],
      ["day", "Thursday to Sunday"],
      ["time", "12pm to 6pm"],
    ]);
    expect(factStated(facts[1], "Visit 9 Bourdillon Rd, Ikoyi")).toBe(true);
    expect(factStated(facts[2], "Thu – Sun, 12pm – 6pm")).toBe(true);
  });

  /* Round-3 code critic: "08035550142 7" was drawn as the number. */
  it("ends a phone at its last digit", () => {
    const brief = "Call 08035550142 7am to 7pm.";
    const { facts } = settle(brief, [
      { kind: "contact", text: "Call 08035550142 7" },
      { kind: "time", text: "7am to 7pm" },
    ]);
    expect(texts(facts)).toEqual([
      ["contact", "Call 08035550142"],
      ["time", "7am to 7pm"],
    ]);
  });

  /* J3: libphonenumber reads ", 9" after a number as an extension. */
  it("ends a phone before a comma and an hour", () => {
    const brief = "Call 08035550142, 9-5 weekdays.";
    const { facts } = settle(brief, [
      { kind: "contact", text: "Call 08035550142, 9" },
    ]);
    expect(texts(facts)).toEqual([["contact", "Call 08035550142"]]);
    expect(factStated(facts[0], "Call 0803 555 0142")).toBe(true);
  });

  /* Round-4 code critic J2: the number before a bare hour range vanished. */
  it("keeps a phone followed by a bare hour range, and reads the range", () => {
    const brief = "Almond croissants. WhatsApp 0803 555 0142 9-5 daily.";
    const { facts } = settle(brief, [
      { kind: "contact", text: "WhatsApp 0803 555 0142 9-5" },
      { kind: "time", text: "9-5" },
      { kind: "day", text: "daily" },
    ]);
    expect(texts(facts)).toEqual([
      ["contact", "WhatsApp 0803 555 0142"],
      ["time", "9-5"],
      ["day", "Daily"],
    ]);
    expect(factStated(facts[1], "Open 9am–5pm")).toBe(true);
    expect(factStated(facts[1], "Open 10am–5pm")).toBe(false);
  });

  /* J5: the second number of a comma list was lost. */
  it("keeps every number of a comma-separated list", () => {
    const brief = "Call 0803 555 0142, 0805 555 0199 to order.";
    const { facts } = settle(brief, [
      { kind: "contact", text: "Call 0803 555 0142" },
      { kind: "contact", text: "0805 555 0199" },
    ]);
    expect(facts).toHaveLength(2);
    expect(factsMissing(facts, "Call 0803 555 0142")).toEqual([facts[1]]);
    expect(factsMissing(facts, "0803 555 0142 or 0805 555 0199")).toEqual([]);
  });

  /* J4: "DM @cake.ng" was drawn as the website "Cake.ng". */
  it("keeps a handle a handle", () => {
    const brief = "DM @cake.ng on Instagram to order.";
    const { facts } = settle(brief, [{ kind: "contact", text: "@cake.ng" }]);
    expect(factStated(facts[0], "Order at Cake.ng")).toBe(false);
    expect(factStated(facts[0], "DM @cake.ng")).toBe(true);
  });

  /* Round-4 live critic: ₦34,000 was drawn without "for a set of four". */
  it("keeps a price with its quantity", () => {
    const brief =
      "Stoneware cups, ₦9,500 each, or NGN 34,000 for a set of four.";
    const { facts } = settle(brief, [
      { kind: "price", text: "₦9,500" },
      { kind: "price", text: "NGN 34,000" },
    ]);
    expect(texts(facts)).toEqual([
      ["price", "₦9,500 each"],
      ["price", "NGN 34,000 for a set of four"],
    ]);
    expect(factStated(facts[1], "Open daily · ₦34,000")).toBe(false);
    expect(factStated(facts[1], "₦34,000 for a set of 4")).toBe(true);
  });

  it("reads a count in words or digits", () => {
    const brief = "Jade organza overcoat, only 15 made.";
    const { facts } = settle(brief, [
      { kind: "quantity", text: "only 15 made" },
    ]);
    expect(factStated(facts[0], "Fifteen made, no more")).toBe(true);
    expect(factStated(facts[0], "Only 150 made")).toBe(false);
  });

  it("drops what is not the brief's own words, and says why", () => {
    const brief = "Pickup from 7am on Monday.";
    const { facts, dropped } = settle(brief, [
      { kind: "time", text: "7am" },
      { kind: "day", text: "Tuesday" },
      { kind: "colour", text: "red" },
    ]);
    expect(texts(facts)).toEqual([["time", "from 7am"]]);
    expect(dropped.map((d) => d.why)).toEqual([
      "not the brief's own words",
      'unknown kind "colour"',
    ]);
  });

  it("reads every day as a day, in any of its spellings", () => {
    const { facts } = settle("On sale every day at the bar.", [
      { kind: "day", text: "every day" },
    ]);
    expect(texts(facts)).toEqual([["day", "Every day"]]);
    expect(factStated(facts[0], "Open daily, 9am – 7pm")).toBe(true);
    expect(factStated(facts[0], "Open weekdays")).toBe(false);
  });

  it("drops a phone number that is not a valid number", () => {
    const brief = "Call 0803 555 for details.";
    const { facts, dropped } = settle(brief, [
      { kind: "contact", text: "Call 0803 555" },
    ]);
    expect(facts).toEqual([]);
    expect(dropped[0].why).toBe("not a valid phone number");
  });

  it("never takes the product for a fact", () => {
    const brief = "Launch our new sourdough baking class for teens.";
    const { facts } = settle(
      brief,
      [{ kind: "offer", text: "sourdough baking class" }],
      "sourdough baking class",
    );
    expect(facts).toEqual([]);
  });

  it("keeps the longer of two facts that overlap", () => {
    const brief = "Latte art on Sunday 9 November, 2pm to 5pm.";
    const { facts } = settle(brief, [
      { kind: "date", text: "Sunday 9 November" },
      { kind: "day", text: "Sunday" },
    ]);
    expect(texts(facts)).toEqual([["date", "Sunday 9 November"]]);
    expect(factStated(facts[0], "Sun 9 Nov")).toBe(true);
    expect(factStated(facts[0], "Sun 19 Nov")).toBe(false);
  });

  it("reads 3/11 by the brand's day order", () => {
    const read = [{ kind: "date", text: "3/11" }];
    const ng = settleBriefFacts(read, "Opens 3/11.", { region: "NG" });
    const us = settleBriefFacts(read, "Opens 3/11.", { region: "US" });
    expect(factStated(ng.facts[0], "Opens 3 November")).toBe(true);
    expect(factStated(us.facts[0], "Opens March 11")).toBe(true);
  });
});

describe("factStated for phone numbers", () => {
  const [phone] = settle("WhatsApp 0803 555 0142 to book.", [
    { kind: "contact", text: "WhatsApp 0803 555 0142" },
  ]).facts;

  it("accepts the number in any grouping, or with the country code", () => {
    expect(factStated(phone, "WhatsApp 08035550142")).toBe(true);
    expect(factStated(phone, "Call 0803-555-0142")).toBe(true);
    expect(factStated(phone, "+234 803 555 0142")).toBe(true);
  });

  /* Round-4 code critic: digits glued across lines counted as the number. */
  it("needs the whole number on one line", () => {
    expect(factStated(phone, "WhatsApp 0803 555 014 \n Ages 2-5")).toBe(false);
    expect(factStated(phone, "803 555 0142")).toBe(false);
    expect(factStated(phone, "WhatsApp 0803 555 01423")).toBe(false);
  });
});

describe("redundantFooterItems", () => {
  /* Round-4 live critic: five of eleven directions repeated the
     subheadline in the footer. */
  it("drops an item the copy above already says", () => {
    expect(
      redundantFooterItems({
        headline: "Strawberry mille-feuille",
        subheadline: "Available from Monday, 7am pickup",
        footerLines: ["Available from Monday · Pickup from 7am"],
      }),
    ).toEqual(["Available from Monday", "Pickup from 7am"]);
  });

  it("drops the shorter of two items saying the same", () => {
    expect(
      redundantFooterItems({
        headline: "The coat, named",
        footerLines: ["9 Bourdillon Road, Ikoyi · 9 Bourdillon Road"],
      }),
    ).toEqual(["9 Bourdillon Road"]);
  });

  it("drops the product's name when the copy above names it", () => {
    expect(
      redundantFooterItems(
        {
          headline: "Handmade stoneware cups",
          footerLines: ["4 Sabo Road, Yaba · Handmade stoneware cups"],
        },
        "stoneware cups",
      ),
    ).toEqual(["Handmade stoneware cups"]);
  });

  it("keeps an offer that only shares a place with the copy", () => {
    expect(
      redundantFooterItems({
        headline: "Now baking in Lekki",
        footerLines: ["Free delivery in Lekki"],
      }),
    ).toEqual([]);
  });
});

describe("dropFooterRepeats", () => {
  it("drops footer repeats of the copy above", () => {
    const { directions, dropped } = dropFooterRepeats(
      [
        copy({
          subheadline: "Available from Monday, 7am pickup",
          footerLines: ["Available from Monday · Pickup from 7am"],
          footerStyle: "text",
        }),
      ],
      [],
    );
    expect(directions[0].footerLines).toEqual([]);
    expect(directions[0].footerStyle).toBe("none");
    expect(dropped).toBe(2);
  });

  it("never writes: a direction short of a fact is left as it is", () => {
    const { facts } = settle("Cups ₦9,500 each. WhatsApp 0803 555 0142.", [
      { kind: "price", text: "₦9,500 each" },
      { kind: "contact", text: "WhatsApp 0803 555 0142" },
    ]);
    const short = copy({ headline: "Cups for the shelf" });
    expect(dropFooterRepeats([short], facts).directions[0]).toEqual(short);
  });
});

describe("brandRegion and brandSetting", () => {
  it("reads the brand's country from its profile", () => {
    expect(brandRegion(["Coffee bar in Accra"])).toBe("GH");
    expect(brandRegion([null, "A shop"])).toBe("NG");
  });

  it("sets a scene where the brief and the brand are", () => {
    const facts = settle("At our Yaba bar.", [
      { kind: "place", text: "our Yaba bar" },
    ]).facts;
    expect(brandSetting(facts, ["Specialty coffee in Lagos"])).toBe(
      "our Yaba bar, Lagos",
    );
    expect(brandSetting([], ["Neighbourhood bakery in Lekki, Lagos"])).toBe(
      "Lekki, Lagos",
    );
    expect(brandSetting([], [null])).toBeNull();
  });
});
