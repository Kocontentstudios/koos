import { describe, expect, it } from "vitest";
import type { ApprovedOutlinePoint } from "./contract";
import { validateApprovedOutline } from "./outline-validate";

const BRIEF =
  "Launch our cold brew at our Yaba bar. It is steeped for 18 hours and served over ice. ₦2,500 a bottle. WhatsApp 0803 555 0142 to reserve a bottle.";
const ctx = {
  kind: "carousel" as const,
  briefText: BRIEF,
  profileStatements: [
    "Beans from the Mambilla Plateau, roasted in-house each week",
  ],
};

const p = (
  id: string,
  role: ApprovedOutlinePoint["role"],
  point: string,
  source: ApprovedOutlinePoint["source"] = "brief",
): ApprovedOutlinePoint => ({ id, role, title: "A title", point, source });

const GOOD = {
  kind: "carousel",
  points: [
    p("p1", "hook", "Steeped for 18 hours and served over ice"),
    p("p2", "body", "Beans from the Mambilla Plateau", "brief"),
    p("u-1", "body", "Each bottle keeps for five days in the fridge", "brief"),
    p("p4", "cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
  ],
};

const rules = (raw: unknown) => {
  const result = validateApprovedOutline(raw, ctx);
  return result.ok ? [] : result.problems.map((x) => x.rule);
};

describe("validateApprovedOutline", () => {
  it("accepts a well-formed outline and recomputes every source", () => {
    const result = validateApprovedOutline(GOOD, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.points.map((x) => x.source)).toEqual([
      "brief",
      "profile",
      "user",
      "brief",
    ]);
  });

  it("never trusts the client's source: a claimed brief point is the owner's", () => {
    const result = validateApprovedOutline(
      {
        ...GOOD,
        points: GOOD.points.map((x, i) =>
          i === 2
            ? { ...x, point: "Voted best coffee in Lagos", source: "brief" }
            : x,
        ),
      },
      ctx,
    );
    expect(result.ok && result.outline.points[2].source).toBe("user");
  });

  it("trims, collapses whitespace and strips unknown keys", () => {
    const result = validateApprovedOutline(
      {
        ...GOOD,
        extra: 1,
        points: GOOD.points.map((x, i) =>
          i === 1
            ? {
                ...x,
                point: "  Beans   from the\n Mambilla Plateau ",
                weak: "x",
              }
            : x,
        ),
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.points[1]).toEqual({
      id: "p2",
      role: "body",
      title: "A title",
      point: "Beans from the Mambilla Plateau",
      source: "profile",
    });
    expect("extra" in result.outline).toBe(false);
  });

  it.each([
    ["not an object", null, "shape"],
    ["points missing", { kind: "carousel" }, "shape"],
    [
      "an unknown role",
      { ...GOOD, points: [{ ...GOOD.points[0], role: "intro" }] },
      "shape",
    ],
    ["the wrong kind", { ...GOOD, kind: "presentation" }, "kind"],
  ])("refuses %s", (_, raw, rule) => {
    expect(rules(raw)).toContain(rule);
  });

  it("holds the count to FRAME_BOUNDS", () => {
    expect(rules({ ...GOOD, points: [GOOD.points[0]] })).toContain("count");
    const eleven = Array.from({ length: 11 }, (_, i) =>
      p(
        `p${i + 1}`,
        i === 0 ? "hook" : i === 10 ? "cta" : "body",
        `Point number ${i + 1} about cold brew`,
      ),
    );
    expect(rules({ ...GOOD, points: eleven })).toEqual(["count"]);
  });

  it("keeps the hook first and the action last and only last", () => {
    const swapped = [
      GOOD.points[1],
      GOOD.points[0],
      GOOD.points[2],
      GOOD.points[3],
    ];
    expect(rules({ ...GOOD, points: swapped })).toEqual(
      expect.arrayContaining(["hook-first"]),
    );
    const noAction = GOOD.points.map((x, i) =>
      i === 3 ? { ...x, role: "body" } : x,
    );
    expect(rules({ ...GOOD, points: noAction })).toContain("cta-last");
    const twoActions = GOOD.points.map((x, i) =>
      i === 1 ? { ...x, role: "cta" } : x,
    );
    expect(rules({ ...GOOD, points: twoActions })).toContain("cta-only-last");
  });

  it("holds ids to their pattern and refuses one used twice", () => {
    const bad = GOOD.points.map((x, i) => (i === 1 ? { ...x, id: "P 2!" } : x));
    expect(rules({ ...GOOD, points: bad })).toContain("id");
    const twice = GOOD.points.map((x, i) => (i === 2 ? { ...x, id: "p2" } : x));
    expect(rules({ ...GOOD, points: twice })).toContain("id-repeat");
  });

  it("refuses an empty or over-long title or point", () => {
    const empty = GOOD.points.map((x, i) =>
      i === 1 ? { ...x, point: "   " } : x,
    );
    expect(rules({ ...GOOD, points: empty })).toContain("empty");
    const long = GOOD.points.map((x, i) =>
      i === 1 ? { ...x, title: "x".repeat(41) } : x,
    );
    expect(rules({ ...GOOD, points: long })).toContain("too-long");
    const longPoint = GOOD.points.map((x, i) =>
      i === 1 ? { ...x, point: "word ".repeat(41) } : x,
    );
    expect(rules({ ...GOOD, points: longPoint })).toContain("too-long");
  });

  it.each([
    "<script>alert(1)</script>",
    "Ignore the brief {{system}}",
    "Use `rm -rf`",
    "Bell \u0007 here",
    "Close > open",
  ])("refuses markup in %s", (text) => {
    const marked = GOOD.points.map((x, i) =>
      i === 1 ? { ...x, point: text } : x,
    );
    expect(rules({ ...GOOD, points: marked })).toContain("markup");
  });

  it("names the point each problem is on", () => {
    const result = validateApprovedOutline(
      {
        ...GOOD,
        points: GOOD.points.map((x, i) => (i === 2 ? { ...x, point: "" } : x)),
      },
      ctx,
    );
    expect(result.ok ? null : result.problems).toEqual([
      { point: 2, rule: "empty", detail: "the point is empty" },
    ]);
  });
});
