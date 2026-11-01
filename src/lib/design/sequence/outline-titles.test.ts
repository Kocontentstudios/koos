import { describe, expect, it } from "vitest";
import { EMPTY_POINT } from "./outline-arc";
import {
  outlineTitles,
  pointTitle,
  titleFits,
  titleWithin,
} from "./outline-plan";
import { isCleanTitle } from "./title";

/* The deck probe (N=10) showed titles shifted one point along after
   settleArc moved points: p4 "₦420 from diesel" over "Revenue grew 3x…",
   p9 "Meet ngozi ade" over "Tariffs are 40% below diesel". */
describe("outlineTitles on the deck probe's shift", () => {
  const texts = [
    "Lumenfield powers 4,300 paying customers at 40% below diesel cost.",
    "Power should be cheaper than the generator it replaces",
    "₦150 per kWh",
    "Revenue grew 3x in 2025 to ₦210 million",
    "Ngozi Ade",
    "₦420 for diesel",
    "3x in 2025",
    "14 more grids",
    "Tariffs are 40% below diesel",
    "Contact Ngozi Ade, ngozi@lumenfield.ng. $1.2M seed.",
  ];
  /* The arc's own assignment: each frame titled for the pool point it
     asked for, before settleArc moved points 4..9. */
  const answered = [
    { point: 1, title: "4,300 paying customers" },
    { point: 2, title: "Cheaper than diesel" },
    { point: 3, title: "₦150 per kWh" },
    { point: 5, title: "₦420 from diesel" },
    { point: 7, title: "40% below market" },
    { point: 4, title: "₦210M revenue" },
    { point: 6, title: "3× growth in 2025" },
    { point: 8, title: "14 new grids" },
    { point: 9, title: "Meet ngozi ade" },
    { point: 0, title: "Join the round" },
  ];
  const settled = [0, 1, 2, 3, 4, 5, 6, 7, 8, null].map((point, i) => ({
    point,
    role:
      i === 0
        ? ("hook" as const)
        : i === 9
          ? ("cta" as const)
          : ("body" as const),
  }));

  it("gives every point a title about that point", () => {
    const titles = outlineTitles(answered, settled, texts);
    titles.forEach((title, i) => {
      if (settled[i].role === "cta") return;
      expect(titleFits(title, texts[i]), `${title} over ${texts[i]}`).toBe(
        true,
      );
    });
    expect(titles[3]).not.toBe("₦420 from diesel");
    expect(titles[8]).not.toMatch(/ngozi/i);
  });

  it("remakes a title the arc wrote for another point, even unmoved", () => {
    const own = answered.map((f, i) => ({ ...f, point: i === 9 ? 0 : i + 1 }));
    const titles = outlineTitles(own, settled, texts);
    expect(titles[3]).toBe("Revenue grew 3x");
    expect(titles[8]).toBe("Tariffs 40% below diesel");
  });

  it("keeps the arc's title where the point did not move", () => {
    const titles = outlineTitles(answered, settled, texts);
    expect(titles[2]).toBe("₦150 per kWh");
  });

  it("refuses a title that shares only a year with its point", () => {
    expect(
      titleFits("14 grids by 2027", "Benue market towns, by end of 2027"),
    ).toBe(false);
    expect(
      titleFits(
        "₦150 against ₦420",
        "Customers pay ₦150 per kWh against ₦420 for diesel",
      ),
    ).toBe(true);
  });

  it("makes a title from a point's opening words, whole", () => {
    expect(
      pointTitle("Customers pay ₦150 per kWh against ₦420 for diesel"),
    ).toBe("Customers pay ₦150");
    expect(pointTitle("Tariffs are 40% below diesel")).toBe(
      "Tariffs 40% below diesel",
    );
  });
});

/* Outline titles shipped cut mid-phrase and mid-number: "Fixit Hub
   replaces your cracked", "Fixed-price contracts protect 1", "A coach",
   and the five-word "Strong bodies are built slowly". */
describe("pointTitle keeps a whole phrase of 2 to 4 words", () => {
  it.each([
    [
      "Fixit Hub replaces your cracked iPhone screen the same day.",
      ["fixit", "hub"],
      "Cracked iPhone screen",
    ],
    [
      "Fixed-price contracts protect 1,200 Kaduna farmers and guarantee Harvestline's supply.",
      [],
      "Guarantee Harvestline's supply",
    ],
    [
      "A coach is on the floor at all hours to check your form",
      [],
      "Coach on the floor",
    ],
    [
      "Strong bodies are built slowly and safely",
      [],
      "Strong bodies built slowly",
    ],
    ["Revenue grew 3x in 2025 to ₦210 million", [], "Revenue grew 3x"],
    ["Phone repair shop in Yaba, Lagos", [], "Phone repair shop"],
    ["Only 12 places", [], "Only 12 places"],
  ])("%s -> %s", (point, free, want) => {
    const title = pointTitle(point, new Set(free));
    expect(title).toBe(want);
    const words = title.split(" ");
    expect(words.length).toBeGreaterThanOrEqual(2);
    expect(words.length).toBeLessThanOrEqual(4);
    expect(title).not.toMatch(/\b\d+$|\b(?:the|a|your|and|is)$/i);
  });

  it("titles an empty slide as a prompt, and refuses a model title over 4 words", () => {
    const titles = outlineTitles(
      [
        { point: 1, title: "Strong bodies are built slowly" },
        { point: 2, title: "Anything" },
        { point: 0, title: "Join today" },
      ],
      [
        { point: 0, role: "hook" },
        { point: 1, role: "body" },
        { point: null, role: "cta" },
      ],
      [
        "Strong bodies are built slowly and safely",
        EMPTY_POINT,
        "Join at ironclad.ng/join.",
      ],
    );
    expect(titles.slice(0, 2)).toEqual([
      "Strong bodies built slowly",
      "Add a point",
    ]);
  });

  it("cuts a long title at a whole word, with no ellipsis", () => {
    expect(titleWithin("Every trainer certified nationally", 24)).toBe(
      "Every trainer certified",
    );
    expect(titleWithin("Coach on the floor", 14)).toBe("Coach");
  });
});

describe("pointTitle never cuts a short clause after two words", () => {
  it.each([
    ["Keep riders on the road", "Keep riders on the road"],
    ["Phone repair shop in Yaba, Lagos", "Phone repair shop"],
  ])("%s -> %s", (point, want) => {
    expect(pointTitle(point)).toBe(want);
  });
});

describe("pointTitle on a clause whose short run ends on a verb", () => {
  it("never titles a point with a run cut before its verb's object", () => {
    const title = pointTitle(
      "A full tune-up keeps your bike rolling, and Pedal Doctor picks it up for free.",
    );
    expect(title).not.toBe("Full tune-up keeps");
    expect(isCleanTitle(title)).toBe(true);
  });
});
