import { describe, expect, it } from "vitest";
import { withoutStatement } from "./cuts";
import { beatOf } from "./fixtures";

describe("withoutStatement", () => {
  it("drops the sentence that says it and keeps the rest", () => {
    const beat = beatOf({
      subheadline:
        "No appointment needed — come in during opening hours. Pick any pot.",
    });
    expect(withoutStatement(beat, "No appointment needed")).toEqual({
      subheadline: "Come in during opening hours. Pick any pot.",
    });
  });

  it("drops a footer line that says it", () => {
    const beat = beatOf({ footerLines: ["Free parking", "WhatsApp 0800"] });
    expect(withoutStatement(beat, "Free parking")).toEqual({
      footerLines: ["WhatsApp 0800"],
    });
  });

  it("cuts its words from a headline where two words or more are left", () => {
    const beat = beatOf({ headline: "Still writing invoices by hand?" });
    expect(withoutStatement(beat, "by hand")).toEqual({
      headline: "Still writing invoices?",
    });
  });

  it("keeps a subheadline that says nothing else, to be reported", () => {
    const beat = beatOf({
      subheadline: "Our pots are shaped individually.",
    });
    expect(
      withoutStatement(beat, "Our pots are shaped individually"),
    ).toBeNull();
  });

  it("never cuts words from inside a sentence", () => {
    const beat = beatOf({
      headline: "Whiter teeth that fit your lunch break, in one visit",
      subheadline:
        "Smile Studio offers professional teeth whitening that fits into your lunch break.",
    });
    expect(withoutStatement(beat, "fits into your lunch break")).toBeNull();
    expect(
      withoutStatement({ ...beat, subheadline: "" }, "fit your lunch break"),
    ).toBeNull();
  });

  it("changes nothing when the frame does not say it", () => {
    expect(withoutStatement(beatOf(), "No appointment needed")).toBeNull();
  });
});
