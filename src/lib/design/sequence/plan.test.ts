import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import type { PlannedSequence } from "./contract";
import { CAFE_BRIEF } from "./fixtures";
import { MAX_MODEL_CALLS, planSequence } from "./plan";
import { validateSequence } from "./validate";

type Call = {
  messages: {
    content: ({ type: "text"; text: string } | { type: "image" })[];
  }[];
};

const promptOf = (options: unknown): string => {
  const part = (options as Call).messages?.[0]?.content?.[0];
  return part && part.type === "text" ? part.text : "";
};
const hasImage = (options: unknown) =>
  (options as Call).messages?.[0]?.content?.some((p) => p.type === "image");
const isArc = (o: unknown) => promptOf(o).includes("Plan the arc of the");
const isCopy = (o: unknown) =>
  promptOf(o).includes("Write the copy for this arc");
const isFix = (o: unknown) =>
  promptOf(o).includes("as written, with each frame's claim");

const context = (over: Record<string, unknown> = {}) =>
  directionsContext({
    title: "Cold brew launch",
    briefText: CAFE_BRIEF,
    designType: "Instagram carousel",
    brandSummary: {
      name: "Kiln Coffee",
      tone: "Warm",
      differentiators:
        "Beans from one farm on the Plateau; roasted in-house each week",
      values: "Patience over shortcuts",
    },
    ...over,
  });

