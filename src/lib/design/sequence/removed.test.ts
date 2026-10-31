import { describe, expect, it } from "vitest";
import { type BriefFact, needsFor } from "@/lib/jobs/directions/brief-facts";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { ArcPoint } from "./arc";
import type { ApprovedOutline } from "./contract";
import { setFaults } from "./faults";
import {
  CAFE_BRIEF,
  CAFE_FACTS,
  CAFE_RULES,
  cafePlan,
  fact,
  withFrame,
} from "./fixtures";
import { type GateRules, shipGate } from "./gate";
import { namesFree } from "./hook";
import {
  correctsFact,
  profileWithout,
  releasedFacts,
  removedFaults,
  removedFromBrief,
  removedPoints,
} from "./removed";

const FREE = namesFree("Kiln Coffee", "cold brew");
const DELETED = "Every bottle is hand-labelled by our baristas";

const pool: ArcPoint[] = [
  {
    source: "brief",
    text: "Steeped for 18 hours, then served over ice",
    facts: [],
  },
  { source: "profile", text: "Beans from the Mambilla Plateau", facts: [] },
  { source: "profile", text: DELETED, facts: [] },
];

const outline: ApprovedOutline = {
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "Steeped",
      point: "Steeped for 18 hours, then served over ice",
      source: "brief",
    },
    {
      id: "p2",
      role: "body",
      title: "Mambilla",
      point: "Beans from the Mambilla Plateau",
      source: "profile",
    },
    {
      id: "p4",
      role: "cta",
      title: "Reserve",
      point: "WhatsApp 0803 555 0142 to reserve.",
      source: "brief",
    },
  ],
};

/* O1 round-1 critic, HIGH 5: the deleted "Every teacher is a working
   software engineer" shipped on F4 as "taught by a working software
   engineer". */
describe("removed points", () => {
  it("names every pool point no approved point makes", () => {
    expect(
      removedPoints(outline, pool, CAFE_FACTS, FREE).map((p) => p.text),
    ).toEqual([DELETED]);
  });

  it("takes a removed profile clause out of the profile the model reads, and does not name it", () => {
    const brand = profileWithout(
      {
        name: "Kiln Coffee",
        differentiators: `Beans from the Mambilla Plateau; ${DELETED.toLowerCase()}`,
      } as never,
      [DELETED],
      FREE,
    );
    expect(brand.differentiators).toBe("Beans from the Mambilla Plateau");
    expect(
      removedFromBrief(removedPoints(outline, pool, CAFE_FACTS, FREE)),
    ).toEqual([]);
  });

  it("finds a frame that still makes the removed point, in other words", () => {
    const frames = withFrame(cafePlan(), 2, {
      headline: "Beans from the Mambilla Plateau",
      subheadline: "Each bottle is labelled by hand by our baristas.",
    }).frames;
    const faults = removedFaults(
      frames,
      [DELETED],
      ["", "", "Beans from the Mambilla Plateau"],
      FREE,
    );
    expect(faults.map((f) => f.frame)).toEqual([2]);
    expect(faults[0].detail).toMatch(/took out/);
  });

  it("never ships it: the gate cuts the sentence and keeps the frame's own", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Beans from the Mambilla Plateau",
      subheadline:
        "Grown high in Taraba and roasted each week. Each bottle is labelled by hand by our baristas.",
    });
    const rules: GateRules = {
      frameCount: 5,
      facts: CAFE_FACTS,
      offering: "cold brew",
      hasImage: true,
      brandName: "Kiln Coffee",
      names: ["cold brew"],
      ledger: factLedger(
        [
          CAFE_BRIEF,
          "Kiln Coffee",
          "Grown high in Taraba and roasted each week",
          DELETED,
        ],
        3,
      ),
      claims: plan.frames.map((_, i) =>
        i === 2 ? "Beans from the Mambilla Plateau" : "",
      ),
      unsourced: [],
      removed: [DELETED],
    };
    const shipped = shipGate(plan, rules).plan;
    expect(shipped.frames[2].subheadline).toBe(
      "Grown high in Taraba and roasted each week.",
    );
    expect(
      setFaults(shipped, rules).filter((f) => /took out/.test(f.detail)),
    ).toEqual([]);
  });
});

/* An owner who sets a silk press at ₦16,500 on a body point while the
   action's point keeps ₦18,000 would see the set give both. */
