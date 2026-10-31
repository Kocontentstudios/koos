import { describe, expect, it } from "vitest";
import {
  FRAME_BOUNDS,
  OUTLINE_LIMITS,
  type PlannedOutline,
} from "@/lib/design/sequence/contract";
import { plannedOutline } from "./fixtures";
import {
  addPoint,
  canAdd,
  canMove,
  canRemove,
  canRestore,
  countOptions,
  draftFrom,
  draftProblems,
  editPoint,
  fieldProblem,
  generateLabel,
  lastRemoved,
  movePoint,
  removePoint,
  restoreRemoved,
  sameClaim,
  sourceLabel,
  statesFact,
  toApproved,
  unstatedFacts,
  weakCount,
  weakReason,
} from "./outline-model";

const roles = (d: ReturnType<typeof draftFrom>) => d.points.map((p) => p.role);

describe("draftFrom", () => {
  it("keeps the planner's points, untouched and unedited", () => {
    const draft = draftFrom(plannedOutline(5));
    expect(draft.points.map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);
    expect(roles(draft)).toEqual(["hook", "body", "body", "body", "cta"]);
    expect(draft.edited).toBe(false);
    expect(weakCount(draft)).toBe(2);
  });

  it("puts roles back by position if the server sent them out of place", () => {
    const planned = plannedOutline(3);
    planned.points[1] = { ...planned.points[1], role: "cta" };
    expect(roles(draftFrom(planned))).toEqual(["hook", "body", "cta"]);
  });
});

describe("editPoint", () => {
  it("marks a point the user's once its words change, and the draft edited", () => {
    const draft = editPoint(
      draftFrom(plannedOutline(5)),
      "p2",
      "point",
      "Woven by hand in our own workshop.",
    );
    expect(draft.points[1]).toMatchObject({
      point: "Woven by hand in our own workshop.",
      source: "user",
    });
    expect(draft.edited).toBe(true);
  });

  it("keeps the source and the flag on a retitled point, since its claim is unchanged", () => {
    const start = draftFrom(plannedOutline(5));
    const retitled = editPoint(start, "p4", "title", "Since 1998");
    expect(retitled.points[3]).toMatchObject({
      title: "Since 1998",
      point: "We have tailored for Lagos families since 1998.",
      source: "profile",
      weak: { kind: "profile-fill" },
    });
    expect(retitled.edited).toBe(true);
    expect(toApproved(retitled).points[3].source).toBe("profile");
  });

  it("never leaves a profile-fill flag on a point the user wrote", () => {
    let draft = draftFrom(plannedOutline(5));
    draft = editPoint(draft, "p4", "title", "Since 1998");
    draft = editPoint(draft, "p4", "point", "Linen cut for Lagos heat.");
    draft = editPoint(draft, "p4", "title", "Cut for the heat");
    for (const point of draft.points) {
      if (point.source === "user") expect(point.weak).toBeNull();
    }
    expect(draft.points[3].source).toBe("user");
  });

  it("clears a weak flag only when the point's own words change", () => {
    const start = draftFrom(plannedOutline(5));
    const retitled = editPoint(start, "p3", "title", "Made for you");
    expect(retitled.points[2].weak?.kind).toBe("filler");
    const rewritten = editPoint(
      start,
      "p3",
      "point",
      "Each shirt is cut to your size.",
    );
    expect(rewritten.points[2].weak).toBeNull();
  });

  it("caps the words at the contract's limits as they are typed", () => {
    const start = draftFrom(plannedOutline(5));
    const long = "x".repeat(500);
    const draft = editPoint(
      editPoint(start, "p2", "title", long),
      "p2",
      "point",
      long,
    );
    expect(draft.points[1].title).toHaveLength(OUTLINE_LIMITS.titleChars);
    expect(draft.points[1].point).toHaveLength(OUTLINE_LIMITS.pointChars);
  });

  it("turns typed line breaks into spaces, which the server would refuse", () => {
    const draft = editPoint(
      draftFrom(plannedOutline(5)),
      "p2",
      "point",
      "one\ntwo\r\nthree",
    );
    expect(draft.points[1].point).toBe("one two three");
  });

  it("returns the same draft when nothing changed", () => {
    const start = draftFrom(plannedOutline(5));
    expect(editPoint(start, "p2", "title", start.points[1].title)).toBe(start);
    expect(editPoint(start, "nope", "title", "x")).toBe(start);
  });

  it("works out which brief facts a rewritten point still states", () => {
    const start = draftFrom(plannedOutline(5));
    const kept = editPoint(start, "p2", "point", "Woven in ABEOKUTA, by hand.");
    expect(kept.points[1].facts).toEqual(["Abeokuta"]);
    const dropped = editPoint(start, "p2", "point", "Woven by hand.");
    expect(dropped.points[1].facts).toEqual([]);
  });
});

