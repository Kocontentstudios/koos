import { describe, expect, it } from "vitest";
import { settledOffering, widenedOffering } from "./read";

/* O1 round-1 critic, MEDIUM 8: the hook dropped "WAEC" because the read
   took "maths crash course" as the offering. */
describe("widenedOffering", () => {
  it.each([
    [
      "maths crash course",
      "WAEC maths crash course for SS3 students. Six Saturdays.",
      "WAEC maths crash course",
    ],
    ["cold brew", "Launch our cold brew at our Yaba bar.", "cold brew"],
    ["Cold Brew", "Launch Kiln Cold Brew at our Yaba bar.", "Kiln Cold Brew"],
    ["design week", "Sponsor Lagos Design Week 2026.", "Lagos Design Week"],
    ["sauce", "Our sauce is back.", "sauce"],
    [null, "Anything", null],
  ])("%s in %s is %s", (offering, brief, want) => {
    expect(widenedOffering(offering, brief)).toBe(want);
  });
});

/* The thin phone-repair brief read "replaces it" as the offering and
   widened it to "Hub replaces it", which the outline then showed. */
describe("settledOffering", () => {
  const BRIEF =
    "Cracked iPhone screen? Fixit Hub replaces it the same day for ₦45,000. Call 0809 555 0101.";

  it("refuses a phrase that ends on a pronoun", () => {
    expect(settledOffering("replaces it", BRIEF, "Fixit Hub")).toBeNull();
    expect(settledOffering("Hub replaces it", BRIEF, "Fixit Hub")).toBeNull();
  });

  it("never widens over half of the brand's name", () => {
    expect(
      widenedOffering(
        "screen repair",
        "Fixit Hub screen repair, same day.",
        "Fixit Hub",
      ),
    ).toBe("screen repair");
    expect(
      settledOffering(
        "maths crash course",
        "Join our WAEC maths crash course.",
        "Bright Path",
      ),
    ).toBe("WAEC maths crash course");
  });

  it("refuses a phrase that names the piece", () => {
    expect(
      settledOffering("investor deck", "Our investor deck.", "Farmlink"),
    ).toBeNull();
  });
});
