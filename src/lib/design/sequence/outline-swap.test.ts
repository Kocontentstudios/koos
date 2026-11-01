import { describe, expect, it } from "vitest";
import { type BriefFact, needsFor } from "@/lib/jobs/directions/brief-facts";
import { namesFree } from "./hook";
import { EMPTY_POINT } from "./outline-arc";
import { flagOutline } from "./outline-flags";
import { type PlacedPoint, withOverlapsSwapped } from "./outline-plan";

const fact = (kind: BriefFact["kind"], text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const FACTS = [
  fact("place", "Lekki Phase 1"),
  fact("price", "₦8,000"),
  fact("contact", "crownandcoil.ng"),
];

const ctx = {
  kind: "carousel" as const,
  facts: FACTS,
  free: namesFree("Crown & Coil", "natural hair care"),
};

const drafts: PlacedPoint[] = [
  { role: "hook", source: "brief", text: "Free scalp massage with every wash" },
  {
    role: "body",
    source: "brief",
    text: "A free scalp massage with each wash",
  },
  { role: "body", source: "brief", text: "Stylists trained in natural hair" },
  { role: "cta", source: "brief", text: "Book at crownandcoil.ng for ₦8,000." },
];

const overlaps = (points: readonly PlacedPoint[]) =>
  flagOutline(
    points.map((p, i) => ({
      id: `p${i + 1}`,
      role: p.role,
      title: "",
      point: p.text,
      source: p.source,
      facts: [],
    })),
    ctx,
  ).filter((p) => p.weak?.kind === "overlap").length;

describe("withOverlapsSwapped: the planner never hands over a point twice", () => {
  it("gives a point that repeats another a spare point in its place", () => {
    expect(overlaps(drafts)).toBe(1);
    const { points, swapped } = withOverlapsSwapped(
      drafts,
      [
        {
          source: "brief",
          text: "Stylists trained in natural hair",
          facts: [],
        },
        { source: "profile", text: "Products free of sulphates", facts: [] },
      ],
      ctx,
    );
    expect(swapped).toEqual([1]);
    expect(points[1]).toEqual({
      role: "body",
      source: "profile",
      text: "Products free of sulphates",
    });
    expect(overlaps(points)).toBe(0);
  });

  it("leaves the slide for the owner to write when no spare is distinct", () => {
    const { points, swapped } = withOverlapsSwapped(drafts, [], ctx);
    expect(swapped).toEqual([1]);
    expect(points[1]).toEqual({
      role: "body",
      source: "user",
      text: EMPTY_POINT,
    });
    expect(overlaps(points)).toBe(0);
  });

  it("moves the only point that states a brief fact onto the action, then swaps the slide", () => {
    const priced: PlacedPoint[] = [
      drafts[0],
      {
        role: "body",
        source: "brief",
        text: "Free scalp massage, ₦8,000 a wash",
      },
      drafts[2],
      { role: "cta", source: "brief", text: "Book at crownandcoil.ng." },
    ];
    const { points, swapped } = withOverlapsSwapped(
      priced,
      [{ source: "profile", text: "Products free of sulphates", facts: [] }],
      ctx,
    );
    expect(swapped).toEqual([1]);
    expect(points[3].text).toBe(
      "Book at crownandcoil.ng. Free scalp massage, ₦8,000 a wash.",
    );
    expect(points[1].text).toBe("Products free of sulphates");
  });
});
