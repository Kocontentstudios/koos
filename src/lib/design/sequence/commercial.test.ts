import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { commercialClaims } from "./commercial";
import { beatOf } from "./fixtures";
import { inventedOn } from "./plan";

/* Briefs that are not eval fixtures: a borehole driller and a gym. */
const DRILLER =
  "Borehole drilling for homes in Ibadan. Site visit ₦15,000. Call 0802 000 1111.";
const GYM =
  "Monthly membership at our Ikeja gym, ₦20,000 a month. No joining fee. Cancel anytime.";

describe("commercialClaims", () => {
  it.each([
    ["Pay when you collect.", "pay when you collect"],
    ["No hidden charges.", "No hidden charges"],
    ["We size the job at no obligation.", "at no obligation"],
    ["A local team handles setup and ongoing service.", "local team"],
    ["Fixed, one-time cost per borehole.", "one-time cost"],
    ["Sign up your whole office weekly", "Sign up your whole office"],
    ["Proven at scale across Ibadan.", "Proven"],
    ["Fully insured crews.", "Fully insured"],
    ["Free site survey this week", "Free site survey"],
  ])("refuses %j when no source gives it", (copy, term) => {
    const found = commercialClaims(copy, DRILLER.toLowerCase());
    expect(found.join(" | ").toLowerCase()).toContain(term.toLowerCase());
  });

  it("accepts what the brief itself offers", () => {
    expect(
      commercialClaims(
        "Join for ₦20,000 a month. Cancel anytime.",
        GYM.toLowerCase(),
      ),
    ).toEqual([]);
    expect(
      commercialClaims("A monthly membership that fits", GYM.toLowerCase()),
    ).toEqual([]);
  });

  it("leaves plain copy alone", () => {
    expect(
      commercialClaims(
        "Clean water at your gate. Call 0802 000 1111 to book a site visit.",
        DRILLER.toLowerCase(),
      ),
    ).toEqual([]);
  });
});

describe("inventedOn", () => {
  it("reports a commercial term beside the ledger's own findings", () => {
    const ledger = factLedger([DRILLER], 1);
    const beat = beatOf({
      headline: "Water at your gate",
      subheadline: "Pay when you collect. No hidden charges.",
    });
    expect(inventedOn(beat, ledger)).toEqual(
      expect.arrayContaining(["Pay when you collect", "No hidden charges"]),
    );
    expect(
      inventedOn(beatOf({ headline: "Site visit ₦15,000" }), ledger),
    ).toEqual([]);
  });
});