const reader = vi.fn(async () => ({
  facts: [
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

const arcFrame = (point: number, title: string, layout = "hero-center") => ({
  point,
  title,
  layout,
  showsImage: false,
});

const ARC = {
  ...BRAND,
  hookAngle: "Every bottle starts with beans from one farm",
  kinds: ["where-it-comes-from", "how-it-is-made", "belief"],
  sameAs: [],
  frames: [
    arcFrame(1, "One farm", "banner-bottom"),
    arcFrame(2, "Roasted here", "split-left"),
    arcFrame(3, "Why we wait", "quote-card"),
    arcFrame(0, "Reserve yours", "hero-center"),
  ],
  spare: [],
};

const copyFrame = (
  headline: string,
  subheadline = "",
  footerLines: string[] = [],
) => ({ headline, subheadline, footerLines, backgroundPrompt: "" });

const COPY = {
  frames: [
    copyFrame(
      "Every bottle starts on one farm",
      "Our cold brew is made from beans grown on the Plateau.",
    ),
    copyFrame(
      "Roasted in-house each week",
      "Each batch is roasted here before it is brewed.",
    ),
    copyFrame(
      "Patience over shortcuts",
      "We would rather wait than rush a glass.",
    ),
    copyFrame(
      "Your first bottle is waiting",
      "Pick it up on Saturday 15 November, 8am to 2pm.",
      ["₦2,500 a bottle", "WhatsApp 0803 555 0142"],
    ),
  ],
  cta: "Reserve on WhatsApp",
  otherHooks: [],
};

type Answers = {
  arc?: unknown;
  copy?: unknown;
  fixes?: unknown[];
};

/** Answers each call by what it asks for; fix calls in turn. */
function answer({ arc = ARC, copy = COPY, fixes = [] }: Answers = {}) {
  let fix = 0;
  generateObject.mockImplementation(async (o: unknown) => {
    if (isArc(o)) return { object: arc };
    if (isCopy(o)) return { object: copy };
    if (isFix(o)) {
      const next = fixes[fix] ?? { frames: [] };
      fix += 1;
      return { object: next };
    }
    throw new Error(`unexpected prompt: ${promptOf(o).slice(0, 80)}`);
  });
}

const plan = (over: Record<string, unknown> = {}) =>
  planSequence(
    {
      context: context(),
      kind: "carousel",
      frameCount: 4,
      imageSource: "none",
      image: null,
      memorySummary: "",
      recentLayouts: [],
      ...over,
    },
    { briefReader: reader },
  );

const promptsOf = (match: (o: unknown) => boolean) =>
  generateObject.mock.calls.filter(([o]) => match(o)).map(([o]) => promptOf(o));

const headlines = (p: PlannedSequence) => p.frames.map((f) => f.headline);

beforeEach(() => {
  generateObject.mockReset();
  reader.mockClear();
});

describe("planSequence: arc first", () => {
  it("asks for the arc before any copy, then copy to it, and delivers exactly the frames asked for", async () => {
    answer();
    const result = await plan();
    const order = generateObject.mock.calls.map(([o]) =>
      isArc(o) ? "arc" : isCopy(o) ? "copy" : "fix",
    );
    expect(order.slice(0, 2)).toEqual(["arc", "copy"]);
    expect(result.plan.frames.map((f) => f.role)).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect(result.plan.frames[3].cta).toBe("Reserve on WhatsApp");
    expect(
      validateSequence(result.plan, {
        frameCount: 4,
        facts: result.facts,
        offering: result.offering,
        hasImage: false,
        brandName: "Kiln Coffee",
      }),
    ).toEqual([]);
  });

  it("numbers the pool's points for the arc and gives each frame only its own claim", async () => {
    answer();
    await plan();
    const [arcPrompt] = promptsOf(isArc);
    expect(arcPrompt).toContain(
      '1. (the brand profile says) "Beans from one farm on the Plateau"',
    );
    const [copyPrompt] = promptsOf(isCopy);
    expect(copyPrompt).toContain(
      'its claim, the only point it makes: "roasted in-house each week"',
    );
    expect(copyPrompt).toContain(
      'its claim, the only point it makes: "Every bottle starts with beans from one farm"',
    );
  });

  it("replaces an assigned point that repeats another frame's before any copy", async () => {
    answer({
      arc: {
        ...ARC,
        frames: [
          arcFrame(1, "One farm"),
          arcFrame(1, "The farm again"),
          arcFrame(3, "Why we wait"),
          arcFrame(0, "Reserve yours"),
        ],
        spare: [2],
      },
    });
    await plan();
    const [copyPrompt] = promptsOf(isCopy);
    const frame2 = copyPrompt.slice(
      copyPrompt.indexOf("frame 2 ("),
      copyPrompt.indexOf("frame 3 ("),
    );
    expect(frame2).toContain(
      'its claim, the only point it makes: "roasted in-house each week"',
    );
  });

  it("puts a carousel's day on the hook as its news, and its price, time and contact on the action frame", async () => {
    answer();
    await plan();
    const [copyPrompt] = promptsOf(isCopy);
    const hook = copyPrompt.slice(
      copyPrompt.indexOf("frame 1 (HOOK"),
      copyPrompt.indexOf("frame 2 ("),
    );
    expect(hook).toContain('"Saturday 15 November"');
    const action = copyPrompt.slice(copyPrompt.indexOf("frame 4 (ACTION"));
    expect(action).toContain(
      'must state, in these words: "₦2,500 a bottle", "8am to 2pm", "WhatsApp 0803 555 0142"',
    );
  });

  it("makes no fix call for a set with nothing at fault", async () => {
    answer();
    const result = await plan();
    expect(promptsOf(isFix)).toEqual([]);
    expect(result.faults).toEqual([]);
    expect(result.modelCalls).toBe(3);
    expect(result.repaired).toBe(false);
  });

  it("refuses a frame count no set can have, before any call", async () => {
    await expect(plan({ frameCount: 11 })).rejects.toThrow(RangeError);
    await expect(plan({ kind: "presentation", frameCount: 2 })).rejects.toThrow(
      RangeError,
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });
});

describe("planSequence: the hook", () => {
  it("keeps the opening with the fewest faults among the versions written", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          copyFrame("Cold brew is here", "Come and try it."),
          ...COPY.frames.slice(1),
        ],
        otherHooks: [
          {
            headline: "Every bottle starts on one farm",
            subheadline:
              "Our cold brew is made from beans grown on the Plateau.",
          },
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[0].headline).toBe(
      "Every bottle starts on one farm",
    );
  });

  it("never ships a carousel's price in the hook's headline", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          copyFrame(
            "One-farm cold brew, ₦2,500 a bottle",
            "Our cold brew is made from beans grown on the Plateau.",
          ),
          ...COPY.frames.slice(1),
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[0].headline).not.toContain("2,500");
    expect(result.faults.some((f) => /gives the price/.test(f.detail))).toBe(
      false,
    );
  });
});

describe("planSequence: faults are fixed, not shipped", () => {
  const rewrite = (frame: number, over: Record<string, unknown>) => ({
    frame,
    title: "Roasted here",
    headline: "Roasted in-house each week",
    subheadline: "",
    footerLines: [],
    cta: "",
    ...over,
  });

  it("asks the fix call for the faulted frame only and keeps a version that clears it", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame(
            "Roasted in-house each week",
            "is roasted here before it is brewed.",
          ),
          ...COPY.frames.slice(2),
        ],
      },
      fixes: [
        {
          frames: [
            rewrite(2, {
              title: "Roasted here — A",
              subheadline: "Each batch is roasted here before it is brewed.",
            }),
          ],
        },
      ],
    });
    const result = await plan();
    const [fixPrompt] = promptsOf(isFix);
    expect(fixPrompt).toContain("Rewrite frames 2 only");
    expect(fixPrompt).toContain("starts mid-sentence");
    expect(result.plan.frames[1].subheadline).toBe(
      "Each batch is roasted here before it is brewed.",
    );
    expect(result.plan.frames[1].title).toBe("Roasted here");
    expect(result.repaired).toBe(true);
  });

  it("refuses a fix version that drops a brief fact", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          ...COPY.frames.slice(0, 3),
          copyFrame(
            "Your first bottle is waiting",
            "pick it up on Saturday 15 November, 8am to 2pm.",
            ["₦2,500 a bottle", "WhatsApp 0803 555 0142"],
          ),
        ],
      },
      fixes: [
        {
          frames: [
            rewrite(4, {
              title: "Reserve yours",
              headline: "Your first bottle is waiting",
              subheadline: "Pick it up this Saturday.",
              footerLines: ["WhatsApp 0803 555 0142"],
              cta: "Reserve on WhatsApp",
            }),
          ],
        },
      ],
    });
    const result = await plan();
    const action = result.plan.frames[3];
    expect(action.subheadline).not.toBe("Pick it up this Saturday.");
    expect(action.footerLines).toContain("₦2,500 a bottle");
  });

  it("leaves out a subheadline that is not a sentence when no rewrite fixes it", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame("Roasted in-house each week", "is roasted here weekly."),
          ...COPY.frames.slice(2),
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[1].subheadline).toBe("");
    expect(promptsOf(isFix).length).toBeGreaterThan(0);
  });

  it("gives a frame whose point another frame makes a spare point, and asks again", async () => {
    answer({
      arc: {
        ...ARC,
        frames: [
          arcFrame(1, "One farm"),
          arcFrame(2, "Roasted here"),
          arcFrame(0, "Reserve yours"),
        ],
        spare: [3],
      },
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame(
            "Every bottle starts on one farm",
            "Each batch is roasted here before it is brewed.",
          ),
          COPY.frames[3],
        ],
      },
    });
    await plan({ frameCount: 3 });
    const fixes = promptsOf(isFix);
    expect(fixes).toHaveLength(2);
    expect(fixes[1]).toContain(
      'NEW CLAIM: its point was another frame\'s, so it now makes this one instead: "Patience over shortcuts"',
    );
  });

  it("names two frames under one title apart", async () => {
    answer({
      arc: {
        ...ARC,
        frames: [
          arcFrame(1, "Our coffee"),
          arcFrame(2, "our Coffee"),
          arcFrame(3, "Why we wait"),
          arcFrame(0, "Reserve yours"),
        ],
      },
    });
    const result = await plan();
    const titles = result.plan.frames.map((f) => f.title.toLowerCase());
    expect(new Set(titles).size).toBe(4);
  });

  it("sets every headline in the casing most of them use", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame(
            "Roasted In-House Each Week",
            "Each batch is roasted here before it is brewed.",
          ),
          ...COPY.frames.slice(2),
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[1].headline).toBe("Roasted in-House each week");
  });

  it("writes a fact the copy left out in the brief's words", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          ...COPY.frames.slice(0, 3),
          copyFrame(
            "Your first bottle is waiting",
            "Pick it up on Saturday 15 November, 8am to 2pm.",
            ["WhatsApp 0803 555 0142"],
          ),
        ],
      },
    });
    const result = await plan();
    expect(result.factsDrawn).toEqual(["₦2,500 a bottle"]);
    expect(result.plan.frames[3].footerLines).toContain("₦2,500 a bottle");
  });

  it("keeps the copy when the fix call fails", async () => {
    generateObject.mockImplementation(async (o: unknown) => {
      if (isArc(o)) return { object: ARC };
      if (isCopy(o)) {
        return {
          object: {
            ...COPY,
            frames: [
              copyFrame("Cold brew is here", "Come and try it."),
              ...COPY.frames.slice(1),
            ],
          },
        };
      }
      throw new Error("provider down");
    });
    const result = await plan();
    expect(promptsOf(isFix).length).toBeGreaterThan(0);
    expect(result.plan.frames).toHaveLength(4);
  });
});

