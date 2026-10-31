import { describe, expect, it } from "vitest";
import { FRAME_BOUNDS, OUTLINE_LIMITS } from "@/lib/design/sequence/contract";
import { plannedOutline } from "./fixtures";
import {
  addPoint,
  canAdd,
  canRemove,
  countOptions,
  draftFrom,
  draftProblems,
  editPoint,
  fieldProblem,
  generateLabel,
  removePoint,
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
  it("marks an edited point the user's and the draft edited", () => {
    const draft = editPoint(
      draftFrom(plannedOutline(5)),
      "p2",
      "title",
      "Woven here",
    );
    expect(draft.points[1]).toMatchObject({
      title: "Woven here",
      source: "user",
    });
    expect(draft.edited).toBe(true);
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
      source: "user",
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