describe("an owner's corrected price", () => {
  const price = {
    kind: "price" as const,
    text: "A silk press is ₦18,000",
    needs: needsFor("price", "A silk press is ₦18,000"),
  };

  it("is a correction when it prices the same thing another way", () => {
    expect(correctsFact("A silk press is ₦16,500 this month", price)).toBe(
      true,
    );
  });

  it("is not one when it says the fact again or prices something else", () => {
    expect(correctsFact("A silk press is ₦18,000", price)).toBe(false);
    expect(
      correctsFact("We braid children's hair on Saturdays for ₦8,000", price),
    ).toBe(false);
    /* A figure that is not money says nothing of the price: the live eval
       released "₦2,500 a bottle" for an owner's "350ml, keeps 5 days". */
    const bottle = {
      kind: "price" as const,
      text: "₦2,500 a bottle",
      needs: needsFor("price", "₦2,500 a bottle"),
    };
    expect(
      correctsFact("Each bottle is 350ml and keeps for 5 days", bottle),
    ).toBe(false);
    expect(correctsFact("Two bottles for ₦4,500", bottle)).toBe(true);
  });

  it("releases the old price though the action's point still gives it", () => {
    const outline: ApprovedOutline = {
      kind: "carousel",
      points: [
        {
          id: "p1",
          role: "hook",
          title: "Silk press",
          point: "Silk press at Crown & Coil",
          source: "brief",
        },
        {
          id: "p2",
          role: "body",
          title: "New price",
          point: "A silk press is ₦16,500 this month",
          source: "user",
        },
        {
          id: "p3",
          role: "cta",
          title: "Book",
          point: "Book at crownandcoil.ng. A silk press is ₦18,000.",
          source: "brief",
        },
      ],
    };
    expect(releasedFacts(outline, [], [price])).toEqual([0]);
  });
});

/* The live tuning eval released prices and dates no owner touched: a
   figure the owner's words only happened to share was read as a
   correction, so the set lost "₦18,000 for a 2-yard piece", "3 March"
   and "Free for your first 3 months". */
describe("correctsFact reads the fact's kind", () => {
  const f = (kind: BriefFact["kind"], text: string): BriefFact => ({
    kind,
    text,
    needs: needsFor(kind, text),
  });
  it.each([
    [
      "A 2-yard piece is enough for a skirt and blouse",
      f("price", "₦18,000 for a 2-yard piece"),
    ],
    [
      "Reminders go out 3 days before the due date, and 7 days after",
      f("date", "3 March"),
    ],
    [
      "No card needed to start the free 3 months",
      f("offer", "Free for your first 3 months"),
    ],
    [
      "Bring back an empty bottle and get ₦300 off your next one",
      f("price", "₦2,500 a bottle"),
    ],
    [
      "Each laptop costs ₦200,000 and lasts five years",
      f("price", "We need ₦6,000,000 for 30 laptops"),
    ],
    ["A 10kg bag holds a week of clothes", f("price", "₦8,000 for a 10kg bag")],
  ])("%s does not correct %o", (text, fact) => {
    expect(correctsFact(text, fact)).toBe(false);
  });
  it.each([
    ["Open 5am to 11pm every day", f("time", "5am to 10pm")],
    ["Launch moves to 3 April", f("date", "3 March")],
    [
      "A silk press is ₦16,500 this month",
      f("price", "A silk press is ₦18,000"),
    ],
  ])("%s corrects %o", (text, fact) => {
    expect(correctsFact(text, fact)).toBe(true);
  });
});

describe("a fact the owner took out with its point (O5 over H5)", () => {
  it("still counts against a line that says the removed point", () => {
    const facts = [
      fact("quantity", "One 60-minute session"),
      fact("price", "₦45,000 for December"),
      fact("contact", "0701 234 9876"),
    ];
    const plan = cafePlan({
      frames: cafePlan().frames.map((f, i) =>
        i === 4
          ? {
              ...f,
              headline: "Book your December session",
              subheadline: "",
              footerLines: ["₦45,000 for December", "One 60-minute session"],
            }
          : f,
      ),
    });
    const rules = {
      ...CAFE_RULES,
      names: [],
      facts,
      ledger: factLedger([CAFE_BRIEF], 1),
      removed: ["One 60-minute session."],
      released: ["One 60-minute session"],
      claims: [
        "",
        "",
        "",
        "",
        "Call 0701 234 9876 to book. ₦45,000 for December.",
      ],
    };
    const tookOut = (r: typeof rules) =>
      setFaults(plan, r).filter(
        (f) => f.frame === 4 && /the owner took out/.test(f.detail),
      );
    expect(tookOut(rules).length).toBeGreaterThan(0);
  });
});

describe("a where the owner took out with a point", () => {
  it("is still the action's to give", () => {
    const facts = [
      fact("place", "Plot 12 Aminu Kano Crescent, Wuse 2"),
      fact("contact", "Call 0805 111 2233"),
    ];
    const plan = cafePlan({
      frames: cafePlan().frames.map((f, i) =>
        i === 4
          ? {
              ...f,
              headline: "Drop off, collect in 3 days",
              subheadline: "",
              footerLines: ["Plot 12 Aminu Kano Crescent, Wuse 2"],
            }
          : f,
      ),
    });
    const faults = setFaults(plan, {
      ...CAFE_RULES,
      names: [],
      facts,
      ledger: factLedger([CAFE_BRIEF], 1),
      removed: ["Tailoring and alterations studio in Wuse 2, Abuja"],
      released: ["Plot 12 Aminu Kano Crescent, Wuse 2"],
      claims: ["", "", "", "", "Call 0805 111 2233 to drop off."],
    }).filter((f) => /a point the owner took out/.test(f.detail));
    expect(faults).toEqual([]);
  });
});