describe("planSequence: calls and inputs", () => {
  it("asks again when an answer does not match the schema, within its call budget", async () => {
    const malformed = Object.assign(new Error("no object"), {
      name: "AI_NoObjectGeneratedError",
      text: "{}",
    });
    generateObject.mockRejectedValue(malformed);
    await expect(plan()).rejects.toThrow();
    expect(generateObject.mock.calls.length).toBe(2);
    expect(generateObject.mock.calls.length).toBeLessThan(MAX_MODEL_CALLS);
  });

  it("shows the arc and copy calls an upload, never the fix call, and drops it once refused", async () => {
    let refused = false;
    generateObject.mockImplementation(async (o: unknown) => {
      if (hasImage(o) && !refused) {
        refused = true;
        throw new Error("image refused");
      }
      if (isArc(o)) return { object: ARC };
      if (isCopy(o)) {
        return {
          object: {
            ...COPY,
            frames: [
              copyFrame("Cold brew is here", "Come and try it."),
              ...COPY.frames.slice(1),
            ],
          },
        };
      }
      return { object: { frames: [] } };
    });
    const result = await plan({
      imageSource: "upload",
      image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" },
    });
    const withImage = generateObject.mock.calls.filter(([o]) => hasImage(o));
    expect(withImage).toHaveLength(1);
    expect(isArc(withImage[0][0])).toBe(true);
    expect(promptsOf(isFix).length).toBeGreaterThan(0);
    expect(result.plan.frames[0].showsImage).toBe(true);
  });

  it("plans a set with no image as text-led frames", async () => {
    answer();
    const result = await plan();
    expect(result.plan.frames.every((f) => !f.showsImage)).toBe(true);
    expect(
      result.plan.frames.every((f) =>
        ["hero-center", "quote-card", "stat-highlight"].includes(f.layout),
      ),
    ).toBe(true);
  });

  it("still plans when the brief reader is down", async () => {
    answer();
    const result = await planSequence(
      {
        context: context(),
        kind: "carousel",
        frameCount: 4,
        imageSource: "none",
        image: null,
        memorySummary: "",
        recentLayouts: [],
      },
      { briefReader: async () => Promise.reject(new Error("down")) },
    );
    expect(result.plan.frames).toHaveLength(4);
  });

  it("uses 16:9 for a presentation", async () => {
    answer();
    const result = await plan({ kind: "presentation", frameCount: 4 });
    expect(result.plan.aspectRatio).toBe("16:9");
    expect(headlines(result.plan)).toHaveLength(4);
  });

  it("leaves a trace of the arc and what was fixed", async () => {
    answer();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await plan();
    const trace = info.mock.calls.find(
      ([name]) => name === "design.sequence.planned",
    )?.[1] as Record<string, unknown>;
    expect(trace).toMatchObject({
      kind: "carousel",
      frames: 4,
      modelCalls: 3,
    });
    expect(trace.arc).toHaveLength(4);
    info.mockRestore();
  });
});
