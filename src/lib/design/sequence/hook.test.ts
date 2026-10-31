import { describe, expect, it } from "vitest";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { beatOf } from "./fixtures";
import { hookFaults, hookPreviews, namesFree, withoutArrival } from "./hook";

describe("withoutArrival", () => {
  const free = namesFree("Ata Kitchen", "scotch bonnet sauce");

  it("takes the arrival out of a hook's point and keeps its reason", () => {
    expect(
      withoutArrival(
        "Ata Kitchen's scotch bonnet sauce is back, made in small batches without preservatives.",
        free,
      ),
    ).toBe(
      "Ata Kitchen's scotch bonnet sauce, made in small batches without preservatives.",
    );
    expect(
      withoutArrival(
        "Hand-woven Bida baskets have arrived, each one signed by its weaver",
        free,
      ),
    ).toBe("Hand-woven Bida baskets, each one signed by its weaver");
  });

  it("keeps a point that would be left with only its name", () => {
    expect(withoutArrival("Our scotch bonnet sauce is back.", free)).toBe(
      "Our scotch bonnet sauce is back.",
    );
    expect(withoutArrival("Ready in 3 days, every time", free)).toBe(
      "Ready in 3 days, every time",
    );
  });
});

describe("hookPreviews on the action frame", () => {
  const frames = [
    beatOf({
      role: "hook",
      headline: "Four students share one laptop",
      subheadline: "30 laptops for Ikorodu Code Club's free coding lessons.",
    }),
    beatOf({ headline: "60 students turned away last term" }),
    beatOf({
      role: "cta",
      headline: "Fund the 30 laptops",
      subheadline: "₦6,000,000 buys 30 laptops for the club.",
    }),
  ];

  it("lets the last frame give again the ask the reader acts on", () => {
    const ask = new Set(contentStems("₦6,000,000 for 30 laptops"));
    expect(hookPreviews(frames, null, "Ikorodu Code Club", ask)).toEqual([]);
  });

  it("still finds the last frame making the hook's point", () => {
    expect(hookPreviews(frames, null, "Ikorodu Code Club")).toHaveLength(1);
  });
});

describe("previewedFrames and the offering's own words", () => {
  it("never reads the hook naming a long offering as spending a later frame's point", () => {
    const frames = [
      beatOf({
        role: "hook",
        headline: "Made in Ibadan, sold out in 9 days",
        subheadline:
          "Ata Kitchen's scotch bonnet pepper sauce, made in small batches.",
      }),
      beatOf({ headline: "About 30 scotch bonnets in every jar" }),
      beatOf({ role: "cta", headline: "Order on WhatsApp" }),
    ];
    expect(
      hookPreviews(frames, "scotch bonnet pepper sauce", "Ata Kitchen"),
    ).toEqual([]);
    const spending = [
      {
        ...frames[0],
        subheadline: "About 30 scotch bonnets go into every jar.",
      },
      ...frames.slice(1),
    ];
    expect(
      hookPreviews(spending, "scotch bonnet pepper sauce", "Ata Kitchen"),
    ).toHaveLength(1);
  });
});

describe("hookFaults: devices and labels", () => {
  const hook = beatOf({ role: "hook" });
  const place = [
    { kind: "place" as const, text: "Smile Studio, Ikeja GRA", needs: [] },
  ];

  it("finds a before-and-after that holds no figure, and passes one that does", () => {
    const faults = (headline: string) =>
      hookFaults({ ...hook, headline, subheadline: "" }, "pepper sauce");
    expect(faults("Before: no sauce. After: Oyo fire.").join(" ")).toMatch(
      /before-and-after with no figure/,
    );
    expect(faults("Before: 3 days. After: 3 weeks.").join(" ")).not.toMatch(
      /before-and-after/,
    );
  });

  it("finds a hook subheadline that only names the offering and where it is", () => {
    const faults = (subheadline: string) =>
      hookFaults(
        {
          ...hook,
          headline: "Teeth whitening in one 60-minute session",
          subheadline,
        },
        "Teeth whitening",
        [],
        "Smile Studio",
        place,
      ).join(" ");
    expect(faults("Teeth whitening at Smile Studio, Ikeja GRA.")).toMatch(
      /only names the offering and where/,
    );
    expect(faults("Most patients leave 6 to 8 shades lighter.")).not.toMatch(
      /only names/,
    );
  });
});
