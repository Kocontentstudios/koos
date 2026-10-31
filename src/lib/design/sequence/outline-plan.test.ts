import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { needsFor } from "@/lib/jobs/directions/brief-facts";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { FRAME_BOUNDS, OUTLINE_LIMITS } from "./contract";
import { actionPoint, clipped, hookSource, planOutline } from "./outline-plan";
import { validateApprovedOutline } from "./outline-validate";

const BRIEF =
  "Launch our cold brew at our Yaba bar. It is steeped for 18 hours and served over ice. ₦2,500 a bottle. Launch day is Saturday 15 November, 8am to 2pm. WhatsApp 0803 555 0142 to reserve a bottle.";

const context = (over: Record<string, unknown> = {}) =>
  directionsContext({
    title: "Cold brew launch",
    briefText: BRIEF,
    designType: "Instagram carousel",
    brandSummary: {
      name: "Kiln Coffee",
      tone: "Warm",
      targetAudience: "Students and young professionals in Yaba",
      differentiators:
        "Beans from the Mambilla Plateau; roasted in-house each week",
      values: "Patience over shortcuts",
    },
    ...over,
  });

const reader = vi.fn(async () => ({
  facts: [
    { kind: "place", text: "our Yaba bar" },
    { kind: "price", text: "₦2,500 a bottle" },
    { kind: "date", text: "Saturday 15 November" },
    { kind: "time", text: "8am to 2pm" },
    { kind: "contact", text: "WhatsApp 0803 555 0142" },
  ],
  offering: { kind: "product", phrase: "cold brew" },
  people: [],
}));

const BRAND = {
  palette: { background: "#1F2A24", foreground: "#F7F1E3", accent: "#D9822B" },
  logoPlacement: "top-left",
  logoFree: false,
  logoFreeQuote: "",
  backgroundTreatment: "photographic",
  footerStyle: "bar",
};

const arcAnswer = (
  points: number[],
  hookAngle = "Steeped 18 hours, then poured over ice",
) => ({
  ...BRAND,
  subjects: [],
  hookAngle,
  frames: points.map((point, i) => ({
    point,
    title: `Frame ${i + 1} title`,
    layout: i % 2 ? "split-left" : "hero-center",
    showsImage: i === 0,
  })),
  spare: [],
});

const plan = (frameCount: number, over: Record<string, unknown> = {}) =>
  planOutline(
    { context: context(over), kind: "carousel", frameCount, memorySummary: "" },
    { briefReader: reader },
  );

beforeEach(() => {
  generateObject.mockReset();
  reader.mockClear();
});

