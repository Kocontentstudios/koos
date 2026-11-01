import { describe, expect, it } from "vitest";
import { factStated } from "@/lib/jobs/directions/brief-facts";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { beatOf, fact } from "./fixtures";
import {
  inventedOn,
  sequenceLedger,
  withCountWord,
  withTurnaround,
} from "./ledger";

/* The profile's own words are sourced, so a profile-point frame can be
   regenerated; the goal licenses nothing, since it is what the brand only
   hopes is true. */
const sandals = () =>
  directionsContext({
    title: "Leather sandals",
    briefText: "New leather sandals. ₦32,000 a pair. Order on WhatsApp.",
    brandSummary: {
      name: "Ese Footwear",
      overview: "Leather sandal maker in Benin City",
      differentiators:
        "Full-grain cow leather, hand-stitched soles, free resole in year one",
      values: "Shoes made to be repaired, not replaced",
      primaryGoal: "Become the best-selling sandal in Benin City",
    },
  });

describe("sequenceLedger", () => {
  it("accepts a profile point in the profile's own words", () => {
    const ledger = sequenceLedger(sandals(), "");
    expect(
      inventedOn(beatOf({ headline: "Hand-stitched soles" }), ledger),
    ).toEqual([]);
    expect(
      inventedOn(
        beatOf({ headline: "Free resole in year one", subheadline: "" }),
        ledger,
      ),
    ).toEqual([]);
  });

  it("still refuses a method claim neither the brief nor the profile gives", () => {
    const ledger = sequenceLedger(sandals(), "");
    expect(
      inventedOn(beatOf({ headline: "Hand-dyed leather" }), ledger),
    ).toEqual(["Hand-dyed"]);
  });

  it("never lets the goal license a claim", () => {
    const ledger = sequenceLedger(sandals(), "");
    expect(
      inventedOn(
        beatOf({ headline: "Benin City's best-selling sandal" }),
        ledger,
      ),
    ).toContain("best-selling");
  });
});

describe("inventedOn: a year the brief gives", () => {
  it("never reads a sourced year as a count of the word after it", () => {
    const ledger = sequenceLedger(
      directionsContext({
        title: "Seed deck",
        briefText: "Revenue grew 3x in 2025. The round funds 5,000 more kits.",
        brandSummary: { name: "Sunlamp" },
      }),
      "",
    );
    expect(
      inventedOn(
        beatOf({
          headline: "Revenue grew 3x in 2025",
          subheadline: "Strong collections held through the year.",
        }),
        ledger,
      ),
    ).toEqual([]);
  });

  it("still finds a year the brief does not give", () => {
    const ledger = sequenceLedger(
      directionsContext({
        title: "Seed deck",
        briefText: "Revenue grew 3x in 2025.",
        brandSummary: { name: "Sunlamp" },
      }),
      "",
    );
    expect(
      inventedOn(beatOf({ headline: "Founded in 2019 strong" }), ledger),
    ).not.toEqual([]);
  });
});

describe("inventedOn: field by field", () => {
  it("never reads a number ending one field as a count of the next field's word", () => {
    const ledger = sequenceLedger(
      directionsContext({
        title: "Plants",
        briefText: "Snake plants are back. Visit us in Lekki Phase 1.",
        brandSummary: { name: "Fern & Clay" },
      }),
      "",
    );
    expect(
      inventedOn(
        beatOf({
          headline: "We are in Lekki Phase 1",
          subheadline: "Our shop is in Lagos.",
        }),
        ledger,
      ),
    ).toEqual([]);
    expect(
      inventedOn(beatOf({ headline: "We are in Lekki Phase 1 shop" }), ledger),
    ).toEqual(["1 shop"]);
  });
});

describe("withCountWord", () => {
  const brief = "Teeth whitening. One 60-minute session. Only 12 places.";

  it("gives back the count word a reader dropped from before a figure", () => {
    expect(withCountWord(fact("quantity", "60-minute session"), brief)).toEqual(
      fact("quantity", "One 60-minute session"),
    );
  });

  it("leaves a fact with no count word before it, or none of its own figure", () => {
    expect(withCountWord(fact("quantity", "12 places"), brief).text).toBe(
      "12 places",
    );
    expect(
      withCountWord(fact("product", "Teeth whitening"), "One Teeth whitening")
        .text,
    ).toBe("Teeth whitening");
  });
});

describe("withTurnaround", () => {
  const brief =
    "Shoes resoled and ready in 2 days. Bags back within one week. Open 6 days a week.";

  it.each([
    ["2 days", "ready in 2 days"],
    ["one week", "back within one week"],
  ])("gives %j back the promise the brief puts before it", (text, whole) => {
    const widened = withTurnaround(fact("quantity", text), brief);
    expect(widened.text).toBe(whole);
    expect(factStated(widened, "Booked in 2 days")).toBe(false);
    expect(factStated(widened, `Resoled and ${whole}`)).toBe(true);
  });

  it("leaves a duration with no promise before it, and a fact that is not a duration", () => {
    expect(withTurnaround(fact("quantity", "6 days"), brief).text).toBe(
      "6 days",
    );
    expect(withTurnaround(fact("place", "Shoes"), brief).text).toBe("Shoes");
  });
});

/* A regenerate was refused for "Book now": an action line's "now" or
   "today" sets no date, and "fresh" claims nothing on a bike tune-up. */
describe("inventedOn: words an action line uses", () => {
  const bike = () =>
    directionsContext({
      title: "Tune-ups",
      briefText:
        "Pedal Doctor tune-ups are ₦12,000. Book on WhatsApp 0812 300 4455.",
      brandSummary: {
        name: "Pedal Doctor",
        overview: "Bicycle repair workshop in Wuse 2, Abuja",
        offer: "Tune-ups, puncture repairs and brake servicing",
      },
    });
  const bakery = () =>
    directionsContext({
      title: "Sourdough",
      briefText: "Sourdough loaves ₦4,500. Order on WhatsApp.",
      brandSummary: { name: "Crumb", overview: "Bakery in Yaba" },
    });

  it.each([
    [{ headline: "Book your tune-up now" }],
    [{ headline: "Get a fresh tune-up today", cta: "Book now" }],
    [{ headline: "Your bike, running like new", cta: "Book now" }],
    [{ headline: "Ride fresh", cta: "Book today" }],
  ])("accepts %o", (copy) => {
    expect(inventedOn(beatOf(copy), sequenceLedger(bike(), ""))).toEqual([]);
  });

  it("still refuses a promise of when", () => {
    const ledger = sequenceLedger(bike(), "");
    expect(
      inventedOn(
        beatOf({ headline: "Tune-ups half price today only" }),
        ledger,
      ),
    ).toContain("today");
    expect(
      inventedOn(beatOf({ headline: "Tune-ups are cheaper today" }), ledger),
    ).toContain("today");
  });

  it("still refuses fresh about what can go stale", () => {
    expect(
      inventedOn(
        beatOf({ headline: "Fresh sourdough loaves" }),
        sequenceLedger(bakery(), ""),
      ).map((w) => w.toLowerCase()),
    ).toContain("fresh");
  });
});
