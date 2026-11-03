import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { ArcPoint } from "./arc";
import type { ApprovedOutline } from "./contract";
import { setFaults } from "./faults";
import { beatOf, CAFE_RULES, cafePlan, fact, withFrame } from "./fixtures";
import { namesFree } from "./hook";
import { factsIn } from "./outline-arc";
import {
  correctsFact,
  heldFaults,
  heldPoints,
  pricesOnTheirPoints,
  releasedFacts,
  releasedFaults,
  releasedSentences,
  unsayable,
  withoutFactText,
} from "./removed";

/* Rubric Addendum C, C3 and C4: what an edited outline takes out never
   reaches a frame, prices included, and what it keeps stays required. */

const point = (
  id: string,
  role: "hook" | "body" | "cta",
  text: string,
  source: "brief" | "profile" | "user" = "brief",
) => ({
  id,
  role,
  title: text.split(" ").slice(0, 3).join(" "),
  point: text,
  source,
});

describe("a fact the owner's rewrite took off the outline (C4)", () => {
  /* Farmlink, round 3: the owner replaced "Farmers pay ₦500 per crate
     per day." with their own point, which shares "farmers" and "crates"
     with it; the price was then drawn back onto the action's footer. */
  const facts = [
    fact("product", "solar cold rooms"),
    fact("place", "Kano"),
    fact("price", "₦500 per crate per day"),
    fact("quantity", "14 cold rooms"),
    fact("price", "$750,000"),
    fact("contact", "founders@farmlink.ng"),
  ];
  const free = namesFree("Farmlink", "solar cold rooms");
  const pool: ArcPoint[] = [
    "Farmlink rents solar cold rooms to tomato farmers in Kano by the crate",
    "We run 14 cold rooms today",
    "Farmers keep more of what they grow",
  ].map((text) => ({ source: "brief", text, facts: factsIn(text, facts) }));
  const outline: ApprovedOutline = {
    kind: "presentation",
    points: [
      point(
        "p1",
        "hook",
        "Farmlink rents solar cold rooms to tomato farmers in Kano by the crate.",
      ),
      point("p2", "body", "We run 14 cold rooms today"),
      point(
        "p3",
        "body",
        "1,140 farmers have rented crates from us since March 2024",
        "user",
      ),
      point(
        "p4",
        "cta",
        "Contact founders@farmlink.ng. We are raising $750,000.",
      ),
    ],
  };

  it("is released though an owner's point shares its words", () => {
    const released = releasedFacts(outline, pool, facts, free).map(
      (n) => facts[n].text,
    );
    expect(released).toContain("₦500 per crate per day");
    expect(released).not.toContain("14 cold rooms");
    expect(released).not.toContain("$750,000");
  });

  it("takes the brief's sentence that gave it out with it", () => {
    expect(
      releasedSentences(
        "Farmlink rents solar cold rooms. Farmers pay ₦500 per crate per day. We are raising $750,000.",
        facts,
        ["₦500 per crate per day"],
        outline,
        free,
      ),
    ).toEqual(["Farmers pay ₦500 per crate per day."]);
  });

  it("is never stated again, footer included", () => {
    const frames = [
      beatOf({ role: "hook", headline: "Solar cold rooms for Kano" }),
      beatOf({ headline: "We run 14 cold rooms today" }),
      beatOf({ headline: "1,140 farmers since March 2024" }),
      beatOf({
        role: "cta",
        headline: "We are raising $750,000",
        footerLines: ["₦500 per crate per day", "founders@farmlink.ng"],
      }),
    ];
    const faults = releasedFaults(
      frames,
      facts,
      ["₦500 per crate per day"],
      ["", "", outline.points[2].point, ""],
      outline.points.map((p) => p.point),
    );
    expect(faults.map((f) => f.frame)).toEqual([3]);
  });
});

describe("a fact the approved outline still states in other words", () => {
  it("keeps a price whose amount an approved point gives", () => {
    const facts = [fact("price", "₦450,000 a month for 5 desks")];
    const outline: ApprovedOutline = {
      kind: "presentation",
      points: [
        point(
          "p1",
          "hook",
          "A five-desk team plan at Udi Hills Cowork costs ₦450,000 a month.",
        ),
        point("p2", "body", "Internet runs at 200 Mbps", "user"),
        point("p3", "cta", "Book a tour: hello@udihillscowork.ng."),
      ],
    };
    expect(releasedFacts(outline, [], facts)).toEqual([]);
  });

  it("keeps a date the outline says in its own words, unless its point left", () => {
    const facts = [fact("date", "From 10 January")];
    const outline: ApprovedOutline = {
      kind: "carousel",
      points: [
        point("p1", "hook", "WAEC maths crash course starts 10 January."),
        point("p2", "body", "Classes are capped at 12 students", "user"),
        point("p3", "cta", "Register on WhatsApp."),
      ],
    };
    expect(releasedFacts(outline, [], facts)).toEqual([]);
  });

  it("moves a deck's price to the approved point that gives it", () => {
    const facts = [
      fact("place", "Enugu"),
      fact("price", "₦450,000 a month for 5 desks"),
    ];
    const outline: ApprovedOutline = {
      kind: "presentation",
      points: [
        point("p1", "hook", "Five desks for ₦450,000 a month."),
        point("p2", "body", "Internet runs at 200 Mbps", "user"),
        point("p3", "cta", "Book a tour in Enugu."),
      ],
    };
    expect(pricesOnTheirPoints([[], [], [0, 1]], outline, facts)).toEqual([
      [1],
      [],
      [0],
    ]);
    expect(
      pricesOnTheirPoints(
        [[], [], [0, 1]],
        { ...outline, kind: "carousel" },
        facts,
      ),
    ).toEqual([[], [], [0, 1]]);
  });
});