describe("planOutline", () => {
  it("returns exactly N points, hook first, action last, ids p1..pN, one model call past the read", async () => {
    generateObject.mockResolvedValue({ object: arcAnswer([1, 2, 3, 0]) });
    const { outline, modelCalls } = await plan(4);
    expect(outline.frameCount).toBe(4);
    expect(outline.points.map((p) => p.role)).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect(outline.points.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(modelCalls).toBe(2);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("states each point in plain words with its source, never 'user'", async () => {
    generateObject.mockResolvedValue({ object: arcAnswer([1, 2, 3, 0]) });
    const { outline } = await plan(4);
    expect(outline.points[0].point).toBe(
      "Steeped 18 hours, then poured over ice",
    );
    for (const p of outline.points) {
      expect(p.point.length).toBeGreaterThan(0);
      expect(p.point.length).toBeLessThanOrEqual(OUTLINE_LIMITS.pointChars);
      expect(p.title.length).toBeLessThanOrEqual(OUTLINE_LIMITS.titleChars);
      expect(["brief", "profile"]).toContain(p.source);
    }
    expect(outline.points[3].point).toContain("WhatsApp 0803 555 0142");
    expect(outline.points[3].point).toContain("₦2,500 a bottle");
    expect(outline.offering).toBe("cold brew");
    expect(outline.facts).toContain("Saturday 15 November");
  });

  it("flags weak points in code: generic profile points and padding", async () => {
    generateObject.mockResolvedValue({
      object: arcAnswer([1, 2, 3, 4, 5, 6, 0]),
    });
    const { outline } = await plan(7);
    const weak = outline.points.filter((p) => p.weak);
    expect(weak.length).toBeGreaterThan(0);
    for (const p of weak) {
      expect(p.role).toBe("body");
      expect(p.weak?.reason).toMatch(/\.$/);
    }
    expect(
      outline.points
        .filter((p) => p.weak?.kind === "profile-fill")
        .every((p) => p.source === "profile"),
    ).toBe(true);
  });

  it("signs every point so an untouched point keeps its source", async () => {
    generateObject.mockResolvedValue({ object: arcAnswer([1, 2, 3, 0]) });
    const { outline } = await plan(4);
    const ctx = {
      kind: "carousel" as const,
      briefText: BRIEF,
      profileStatements: [],
    };
    const untouched = validateApprovedOutline(
      { kind: "carousel", points: outline.points },
      ctx,
    );
    expect(
      untouched.ok && untouched.outline.points.map((p) => p.source),
    ).toEqual(outline.points.map((p) => p.source));
    expect(
      untouched.ok && untouched.outline.points.some((p) => p.source === "user"),
    ).toBe(false);
  });

  it("asks once more when the answer is off the schema", async () => {
    const off = Object.assign(new Error("no object"), {
      name: "AI_NoObjectGeneratedError",
    });
    generateObject
      .mockRejectedValueOnce(off)
      .mockResolvedValue({ object: arcAnswer([1, 2, 0]) });
    const { outline, modelCalls } = await plan(3);
    expect(outline.points).toHaveLength(3);
    expect(modelCalls).toBe(3);
  });

  it.each([1, 11, 2.5, Number.NaN])(
    "refuses %s frames, naming the count",
    async (n) => {
      await expect(plan(n)).rejects.toThrow(
        new RegExp(
          `a carousel takes ${FRAME_BOUNDS.carousel.min} to ${FRAME_BOUNDS.carousel.max} frames; got ${n}`,
        ),
      );
      expect(generateObject).not.toHaveBeenCalled();
    },
  );

  it("logs counts only, never the brief", async () => {
    generateObject.mockResolvedValue({ object: arcAnswer([1, 2, 0]) });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await plan(3);
    const [name, payload] =
      info.mock.calls.find(([n]) => n === "design.outline.planned") ?? [];
    expect(name).toBe("design.outline.planned");
    expect(JSON.stringify(payload)).not.toContain("steeped");
    expect(payload).toMatchObject({
      kind: "carousel",
      frames: 3,
      modelCalls: 2,
    });
    info.mockRestore();
  });
});

describe("actionPoint", () => {
  const brief = (over: Partial<Parameters<typeof actionPoint>[0]> = {}) => ({
    briefText: BRIEF,
    brandName: "Kiln Coffee",
    facts: [
      { kind: "price" as const, text: "₦2,500 a bottle", needs: [] },
      {
        kind: "contact" as const,
        text: "WhatsApp 0803 555 0142",
        needs: ["#08035550142"],
      },
    ],
    offering: "cold brew",
    offeringIndex: -1,
    names: [],
    free: new Set<string>(),
    atAction: new Set([0]),
    readAvailable: true,
    ...over,
  });

  it("is the brief's own sentence on how to act, with the action's facts it leaves out", () => {
    expect(actionPoint(brief()).point).toBe(
      "WhatsApp 0803 555 0142 to reserve a bottle. ₦2,500 a bottle.",
    );
  });

  /* O1 round-1 critic, LOW 12: "Contact founders@farmlink.ng. $750,000." */
  it("gives a carried figure in the brief's own short sentence", () => {
    const deck =
      "Farmlink rents solar cold rooms to tomato farmers in Kano by the crate. We are raising $750,000. Contact founders@farmlink.ng.";
    expect(
      actionPoint(
        brief({
          briefText: deck,
          facts: [
            {
              kind: "price",
              text: "$750,000",
              needs: needsFor("price", "$750,000"),
            },
            {
              kind: "contact",
              text: "founders@farmlink.ng",
              needs: needsFor("contact", "founders@farmlink.ng"),
            },
          ],
          atAction: new Set([0]),
        }),
      ).point,
    ).toBe("Contact founders@farmlink.ng. We are raising $750,000.");
  });

  it("asks the owner for an action when the brief gives none, inventing nothing", () => {
    const { point } = actionPoint(
      brief({ briefText: "Our cold brew.", facts: [], atAction: new Set() }),
    );
    expect(point).toMatch(/Add your contact/);
  });
});

describe("clipped", () => {
  it("cuts at a word, never mid-word", () => {
    expect(clipped("one two three four", 12)).toBe("one two…");
    expect(clipped("short", 12)).toBe("short");
  });
});

/* The thin phone-repair outline labelled a hook that restates the brief
   as source "profile". */
describe("hookSource", () => {
  it("is the brief's when the hook says the brief's words", () => {
    expect(
      hookSource(
        "Fixit Hub replaces your cracked iPhone screen the same day.",
        "Cracked iPhone screen? Fixit Hub replaces it the same day for ₦45,000.",
        [
          "Phone repair shop in Yaba, Lagos",
          "Every repair comes with a 90-day warranty",
        ],
      ),
    ).toBe("brief");
  });

  it("is the profile's when the hook says the profile's words", () => {
    expect(
      hookSource(
        "Every repair comes with a 90-day warranty",
        "Cracked iPhone screen? Fixit Hub replaces it the same day.",
        ["Every repair comes with a 90-day warranty"],
      ),
    ).toBe("profile");
  });
});
