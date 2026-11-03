import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { withoutSoftClaim, withoutStatement } from "./cuts";
import { beatOf, CAFE_BRIEF, CAFE_FACTS } from "./fixtures";
import { inventedOn } from "./ledger";
import { repairedVersion } from "./replan";

const ledger = factLedger([CAFE_BRIEF, "Kiln Coffee"], 1);

describe("withoutSoftClaim", () => {
  it.each([
    ["Get your fresh bottle now", "fresh", "Get your bottle now"],
    ["Freshly steeped and ready", "freshly", "Steeped and ready"],
    ["Reserve yours today.", "today", "Reserve yours."],
  ])("takes %s out of %s", (headline, word, cut) => {
    expect(withoutSoftClaim(beatOf({ headline }), word)?.headline).toBe(cut);
  });

  it("cuts the word from the button and footer too", () => {
    expect(
      withoutSoftClaim(
        beatOf({
          headline: "Your bottle is waiting",
          cta: "Reserve now",
          footerLines: ["Open now"],
        }),
        "now",
      ),
    ).toEqual({ cta: "Reserve", footerLines: ["Open"] });
  });

  it("leaves a headline that would fall below two words, and any other claim", () => {
    expect(
      withoutSoftClaim(beatOf({ headline: "Fresh today" }), "fresh"),
    ).toBeNull();
    expect(
      withoutSoftClaim(
        beatOf({ headline: "Award-winning brew" }),
        "award-winning",
      ),
    ).toBeNull();
  });
});

describe("regenerate keeps a version whose only fault is a soft word (arc round-4 MEDIUM 5)", () => {
  it("cuts 'fresh' rather than refusing the version, and keeps an action line's 'now'", () => {
    const next = beatOf({
      role: "cta",
      headline: "Get your fresh bottle now",
      cta: "Reserve now",
      footerLines: ["WhatsApp 0803 555 0142"],
    });
    expect(inventedOn(next, ledger)).toEqual(["fresh"]);
    const repaired = repairedVersion(next, "carousel", CAFE_FACTS, ledger);
    expect(inventedOn(repaired, ledger)).toEqual([]);
    expect(repaired.headline).toBe("Get your bottle now");
    expect(repaired.cta).toBe("Reserve now");
  });

  it("takes the soft word alone out of a sentence, keeping the sentence", () => {
    expect(
      withoutStatement(
        beatOf({
          headline: "Cold brew",
          subheadline: "Steeped slow. Made fresh every morning.",
        }),
        "fresh",
      ),
    ).toEqual({ subheadline: "Steeped slow. Made every morning." });
  });
});