/* Slide 3 makes slide 2's point: both state "Abeokuta". */
function withOverlap(): PlannedOutline {
  const planned = plannedOutline(5);
  planned.points[2] = {
    ...planned.points[2],
    title: "Local cotton",
    point: "Our cotton is woven in Abeokuta, Nigeria.",
    facts: ["Abeokuta"],
    weak: {
      kind: "overlap",
      reason: "Says the same as point 2.",
      overlapsWith: "p2",
    },
  };
  return planned;
}

describe("an edit that changes no words", () => {
  it("compares claims by their words, not punctuation, case or spacing", () => {
    expect(sameClaim("Our cotton.", "  our   COTTON!  ")).toBe(true);
    expect(sameClaim("Our cotton.", "Our linen.")).toBe(false);
  });

  it.each([
    ["punctuation", "We have tailored for Lagos families since 1998.!"],
    ["whitespace", "We have tailored for Lagos families since 1998.   "],
    ["case", "we have tailored for lagos families since 1998"],
  ])(
    "keeps the source and a profile-fill flag after a %s-only edit",
    (_, text) => {
      const draft = editPoint(
        draftFrom(plannedOutline(5)),
        "p4",
        "point",
        text,
      );
      expect(draft.points[3]).toMatchObject({
        point: text,
        source: "profile",
        weak: { kind: "profile-fill" },
      });
      expect(weakCount(draft)).toBe(2);
      expect(draft.edited).toBe(true);
    },
  );

  it("keeps an overlap flag after a punctuation-only edit", () => {
    const draft = editPoint(
      draftFrom(withOverlap()),
      "p3",
      "point",
      "Our cotton is woven in Abeokuta, Nigeria.!",
    );
    expect(draft.points[2]).toMatchObject({
      source: "brief",
      weak: { kind: "overlap", overlapsWith: "p2" },
    });
  });

  it("brings the source and flag back when a rewrite is undone by typing", () => {
    const start = draftFrom(plannedOutline(5));
    const rewritten = editPoint(start, "p4", "point", "Linen for the heat.");
    expect(rewritten.points[3]).toMatchObject({ source: "user", weak: null });
    const back = editPoint(rewritten, "p4", "point", start.points[3].point);
    expect(back.points[3]).toMatchObject({
      source: "profile",
      weak: { kind: "profile-fill" },
    });
  });
});

describe("an overlap flag after a rewrite", () => {
  it("stays while the point still states the earlier point's fact", () => {
    const draft = editPoint(
      draftFrom(withOverlap()),
      "p3",
      "point",
      "Hand-loomed in Abeokuta by our weavers.",
    );
    expect(draft.points[2]).toMatchObject({
      source: "user",
      weak: { kind: "overlap" },
    });
  });

  it("stays while the point still holds every word of the earlier claim", () => {
    const planned = withOverlap();
    planned.points[2].facts = [];
    const draft = editPoint(
      draftFrom(planned),
      "p3",
      "point",
      "Truly, every piece is woven in Abeokuta from Nigerian cotton.",
    );
    expect(draft.points[2].weak?.kind).toBe("overlap");
  });

  it("goes once the shared fact goes", () => {
    const draft = editPoint(
      draftFrom(withOverlap()),
      "p3",
      "point",
      "Every shirt is cut to your measurements.",
    );
    expect(draft.points[2]).toMatchObject({ source: "user", weak: null });
  });

  it("goes when the earlier point is rewritten so they no longer match", () => {
    const draft = editPoint(
      draftFrom(withOverlap()),
      "p2",
      "point",
      "Every seam is finished by hand.",
    );
    expect(draft.points[2].weak).toBeNull();
    expect(draft.points[2].source).toBe("brief");
  });
});