describe("an owner's unit price beside the brief's total (C3)", () => {
  it("does not correct a price for a counted lot", () => {
    const raise = fact("price", "₦6,000,000 for 30 laptops");
    expect(
      correctsFact(
        "Each laptop costs ₦200,000 and will last at least five years",
        raise,
      ),
    ).toBe(false);
    expect(correctsFact("We need ₦5,000,000 for 30 laptops", raise)).toBe(true);
  });

  it("keeps the raise required, so the deck still asks for it", () => {
    const facts = [
      fact("quantity", "120 students"),
      fact("price", "₦6,000,000 for 30 laptops"),
    ];
    const outline: ApprovedOutline = {
      kind: "presentation",
      points: [
        point("p1", "hook", "120 students learn to code each term."),
        point(
          "p2",
          "body",
          "Each laptop costs ₦200,000 and will last at least five years",
          "user",
        ),
        point(
          "p3",
          "cta",
          "Contact hello@ikorodu-codeclub.org. We need ₦6,000,000 for 30 laptops.",
        ),
      ],
    };
    expect(releasedFacts(outline, [], facts)).toEqual([]);
  });
});

describe("a where the owner took out with a point (C4)", () => {
  const wuse = fact("place", "Wuse 2");
  const plot = fact("place", "Plot 12 Aminu Kano Crescent");

  it("is unsayable on the action whose point already gives a where", () => {
    expect(
      unsayable(
        [wuse, plot],
        ["Wuse 2"],
        [],
        "Call 0805 111 2233. Drop off at Plot 12 Aminu Kano Crescent.",
      ),
    ).toEqual([wuse]);
    expect(
      unsayable([wuse, plot], ["Wuse 2"], [], "Call 0805 111 2233."),
    ).toEqual([]);
  });

  it("is trimmed out of the address line, which keeps the rest", () => {
    expect(withoutFactText("Plot 12 Aminu Kano Crescent, Wuse 2", wuse)).toBe(
      "Plot 12 Aminu Kano Crescent",
    );
    expect(withoutFactText("Wuse 2", wuse)).toBe("");
  });
});

describe("a planned point an edited outline keeps on one frame only", () => {
  const facts = [fact("price", "Gold partner package ₦15,000,000")];
  const outline: ApprovedOutline = {
    kind: "presentation",
    points: [
      point(
        "p1",
        "hook",
        "Name the main stage of Lagos Design Week 2026 as Gold Partner.",
      ),
      point(
        "p2",
        "body",
        "Last year's festival drew 28,000 visitors over five days",
        "user",
      ),
      point(
        "p3",
        "cta",
        "Email partners@lagosdesignweek.ng. Gold partner package ₦15,000,000.",
      ),
    ],
  };
  const held = heldPoints(
    outline,
    [],
    facts,
    namesFree("Lagos Design Week", null),
    "Gold partner package ₦15,000,000 with naming on the main stage. Email partners@lagosdesignweek.ng.",
  );

  it("belongs to the frames whose point makes it", () => {
    expect(held).toContainEqual({
      text: "Gold partner package ₦15,000,000 with naming on the main stage",
      frames: [0, 2],
    });
  });

  it("is a fault on any other frame, and on none of its own", () => {
    const frames = [
      beatOf({ role: "hook", headline: "Your name on the main stage" }),
      beatOf({
        headline: "28,000 visitors in five days",
        footerLines: ["Gold partner package ₦15,000,000"],
      }),
      beatOf({ role: "cta", headline: "Gold partner package ₦15,000,000" }),
    ];
    const faults = heldFaults(
      frames,
      held,
      outline.points.map((p) => p.point),
      new Set(),
    );
    expect(faults.map((f) => f.frame)).toEqual([1]);
  });
});

describe("the brand's goal read to the reader (C6)", () => {
  const rules = {
    ...CAFE_RULES,
    names: [],
    ledger: factLedger(["Launch our cold brew at our Yaba bar."], 1),
    goal: "Fill weekday appointments",
  };
  const goalFaults = (plan: ReturnType<typeof cafePlan>) =>
    setFaults(plan, rules).filter((f) => /brand's own goal/.test(f.detail));

  it("is a blocking fault", () => {
    const plan = withFrame(cafePlan(), 1, {
      subheadline: "Fill weekday appointments.",
    });
    const found = goalFaults(plan);
    expect(found.map((f) => [f.frame, f.weight])).toEqual([[1, 3]]);
  });

  it("is found when the goal names the offering itself", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "More cold brew bookings.",
    });
    const found = setFaults(plan, {
      ...rules,
      goal: "More cold brew bookings",
    }).filter((f) => /brand's own goal/.test(f.detail));
    expect(found.map((f) => f.frame)).toEqual([0]);
  });

  it("is not the address a goal happens to name", () => {
    const plan = withFrame(cafePlan(), 4, {
      footerLines: ["our Yaba bar", "WhatsApp 0803 555 0142"],
    });
    const found = setFaults(plan, {
      ...rules,
      goal: "More repeat customers at our Yaba bar",
    }).filter((f) => /brand's own goal/.test(f.detail));
    expect(found).toEqual([]);
  });

  it("is not a line that only shares its words", () => {
    const plan = withFrame(cafePlan(), 1, {
      subheadline: "Weekday appointments get a free scalp massage.",
    });
    expect(goalFaults(plan)).toEqual([]);
  });
});
