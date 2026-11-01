import { describe, expect, it } from "vitest";
import type { ArcPoint } from "./arc";
import type { ApprovedOutline } from "./contract";
import { fact } from "./fixtures";
import { EMPTY_POINT, factsIn } from "./outline-arc";
import { settlePlaceholders } from "./placeholders";

/* Rubric Addendum C, C5: an "Add a point" slide left untouched is never
   handed to a writer to fill. */

const FACTS = [
  fact("price", "₦12,000"),
  fact("contact", "WhatsApp 0812 300 4455"),
];

const outline = (body: string[]): ApprovedOutline => ({
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "Tune-ups",
      point: "Pedal Doctor tune-ups, back on the road the same day",
      source: "brief",
    },
    ...body.map((point, i) => ({
      id: `p${i + 2}`,
      role: "body" as const,
      title: point === EMPTY_POINT ? "Add a point" : "A point",
      point,
      source: point === EMPTY_POINT ? ("user" as const) : ("profile" as const),
    })),
    {
      id: `p${body.length + 2}`,
      role: "cta",
      title: "Book now",
      point: "Book on WhatsApp 0812 300 4455. Tune-ups are ₦12,000.",
      source: "brief",
    },
  ],
});

const pool = (texts: string[]): ArcPoint[] =>
  texts.map((text) => ({
    source: "profile",
    text,
    facts: factsIn(text, FACTS),
  }));

describe("settlePlaceholders", () => {
  it("gives a placeholder a sourced point no approved point makes", () => {
    const settled = settlePlaceholders(
      outline(["Free pickup within Wuse and Maitama", EMPTY_POINT]),
      pool([
        "Free pickup within Wuse and Maitama",
        "Every bike is test-ridden before it goes back",
      ]),
      FACTS,
    );
    expect(settled.dropped).toEqual([]);
    expect(settled.outline.points[2]).toMatchObject({
      point: "Every bike is test-ridden before it goes back",
      source: "profile",
    });
  });

  it("drops a placeholder no sourced point is left for, and says which", () => {
    const settled = settlePlaceholders(
      outline([
        EMPTY_POINT,
        "Free pickup within Wuse and Maitama",
        EMPTY_POINT,
      ]),
      pool(["Free pickup within Wuse and Maitama"]),
      FACTS,
    );
    expect(settled.dropped).toEqual([1, 3]);
    expect(settled.origin).toEqual([0, 2, 4]);
    expect(settled.outline.points.map((p) => p.point)).not.toContain(
      EMPTY_POINT,
    );
    expect(settled.outline.points.at(-1)?.role).toBe("cta");
  });

  it("never hands a placeholder a point the owner deleted", () => {
    const planned = outline([
      EMPTY_POINT,
      "Every bike is test-ridden before it goes back",
      "Free pickup within Wuse and Maitama",
    ]);
    const deletion: ApprovedOutline = {
      ...planned,
      points: planned.points.filter((p) => p.id !== "p3"),
    };
    const settled = settlePlaceholders(
      deletion,
      pool([
        "Free pickup within Wuse and Maitama",
        "Every bike is test-ridden before it goes back",
      ]),
      FACTS,
    );
    expect(settled.outline.points.map((p) => p.point)).not.toContain(
      "Every bike is test-ridden before it goes back",
    );
    expect(settled.dropped).toEqual([1]);
  });

  it("keeps an outline left as planned reading as planned once a placeholder goes", () => {
    const settled = settlePlaceholders(
      outline([EMPTY_POINT, "Free pickup within Wuse and Maitama"]),
      pool(["Free pickup within Wuse and Maitama"]),
      FACTS,
    );
    expect(settled.dropped).toEqual([1]);
    expect(settled.outline.points.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("leaves the set at its bounds rather than below them", () => {
    const deck: ApprovedOutline = {
      ...outline([EMPTY_POINT]),
      kind: "presentation",
    };
    const settled = settlePlaceholders(deck, [], FACTS);
    expect(settled.dropped).toEqual([]);
    expect(settled.outline.points).toHaveLength(3);
  });
});