describe("facts after a retitle", () => {
  it("drops a fact the old title alone stated, so the warning can show", () => {
    const planned = plannedOutline(5);
    planned.points[4] = {
      ...planned.points[4],
      title: "Lekki store",
      point: "Visit us from 10am.",
      facts: ["Lekki store"],
    };
    const draft = editPoint(draftFrom(planned), "p5", "title", "Come by");
    expect(draft.points[4].facts).toEqual([]);
    expect(unstatedFacts(draft)).toEqual(["Lekki store"]);
    expect(draft.points[4].source).toBe("brief");
  });

  it("keeps a fact the planner read into an unchanged point's paraphrase", () => {
    const planned = plannedOutline(5);
    planned.points[1] = {
      ...planned.points[1],
      point: "Woven by hand in the city of looms.",
      facts: ["Abeokuta"],
    };
    const draft = editPoint(draftFrom(planned), "p2", "title", "Hand woven");
    expect(draft.points[1].facts).toEqual(["Abeokuta"]);
    expect(unstatedFacts(draft)).toEqual([]);
  });

  it("picks up a fact the user types into a title", () => {
    const start = removePoint(draftFrom(plannedOutline(5)), "p2");
    expect(unstatedFacts(start)).toEqual(["Abeokuta"]);
    const draft = editPoint(start, "p3", "title", "From Abeokuta");
    expect(unstatedFacts(draft)).toEqual([]);
  });
});

