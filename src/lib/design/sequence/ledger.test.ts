import { describe, expect, it } from "vitest";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { beatOf, fact } from "./fixtures";
import { inventedOn, sequenceLedger, withCountWord } from "./ledger";

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
