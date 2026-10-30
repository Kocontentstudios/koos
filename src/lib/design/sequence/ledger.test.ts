import { describe, expect, it } from "vitest";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { beatOf } from "./fixtures";
import { inventedOn, sequenceLedger } from "./ledger";

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