describe("addPoint", () => {
  it("adds a blank body point just before the action", () => {
    const { draft, id } = addPoint(draftFrom(plannedOutline(5)));
    expect(id).toBe("u-1");
    expect(draft.points).toHaveLength(6);
    expect(draft.points[4]).toMatchObject({
      id: "u-1",
      role: "body",
      source: "user",
      title: "",
      point: "",
    });
    expect(draft.points[5].id).toBe("p5");
    expect(roles(draft)).toEqual([
      "hook",
      "body",
      "body",
      "body",
      "body",
      "cta",
    ]);
  });

  it("mints ids that match the contract and never repeat", () => {
    let draft = draftFrom(plannedOutline(2));
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = addPoint(draft);
      draft = result.draft;
      if (result.id) ids.push(result.id);
    }
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it("skips an id the outline already holds", () => {
    const planned = plannedOutline(3);
    planned.points[1] = { ...planned.points[1], id: "u-1" };
    expect(addPoint(draftFrom(planned)).id).toBe("u-2");
  });

  it("stops at the kind's maximum", () => {
    const full = draftFrom(plannedOutline(FRAME_BOUNDS.carousel.max));
    expect(canAdd(full)).toBe(false);
    const result = addPoint(full);
    expect(result.id).toBeNull();
    expect(result.draft).toBe(full);
  });

  it("lets a presentation grow past a carousel's maximum to its own", () => {
    const deck = draftFrom(
      plannedOutline(FRAME_BOUNDS.carousel.max, "presentation"),
    );
    expect(canAdd(deck)).toBe(true);
  });
});

describe("removePoint", () => {
  it("deletes a body point and keeps hook first and action last", () => {
    const draft = removePoint(draftFrom(plannedOutline(5)), "p3");
    expect(draft.points.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p5"]);
    expect(roles(draft)).toEqual(["hook", "body", "body", "cta"]);
    expect(draft.edited).toBe(true);
  });

  it("never deletes the hook or the action", () => {
    const start = draftFrom(plannedOutline(5));
    expect(canRemove(start, "p1")).toBe(false);
    expect(canRemove(start, "p5")).toBe(false);
    expect(removePoint(start, "p1")).toBe(start);
    expect(removePoint(start, "p5")).toBe(start);
  });

  it("stops at the kind's minimum", () => {
    const deck = draftFrom(
      plannedOutline(FRAME_BOUNDS.presentation.min, "presentation"),
    );
    expect(canRemove(deck, "p2")).toBe(false);
    expect(removePoint(deck, "p2")).toBe(deck);
  });

  it("drops an overlap flag that pointed at the deleted point", () => {
    const planned = plannedOutline(5);
    planned.points[3] = {
      ...planned.points[3],
      weak: {
        kind: "overlap",
        reason: "Says the same as point 2.",
        overlapsWith: "p2",
      },
    };
    const draft = removePoint(draftFrom(planned), "p2");
    expect(draft.points.find((p) => p.id === "p4")?.weak).toBeNull();
  });
});

describe("restoreRemoved", () => {
  it("puts the newest deleted point back where it was, as it was", () => {
    const start = draftFrom(plannedOutline(5));
    const removed = removePoint(start, "p3");
    expect(lastRemoved(removed)).toMatchObject({ index: 2 });
    const { draft, index } = restoreRemoved(removed);
    expect(index).toBe(2);
    expect(draft.points).toEqual(start.points);
    expect(draft.removed).toEqual([]);
    expect(draft.edited).toBe(true);
  });

  it("undoes several deletes newest first", () => {
    const start = draftFrom(plannedOutline(6));
    let draft = removePoint(removePoint(start, "p2"), "p4");
    draft = restoreRemoved(draft).draft;
    expect(draft.points.map((p) => p.id)).toEqual([
      "p1",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    draft = restoreRemoved(draft).draft;
    expect(draft.points.map((p) => p.id)).toEqual(
      start.points.map((p) => p.id),
    );
    expect(restoreRemoved(draft)).toEqual({ draft, index: null });
  });

  it("keeps the action last when the outline shrank since the delete", () => {
    let draft = removePoint(draftFrom(plannedOutline(6)), "p5");
    draft = removePoint(draft, "p4");
    draft = { ...draft, removed: draft.removed.slice(0, 1) };
    const restored = restoreRemoved(draft);
    expect(restored.index).toBe(3);
    expect(restored.draft.points.map((p) => p.role)).toEqual([
      "hook",
      "body",
      "body",
      "body",
      "cta",
    ]);
  });

  it("will not restore past the kind's maximum", () => {
    let draft = removePoint(
      draftFrom(plannedOutline(FRAME_BOUNDS.carousel.max)),
      "p2",
    );
    draft = addPoint(draft).draft;
    expect(canRestore(draft)).toBe(false);
    expect(restoreRemoved(draft).index).toBeNull();
    expect(restoreRemoved(draft).draft).toBe(draft);
  });

  it("brings back the overlap flag the delete dropped", () => {
    const start = draftFrom(withOverlap());
    const removed = removePoint(start, "p2");
    expect(removed.points.find((p) => p.id === "p3")?.weak).toBeNull();
    const { draft } = restoreRemoved(removed);
    expect(draft.points.find((p) => p.id === "p3")?.weak?.kind).toBe("overlap");
  });

  it("keeps edits made to other points after the delete", () => {
    let draft = removePoint(draftFrom(plannedOutline(5)), "p3");
    draft = editPoint(draft, "p2", "title", "Woven here");
    draft = restoreRemoved(draft).draft;
    expect(draft.points[1].title).toBe("Woven here");
    expect(draft.points[2].id).toBe("p3");
  });

  it("starts empty on a fresh plan", () => {
    expect(draftFrom(plannedOutline(5)).removed).toEqual([]);
  });
});

describe("weakReason", () => {
  it("says the server's reason for filler and profile points", () => {
    const draft = draftFrom(plannedOutline(5));
    expect(weakReason(draft, draft.points[2])).toMatch(
      /Only says who it is for/,
    );
    expect(weakReason(draft, draft.points[3])).toMatch(/brand profile/);
    expect(weakReason(draft, draft.points[0])).toBeNull();
  });

  it("names an overlap's earlier slide by where it sits now", () => {
    const planned = plannedOutline(5);
    planned.points[3] = {
      ...planned.points[3],
      weak: {
        kind: "overlap",
        reason: "Says the same as point 3.",
        overlapsWith: "p3",
      },
    };
    const before = draftFrom(planned);
    expect(weakReason(before, before.points[3])).toBe(
      "Says the same as slide 3, “Who it's for”. Give this slide a different point.",
    );
    const after = removePoint(before, "p2");
    expect(weakReason(after, after.points[2])).toBe(
      "Says the same as slide 2, “Who it's for”. Give this slide a different point.",
    );
  });
});

describe("unstatedFacts", () => {
  it("is empty while every fact is on some point", () => {
    expect(unstatedFacts(draftFrom(plannedOutline(5)))).toEqual([]);
  });

  it("names the facts a deletion leaves unstated", () => {
    const draft = removePoint(draftFrom(plannedOutline(5)), "p2");
    expect(unstatedFacts(draft)).toEqual(["Abeokuta"]);
  });

  it("counts a fact the user typed into their own point as stated", () => {
    let draft = removePoint(draftFrom(plannedOutline(5)), "p2");
    draft = editPoint(draft, "p3", "point", "Woven in Abeokuta for Lagos.");
    expect(unstatedFacts(draft)).toEqual([]);
  });

  it("matches facts loosely, by words", () => {
    expect(statesFact("Come to the Lekki-store!", "Lekki store")).toBe(true);
    expect(statesFact("anything", "  ")).toBe(false);
  });
});

describe("fieldProblem and draftProblems", () => {
  it("refuses a blank field", () => {
    expect(fieldProblem("title", "   ")).toMatch(/title/);
    expect(fieldProblem("point", "")).toMatch(/or delete it/);
  });

  it("refuses the markup validateApprovedOutline refuses", () => {
    for (const bad of [
      "<b>hi</b>",
      "a > b",
      "use `code`",
      "{{name}}",
      "x }} y",
      "bell\u0007",
    ]) {
      expect(fieldProblem("point", bad)).toMatch(/plain words/);
    }
    expect(
      fieldProblem("point", "Prices from ₦25,000 {single brace} ok"),
    ).toBeNull();
  });

  it("refuses words past the limit", () => {
    expect(
      fieldProblem("title", "x".repeat(OUTLINE_LIMITS.titleChars + 1)),
    ).toMatch(/40 characters/);
  });

  it("lists every field to fix, in slide order", () => {
    const { draft } = addPoint(draftFrom(plannedOutline(3)));
    expect(draftProblems(draft)).toEqual([
      { id: "u-1", field: "title", message: "Give this slide a title." },
      {
        id: "u-1",
        field: "point",
        message: expect.stringMatching(/or delete it/),
      },
    ]);
  });
});

describe("toApproved", () => {
  it("sends what the contract takes, trimmed, without facts or flags", () => {
    const draft = editPoint(
      draftFrom(plannedOutline(3)),
      "p2",
      "title",
      "  Woven here  ",
    );
    const approved = toApproved(draft);
    expect(approved.kind).toBe("carousel");
    expect(approved.points[1]).toEqual({
      id: "p2",
      role: "body",
      title: "Woven here",
      point: "Every piece is woven in Abeokuta from Nigerian cotton.",
      source: "brief",
    });
    expect(Object.keys(approved.points[0]).sort()).toEqual([
      "id",
      "point",
      "role",
      "source",
      "title",
    ]);
  });
});

describe("labels", () => {
  it("names each source in plain words", () => {
    expect(sourceLabel("brief")).toBe("From your brief");
    expect(sourceLabel("profile")).toBe("From your brand profile");
    expect(sourceLabel("user")).toBe("Written by you");
  });

  it("puts the units on the generate button: one per slide", () => {
    expect(generateLabel(5)).toBe("Generate 5 slides · 5 units");
    expect(generateLabel(1)).toBe("Generate 1 slide · 1 unit");
  });

  it("offers every count within the kind's bounds", () => {
    expect(countOptions("carousel")).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(countOptions("presentation")[0]).toBe(3);
    expect(countOptions("presentation").at(-1)).toBe(12);
  });
});

describe("movePoint", () => {
  const ids = (d: ReturnType<typeof draftFrom>) => d.points.map((p) => p.id);

  it("swaps a body point with its neighbour and keeps every role in place", () => {
    const start = draftFrom(plannedOutline(5));
    const down = movePoint(start, "p2", "down");
    expect(ids(down)).toEqual(["p1", "p3", "p2", "p4", "p5"]);
    expect(roles(down)).toEqual(["hook", "body", "body", "body", "cta"]);
    expect(down.edited).toBe(true);
    expect(ids(movePoint(down, "p2", "up"))).toEqual(ids(start));
  });

  it("never moves the hook or the action, or a body point past them", () => {
    const start = draftFrom(plannedOutline(5));
    expect(canMove(start, "p1", "down")).toBe(false);
    expect(canMove(start, "p5", "up")).toBe(false);
    expect(canMove(start, "p2", "up")).toBe(false);
    expect(canMove(start, "p4", "down")).toBe(false);
    expect(canMove(start, "p2", "down")).toBe(true);
    expect(canMove(start, "nope", "down")).toBe(false);
    expect(movePoint(start, "p2", "up")).toBe(start);
    expect(movePoint(start, "p1", "down")).toBe(start);
  });

  it("keeps who wrote each point when it moves", () => {
    const moved = movePoint(draftFrom(plannedOutline(5)), "p4", "up");
    expect(moved.points[2]).toMatchObject({ id: "p4", source: "profile" });
  });
});
