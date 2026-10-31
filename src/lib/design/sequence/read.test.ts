import { describe, expect, it } from "vitest";
import { widenedOffering } from "./read";

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
