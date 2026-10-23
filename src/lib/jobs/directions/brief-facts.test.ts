import { describe, expect, it } from "vitest";
import {
  brandRegion,
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
      footerLines: [
        "Crumb & Co., 12 Admiralty Way, Lekki Phase 1, Lagos State",
        "Open every day, all year round, for pastry and good coffee",
        "Follow us for new bakes, seasonal specials and pop-up dates",
      ],
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
      [
        copy({
          footerLines: [
            "Crumb & Co., 12 Admiralty Way, Lekki Phase 1, Lagos",
            "Follow us for new bakes and seasonal specials",
          ],
          footerStyle: "bar",
        }),
      ],
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

/* Round-3 code critic, break 1: a hand pattern glued a time or a count
   onto the phone number and lost the fact it took. */
describe("phone numbers", () => {
  const read = (brief: string) =>
    briefFacts(brief).map((f) => `${f.kind}:${f.text}`);

  it.each([
    [
      "Call 08035550142 7am to 7pm.",
      ["contact:08035550142", "time:7am to 7pm"],
    ],
    [
      "WhatsApp 0803 555 0142 9am-5pm daily.",
      ["contact:WhatsApp 0803 555 0142", "time:9am-5pm"],
    ],
    [
      "Book on 0803 555 0142 2 seats left.",
      ["contact:0803 555 0142", "quantity:2 seats"],
    ],
    [
      "Tickets ₦5000 - 08035550142 for bookings.",
      ["price:₦5000", "contact:08035550142"],
    ],
    [
      "Orders: 0803 555 0142 10 slices max.",
      ["contact:0803 555 0142", "quantity:10 slices"],
    ],
    ["Call 0803 555 0142 2pm onwards.", ["contact:0803 555 0142", "time:2pm"]],
  ])("reads %s", (brief, facts) => {
    expect(read(brief)).toEqual(facts);
  });

  it("states the number in any national or international spelling", () => {
    const [phone] = briefFacts("Call 0803 555 0142.");
    expect(factStated(phone, "Call +234 803 555 0142")).toBe(true);
    expect(factStated(phone, "Call 08035550142")).toBe(true);
    expect(factStated(phone, "Call 0803 555 0143")).toBe(false);
  });

  it("reads a number in the brand's own country", () => {
    const [uk] = briefFacts("Ring 020 7946 0958 to book.", { region: "GB" });
    expect(uk.text).toBe("020 7946 0958");
    expect(brandRegion(["A bakery in Shoreditch, London"])).toBe("GB");
    expect(brandRegion([null, "A bakery in Lekki"])).toBe("NG");
  });
});

/* Round-3 code critic, break 3: facts missed or misread. */
describe("facts the round-3 detector missed", () => {
  const read = (brief: string) =>
    briefFacts(brief).map((f) => `${f.kind}:${f.text}`);

  it("reads plural days, addresses, discounts, dotted and 24-hour times", () => {
    expect(read("Open Saturdays 9am to 2pm at our Ikoyi shop.")).toEqual([
      "day:Saturdays",
      "time:9am to 2pm",
      "place:Ikoyi",
    ]);
    expect(read("Visit 14 Bourdillon Road, Ikoyi this Friday.")).toEqual([
      "place:14 Bourdillon Road, Ikoyi",
      "day:This Friday",
    ]);
    expect(read("30% off all throws this weekend only.")).toEqual([
      "price:30% off",
      "day:This weekend",
    ]);
    expect(read("Price 4500 per slice, pickup 07:00.")).toEqual([
      "price:Price 4500",
      "time:07:00",
    ]);
    expect(read("Workshop on 3/11 at 10am.")).toEqual([
      "day:3/11",
      "time:10am",
    ]);
  });

  it("reads half past as half past", () => {
    const [time] = briefFacts("Doors open at 6.30pm, Landmark Centre.");
    expect(time.text).toBe("6.30pm");
    expect(factStated(time, "Doors 6:30pm")).toBe(true);
    expect(factStated(time, "Doors 30pm")).toBe(false);
  });

  it("never reads a language or a colour as a place", () => {
    expect(
      read("Classes taught in Yoruba and English, ages 6-12, every Saturday."),
    ).toEqual(["age:ages 6-12", "day:Every Saturday"]);
    expect(read("Our tote now comes in Black, Tan and Olive.")).toEqual([]);
  });

  it("counts 07:00 as 7am, so the time is not drawn twice", () => {
    const [time] = briefFacts("Pickup 7am.");
    expect(factStated(time, "Pickup 07:00")).toBe(true);
  });

  it("reads a date by the brand's day order", () => {
    const [nov] = briefFacts("Workshop on 3/11.");
    expect(factStated(nov, "3 November")).toBe(true);
    const [mar] = briefFacts("Workshop on 3/11.", { region: "US" });
    expect(factStated(mar, "March 11")).toBe(true);
  });
});

/* Round-3 live critic: "ages 16 and up" and the street address were on
   neither event direction while coverage read 1.00. */
describe("the event brief", () => {
  const EVENT =
    "Latte art masterclass on Sunday 9 November, 2pm to 5pm, at our Yaba bar, 12 Herbert Macaulay Way. ₦25,000 per person, ages 16 and up, all milk and beans included, 10 seats. Call or WhatsApp 0812 444 7781 to book.";

  it("reads every fact, a weekday and its date as one", () => {
    expect(briefFacts(EVENT).map((f) => `${f.kind}:${f.text}`)).toEqual([
      "day:Sunday 9 November",
      "time:2pm to 5pm",
      "place:Yaba",
      "place:12 Herbert Macaulay Way",
      "price:₦25,000",
      "age:ages 16 and up",
      "inclusion:all milk and beans included",
      "quantity:10 seats",
      "contact:WhatsApp 0812 444 7781",
    ]);
  });

  it("needs the age limit and the street, not just the district", () => {
    const facts = briefFacts(EVENT);
    const age = facts.find((f) => f.kind === "age");
    const street = facts.find((f) => f.text.startsWith("12"));
    expect(age && factStated(age, "Ages 16+")).toBe(true);
    expect(age && factStated(age, "For everyone")).toBe(false);
    expect(street && factStated(street, "Yaba bar")).toBe(false);
    expect(street && factStated(street, "12 Herbert Macaulay Way, Yaba")).toBe(
      true,
    );
  });
});

describe("the product as a fact", () => {
  it("is stated when the copy names it, and drawn when it does not", () => {
    const facts = briefFacts(BAKERY, { product: "strawberry mille-feuille" });
    const product = facts.find((f) => f.kind === "product");
    expect(product?.text).toBe("Strawberry mille-feuille");
    expect(product && factStated(product, "Strawberry Mille-Feuille")).toBe(
      true,
    );
    expect(product && factStated(product, "Yours in sizes 8 to 18")).toBe(
      false,
    );
    const { directions } = coverBriefFacts(
      [copy({ headline: "Your 7am treat is ready" })],
      BAKERY,
      { product: "strawberry mille-feuille" },
    );
    expect(directions[0].footerLines.join(" ")).toContain(
      "Strawberry mille-feuille",
    );
  });
});

describe("a count is never stranded", () => {
  it("joins the last footer line when it fits there", () => {
    const { directions } = coverBriefFacts(
      [
        copy({
          headline: "Pour your best",
          footerLines: ["Call or WhatsApp 0812 444 7781"],
          footerStyle: "bar",
        }),
      ],
      "Masterclass, 10 seats. Call 0812 444 7781.",
    );
    expect(directions[0].footerLines).toEqual([
      "Call or WhatsApp 0812 444 7781 · 10 seats",
    ]);
  });
});

describe("a range with one suffix", () => {
  it("reads 2–5pm as 2pm to 5pm", () => {
    const [time] = briefFacts("Class from 2pm to 5pm.");
    expect(factStated(time, "Sun 9 Nov · 2–5pm")).toBe(true);
    expect(factStated(time, "Sun 9 Nov · 2–5am")).toBe(false);
  });
});

/* Round-4 live run: the address was left off a footer whose first line had
   room for it. */
describe("a fact joins any footer line it fits", () => {
  it("fits the street onto the first line of three", () => {
    const { directions, coverage } = coverBriefFacts(
      [
        copy({
          headline: "Latte Art Masterclass",
          footerLines: [
            "₦25,000 per person · 10 seats",
            "Ages 16+ · milk & beans included",
            "Call/WhatsApp 0812 444 7781 to book",
          ],
          footerStyle: "bar",
        }),
      ],
      "Masterclass at 12 Herbert Macaulay Way. ₦25,000 per person, ages 16 and up, all milk and beans included, 10 seats. Call 0812 444 7781.",
    );
    expect(coverage.leftOff).toEqual([]);
    expect(directions[0].footerLines).toHaveLength(3);
    expect(directions[0].footerLines.join(" ")).toContain(
      "· 12 Herbert Macaulay Way",
    );
  });
});
