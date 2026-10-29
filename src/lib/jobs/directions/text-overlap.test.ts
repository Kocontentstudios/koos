import { describe, expect, it } from "vitest";
import {
  contentStems,
  directionOverlap,
  distinctness,
  isNearDuplicate,
  isNearDuplicateHeadline,
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
        headline: "Your weekend table is waiting",
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

describe("filler", () => {
  it("treats praise any design could claim as filler", () => {
    expect(soundsLikeFiller("Eye-catching and modern, it stands out")).toBe(
      true,
    );
    expect(soundsLikeFiller("Leads with the almond croissant itself")).toBe(
      false,
    );
  });
});

/* Round-14 code critic, break 3 (J31, J32): the claim check's rewrite of a
   headline was refused only when it was the sibling's exactly. */
describe("isNearDuplicateHeadline", () => {
  const sibling = "Almond croissants for the commute";
  it.each([
    "Almond croissants for the commute.",
    "ALMOND CROISSANTS FOR THE COMMUTE!",
    "Almond croissants for your commute",
    "Almond croissants, for the commute",
  ])("%j reads as the sibling's", (rewrite) => {
    expect(isNearDuplicateHeadline(sibling, rewrite)).toBe(true);
  });

  it("holds headlines with no content words to their plain words", () => {
    expect(
      isNearDuplicateHeadline("It's all for you", "It's all for you!"),
    ).toBe(true);
    expect(
      isNearDuplicateHeadline("It's all for you", "All of it, yours"),
    ).toBe(false);
  });

  it("leaves a different idea alone, and ignores the brand's name", () => {
    expect(isNearDuplicateHeadline(sibling, "Your table is waiting")).toBe(
      false,
    );
    const brand = new Set(["crumb", "co"]);
    expect(
      isNearDuplicateHeadline(
        "Crumb & Co mornings",
        "Crumb & Co weekends",
        brand,
      ),
    ).toBe(false);
  });
});

/* Round-15 code critic, finding 5: two headlines of stop words shared
   nothing ("All for you" beside "It's all for you" shipped), and one
   shared content word refused two ideas ("Slow mornings", "Slow down"). */
describe("isNearDuplicateHeadline on short headlines", () => {
  it.each([
    ["It's all for you", "All for you"],
    ["Just for you", "Only for you"],
    ["Hello, weekend", "Weekend"],
    ["Latte art", "Latte art masterclass"],
  ])("%j and %j read as one", (a, b) => {
    expect(isNearDuplicateHeadline(a, b)).toBe(true);
  });

  it.each([
    ["Slow mornings", "Slow down"],
    ["Bake with us", "Bake it yourself"],
    ["Fresh bread", "Fresh coffee"],
    ["Your seat at the wheel", "Your evening at the wheel"],
  ])("%j and %j stay apart", (a, b) => {
    expect(isNearDuplicateHeadline(a, b)).toBe(false);
  });

  /* Round-16 code critic, finding 2: two headlines whose only content
     word is the same scored their whole wording, 0.25, and read apart. */
  it.each([
    ["We're hiring", "Now hiring"],
    ["Hiring now", "We're hiring!"],
    ["Our croissants", "Croissants for you"],
    ["Open again", "We're open"],
    ["Coffee, your way", "Your coffee"],
  ])("%j and %j share their only content word and read as one", (a, b) => {
    expect(isNearDuplicateHeadline(a, b)).toBe(true);
  });

  it.each([
    ["Made for you", "Baked for you"],
    ["Bread for you", "Cake for you"],
    ["Make it merry", "Merry and bright"],
  ])("%j and %j differ in their content word and stay apart", (a, b) => {
    expect(isNearDuplicateHeadline(a, b)).toBe(false);
  });

  it("keeps a headline that only adds a word to the other a near-duplicate", () => {
    expect(isNearDuplicateHeadline("All for you", "All for you, always")).toBe(
      true,
    );
  });

  it("scores the pair check's headline the same way", () => {
    const pair = (a: string, b: string) =>
      directionOverlap(
        { title: "", headline: a, backgroundPrompt: "" },
        { title: "", headline: b, backgroundPrompt: "" },
        { compareScenes: false },
      ).headline;
    expect(pair("It's all for you", "All for you")).toBeGreaterThanOrEqual(0.5);
    expect(pair("Slow mornings", "Slow down")).toBeLessThan(0.5);
    expect(pair("We're hiring", "Now hiring")).toBeGreaterThanOrEqual(0.5);
    expect(pair("Made for you", "Baked for you")).toBeLessThan(0.5);
  });
});
