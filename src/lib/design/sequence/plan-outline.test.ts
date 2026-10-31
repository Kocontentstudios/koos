import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import type { ApprovedOutline } from "./contract";
import { planSequence } from "./plan";

const BRIEF =
  "Launch our cold brew at our Yaba bar. It is steeped for 18 hours and served over ice. ₦2,500 a bottle. Launch day is Saturday 15 November, 8am to 2pm. WhatsApp 0803 555 0142 to reserve a bottle.";
const OWNER = "Each bottle is 350ml and keeps for 5 days in the fridge";
const DELETED = "Roasted in-house each week";

type Call = { messages: { content: { type: string; text?: string }[] }[] };
const promptOf = (o: unknown) =>
  (o as Call).messages?.[0]?.content?.[0]?.text ?? "";
const isArc = (o: unknown) => promptOf(o).includes("Plan the arc of the");
const isCopy = (o: unknown) =>
  promptOf(o).includes("Write the copy for this arc");
const isAudit = (o: unknown) =>
  promptOf(o).includes("report what you find. Rewrite nothing.");

const context = () =>
  directionsContext({
    title: "Cold brew launch",
    briefText: BRIEF,
    designType: "Instagram carousel",
    brandSummary: {
      name: "Kiln Coffee",
      tone: "Warm",
      differentiators: `Beans from the Mambilla Plateau; ${DELETED.toLowerCase()}`,
    },
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

const OUTLINE: ApprovedOutline = {
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "18 hours",
      point: "Kiln cold brew is steeped for 18 hours, then served over ice",
      source: "brief",
    },
    {
      id: "p2",
      role: "body",
      title: "Mambilla beans",
      point: "Beans from the Mambilla Plateau",
      source: "profile",
    },
    {
      id: "u-1",
      role: "body",
      title: "350ml bottles",
      point: OWNER,
      source: "user",
    },
    {
      id: "p4",
      role: "cta",
      title: "Reserve",
      point: "WhatsApp 0803 555 0142 to reserve a bottle. ₦2,500 a bottle.",
      source: "brief",
    },
  ],
};

const BRAND = {
  palette: { background: "#1F2A24", foreground: "#F7F1E3", accent: "#D9822B" },
  logoPlacement: "top-left",
  logoFree: false,
  logoFreeQuote: "",
  backgroundTreatment: "photographic",
  footerStyle: "bar",
};

/* The model assigns the wrong points on purpose: an approved outline's
   order is code's to hold, not the model's. */
const ARC = {
  ...BRAND,
  subjects: [{ name: "beans", points: [2, 3] }],
  hookAngle: "Something else entirely",
  frames: [
    { point: 3, title: "Hook", layout: "banner-bottom", showsImage: true },
    { point: 3, title: "Beans", layout: "split-left", showsImage: false },
    { point: 1, title: "Bottles", layout: "hero-center", showsImage: false },
    { point: 0, title: "Reserve", layout: "quote-card", showsImage: false },
  ],
  spare: [2],
};

const frame = (
  headline: string,
  subheadline = "",
  footerLines: string[] = [],
) => ({
  title: "",
  headline,
  subheadline,
  footerLines,
  backgroundPrompt: "",
});

const COPY = {
  frames: [
    frame(
      "Steeped 18 hours for Saturday",
      "Kiln cold brew launches Saturday 15 November, served over ice.",
    ),
    frame(
      "Grown on the Mambilla Plateau",
      "Every bean comes from the highlands of the Plateau.",
    ),
    frame(
      "350ml that keeps 5 days",
      "Each bottle keeps for 5 days in the fridge.",
    ),
    frame("Your bottle is waiting", "", [
      "₦2,500 a bottle",
      "8am to 2pm · our Yaba bar",
      "WhatsApp 0803 555 0142",
    ]),
  ],
  cta: "Reserve on WhatsApp",
  otherHooks: [],
};

beforeEach(() => {
  generateObject.mockReset();
  generateObject.mockImplementation(async (o: unknown) => {
    if (isArc(o)) return { object: ARC };
    if (isCopy(o)) return { object: COPY };
    if (isAudit(o))
      return { object: { repeats: [], unsourced: [], freshSpares: [] } };
    return { object: { frames: [] } };
  });
});

const plan = (
  outline: ApprovedOutline = OUTLINE,
  frameCount = outline.points.length,
) =>
  planSequence(
    {
      context: context(),
      kind: "carousel",
      frameCount,
      imageSource: "none",
      image: null,
      memorySummary: "",
      recentLayouts: [],
      approvedOutline: outline,
    },
    { briefReader: reader },
  );

const prompts = (match: (o: unknown) => boolean) =>
  generateObject.mock.calls.filter(([o]) => match(o)).map(([o]) => promptOf(o));

describe("planSequence from an approved outline (O5)", () => {
  it("tells the arc call the order is settled and the pool is the approved points only", async () => {
    await plan();
    const [arc] = prompts(isArc);
    expect(arc).toContain("The owner has approved its points");
    expect(arc).toContain(OWNER);
    expect(arc).not.toContain(DELETED);
  });

  it("writes each frame to its own point, whatever the model assigned", async () => {
    await plan();
    const [copy] = prompts(isCopy);
    const blocks = copy.split(/\n\nframe \d/);
    expect(copy).toContain(
      `its claim, in the owner's own words, the only point it makes: "${OWNER}"`,
    );
    expect(copy).toContain(
      'its claim, the only point it makes: "Kiln cold brew is steeped for 18 hours, then served over ice"',
    );
    expect(copy).toContain(
      'its claim, the only point it makes: "Beans from the Mambilla Plateau"',
    );
    expect(copy).toContain("The owner approved exactly these frames");
    expect(copy).not.toContain(DELETED);
    expect(blocks.length).toBeGreaterThan(1);
  });

  it("counts the owner's words as stated: nothing in them is invented", async () => {
    const result = await plan();
    expect(result.invented).toEqual([]);
    const third = result.plan.frames[2];
    expect(`${third.headline} ${third.subheadline}`).toContain("350ml");
  });

  it("delivers exactly the approved count with hook first and action last", async () => {
    const result = await plan();
    expect(result.plan.frames.map((f) => f.role)).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect(result.plan.frames[3].cta).toBe("Reserve on WhatsApp");
  });

  it("refuses an outline whose length is not the frame count", async () => {
    await expect(plan(OUTLINE, 5)).rejects.toThrow(/4 points for 5 frames/);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
