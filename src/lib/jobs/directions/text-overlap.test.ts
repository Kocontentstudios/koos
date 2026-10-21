import { describe, expect, it } from "vitest";
import {
  contentStems,
  directionOverlap,
  distinctness,
  isGroundedReason,
  isNearDuplicate,
  jaccard,
  soundsLikeFiller,
  stem,
  usesJargon,
} from "./text-overlap";

const base = {
  title: "Morning bake story",
  headline: "Fresh croissants every morning",
  subheadline: "Baked before sunrise in Lekki",
  cta: "Order for pickup",
  backgroundPrompt: "a bakery counter at dawn with croissants",
};

describe("stems", () => {
  it("folds plurals and verb endings so the same word meets itself", () => {
    expect(stem("croissants")).toBe(stem("croissant"));
    expect(stem("pastries")).toBe(stem("pastry"));
    expect(stem("baking")).toBe("bak");
    expect(stem("glass")).toBe("glass");
  });

  it("drops stopwords and short tokens but keeps numbers", () => {
    expect([...contentStems("Get 20% off all of our cakes")]).toEqual([
      "20",
      "cake",
    ]);
  });

  it("scores two empty sets as sharing nothing", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("near-duplicate detection", () => {
  it("catches one idea reworded", () => {
    const overlap = directionOverlap(
      base,
      {
        ...base,
        title: "Morning bake",
        headline: "Fresh croissants, every single morning",
      },
      { compareScenes: false },
    );
    expect(overlap.headline).toBeGreaterThanOrEqual(0.5);
    expect(isNearDuplicate(overlap)).toBe(true);
  });

  it("passes two honest concepts for the same bakery", () => {
    const overlap = directionOverlap(
      base,
      {
        title: "Table for two",
        headline: "Your Saturday table is waiting",
        subheadline: "Slow brunch, good coffee, no rush",
        cta: "Book a table",
        backgroundPrompt: "a sunlit cafe table set for two",
      },
      { compareScenes: true },
    );
    expect(isNearDuplicate(overlap)).toBe(false);
    expect(distinctness(overlap)).toBeGreaterThan(0.7);
  });

  it("does not count the brand name both directions must carry", () => {
    const a = { ...base, headline: "Crumb croissants at dawn" };
    const b = { ...base, headline: "Crumb gift boxes", title: "Gift edit" };
    const withName = directionOverlap(a, b, { compareScenes: false });
    const ignoring = directionOverlap(a, b, {
      compareScenes: false,
      ignore: contentStems("Crumb"),
    });
    expect(ignoring.headline).toBeLessThan(withName.headline);
  });

  it("compares painted scenes only when each direction gets its own", () => {
    const same = directionOverlap(
      base,
      { ...base, title: "Other", headline: "Different words entirely" },
      { compareScenes: true },
    );
    expect(same.scene).toBe(1);
    expect(isNearDuplicate(same)).toBe(true);
    expect(
      directionOverlap(base, base, { compareScenes: false }).scene,
    ).toBeNull();
  });
});

describe("facts the brief requires both directions to carry", () => {
  const a = {
    title: "Product reveal",
    headline: "Meet the strawberry mille-feuille",
    subheadline: "₦4,500 a slice, from Monday. Order ahead for 7am pickup",
    cta: "Order ahead",
    backgroundPrompt: "",
  };
  const b = {
    title: "Morning treat priced right",
    headline: "Pure morning bliss",
    subheadline: "Order ahead: ₦4,500 a slice from Monday, pickup at 7am",
    cta: "Order ahead",
    backgroundPrompt: "",
  };
  const briefWords = contentStems(
    "Launch our strawberry mille-feuille, ₦4,500 a slice, from Monday. Order ahead for 7am pickup.",
  );

  it("do not make two concepts look like one", () => {
    const raw = directionOverlap(a, b, { compareScenes: false });
    const beyond = directionOverlap(a, b, { compareScenes: false, briefWords });
    expect(isNearDuplicate(raw)).toBe(true);
    expect(isNearDuplicate(beyond)).toBe(false);
  });

  it("still catch two headlines built from the same brief words", () => {
    const overlap = directionOverlap(
      { ...a, headline: "Strawberry mille-feuille from Monday" },
      { ...b, headline: "Strawberry mille-feuille, Monday" },
      { compareScenes: false, briefWords },
    );
    expect(isNearDuplicate(overlap)).toBe(true);
  });
});

describe("jargon", () => {
  it.each([
    "Split-left keeps the portrait beside the role",
    "Golden #FDE68A on emerald reads at a glance",
    "Inverts the palette from Direction 1",
    "Fulfils the concept brief exactly",
  ])("flags %j", (reason) => {
    expect(usesJargon(reason)).toBe(true);
  });

  it("leaves the client's language alone", () => {
    expect(usesJargon("The price sits right beside the order button")).toBe(
      false,
    );
  });
});

describe("reasons", () => {
  const facts = contentStems(
    "Launch our almond croissant for Lagos commuters before work",
  );

  it("treats praise with no anchor as filler", () => {
    expect(soundsLikeFiller("Eye-catching and modern, it stands out")).toBe(
      true,
    );
    expect(isGroundedReason("Eye-catching and modern", facts)).toBe(false);
  });

  it("grounds a reason that names something from the brief", () => {
    expect(
      isGroundedReason("Leads with the almond croissant itself", facts),
    ).toBe(true);
    expect(
      isGroundedReason("Speaks to commuters grabbing breakfast", facts),
    ).toBe(true);
  });
});
