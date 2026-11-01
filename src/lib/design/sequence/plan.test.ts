import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
/* The last resort runs as written unless a test makes it leave a fault,
   to see what the planner does with a set no repair clears. */
const lastResortLeaves = vi.fn((): unknown[] | null => null);
vi.mock("./last-resort", async (importOriginal) => {
  const real = await importOriginal<typeof import("./last-resort")>();
  return {
    ...real,
    lastResort: (...args: Parameters<typeof real.lastResort>) => {
      const result = real.lastResort(...args);
      const left = lastResortLeaves();
      return left
        ? { ...result, blocking: [...result.blocking, ...left] }
        : result;
    },
  };
});

/* The last stand, likewise: the planner refuses only what it leaves. */
const lastStandLeaves = vi.fn((): unknown[] | null => null);
vi.mock("./last-stand", async (importOriginal) => {
  const real = await importOriginal<typeof import("./last-stand")>();
  return {
    ...real,
    lastStand: (...args: Parameters<typeof real.lastStand>) => {
      const result = real.lastStand(...args);
      const left = lastStandLeaves();
      return left
        ? { ...result, blocking: [...result.blocking, ...left] }
        : result;
    },
  };
});

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { auditFlags } from "./audit";
import type { PlannedSequence } from "./contract";
import { subheadlineGrammar } from "./faults";
import { CAFE_BRIEF } from "./fixtures";
import {
  MAX_MODEL_CALLS,
  planSequence,
  SequenceShipRefusedError,
} from "./plan";
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
const isAudit = (o: unknown) =>
  promptOf(o).includes("report what you find. Rewrite nothing.");
const isPick = (o: unknown) => promptOf(o).includes("You are the editor.");
const isSecondDraft = (o: unknown) =>
  promptOf(o).includes("You are the second writer");

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
  title = "",
) => ({ title, headline, subheadline, footerLines, backgroundPrompt: "" });

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
  audit?: unknown;
  fixes?: unknown[];
};

/* The audit finds nothing and keeps every spare point. */
const AUDIT = {
  repeats: [],
  unsourced: [],
  freshSpares: [1, 2, 3, 4, 5, 6, 7, 8],
};

/** Answers each call by what it asks for; fix calls in turn. */
function answer({
  arc = ARC,
  copy = COPY,
  audit = AUDIT,
  fixes = [],
}: Answers = {}) {
  let fix = 0;
  generateObject.mockImplementation(async (o: unknown) => {
    if (isArc(o)) return { object: arc };
    if (isCopy(o)) return { object: copy };
    if (isAudit(o)) return { object: audit };
    if (isPick(o)) return { object: { set: "A", hook: 1, why: "" } };
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
    { briefReader: reader, onBlocked: "report" },
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
      isArc(o)
        ? "arc"
        : isCopy(o)
          ? "copy"
          : isPick(o)
            ? "pick"
            : isAudit(o)
              ? "audit"
              : "fix",
    );
    expect(order.slice(0, 5)).toEqual(["arc", "copy", "copy", "pick", "audit"]);
    expect(
      generateObject.mock.calls.filter(([o]) => isSecondDraft(o)),
    ).toHaveLength(1);
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
      'its claim, the only point it makes: "Roasted in-house each week"',
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
      'its claim, the only point it makes: "Roasted in-house each week"',
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

  /* Eval tuning pass 2: the first draft missed the schema twice and the
     set threw although the second draft had come back. */
  it("delivers from the second draft when the first fails", async () => {
    answer();
    const base = generateObject.getMockImplementation();
    generateObject.mockImplementation(async (o: unknown) => {
      if (isCopy(o) && !isSecondDraft(o)) {
        throw Object.assign(new Error("no object"), {
          name: "AI_NoObjectGeneratedError",
        });
      }
      return base?.(o);
    });
    const result = await plan();
    expect(result.plan.frames).toHaveLength(4);
    expect(promptsOf(isPick)).toEqual([]);
  });

  it("fails the set only when both drafts fail", async () => {
    answer();
    const base = generateObject.getMockImplementation();
    generateObject.mockImplementation(async (o: unknown) => {
      if (isCopy(o)) throw new Error("provider down");
      return base?.(o);
    });
    await expect(plan()).rejects.toThrow("provider down");
  });

  it("makes no fix call for a set with nothing at fault", async () => {
    answer();
    const result = await plan();
    expect(promptsOf(isFix)).toEqual([]);
    expect(result.faults).toEqual([]);
    expect(result.modelCalls).toBe(6);
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
    const second = result.plan.frames[1];
    expect(second.subheadline).not.toMatch(/^is roasted/);
    expect(subheadlineGrammar(second.subheadline)).toBeNull();
    expect(promptsOf(isFix).length).toBeGreaterThan(0);
  });

  it("gives a frame whose point another frame makes a spare point in the first fix call", async () => {
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
    expect(fixes.length).toBeGreaterThanOrEqual(1);
    expect(fixes[0]).toContain(
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
    expect(result.plan.frames[1].headline).toBe("Roasted in-house each week");
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

  /* The gate named "it has a headline and nothing under it" and the set
     shipped with it anyway: a fault that must not ship is now rewritten
     from the frame's own point in code, or the set is refused. */
  it("rewrites a bare middle frame from its own point rather than ship it", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame("Roasted in-house each week"),
          ...COPY.frames.slice(2),
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[1].subheadline).not.toBe("");
    expect(result.refused).toEqual([]);
  });

  const runWith = (copy: unknown, onBlocked?: "refuse" | "report") => {
    generateObject.mockImplementation(async (o: unknown) => {
      if (isArc(o)) return { object: { ...ARC, hookAngle: "" } };
      if (isCopy(o)) return { object: copy };
      throw new Error("provider down");
    });
    return planSequence(
      {
        context: context(),
        kind: "carousel",
        frameCount: 4,
        imageSource: "none",
        image: null,
        memorySummary: "",
        recentLayouts: [],
      },
      { briefReader: reader, ...(onBlocked ? { onBlocked } : {}) },
    );
  };

  it("rewrites an announcing hook from its own point rather than ship it", async () => {
    const result = await runWith(
      {
        ...COPY,
        frames: [
          copyFrame("Cold brew is here", "Come and try it."),
          ...COPY.frames.slice(1),
        ],
      },
      "report",
    );
    expect(result.refused).toEqual([]);
    expect(result.plan.frames[0].headline).not.toMatch(/is here/);
  });

  /* The gate once named faults it then shipped. A blocking fault no
     repair clears is never shipped: it goes back to the model once, and
     what is still left is refused, or reported to the eval, which counts
     it. */
  it("asks once more, then refuses a quality fault no repair clears", async () => {
    const bare = {
      frame: 1,
      field: "subheadline",
      detail: "it has a headline and nothing under it",
      weight: 3,
    };
    lastResortLeaves.mockReturnValue([bare]);
    lastStandLeaves.mockReturnValue([bare]);
    try {
      const reported = await runWith(COPY, "report");
      expect(reported.refused).toContainEqual({
        frame: 1,
        detail: bare.detail,
      });
      const fixes = generateObject.mock.calls.filter(([o]) => isFix(o));
      expect(fixes.length).toBeGreaterThan(0);
      await expect(runWith(COPY)).rejects.toBeInstanceOf(
        SequenceShipRefusedError,
      );
    } finally {
      lastResortLeaves.mockReturnValue(null);
      lastStandLeaves.mockReturnValue(null);
    }
  });

  it("plans afresh before it refuses, and ships the first clean set", async () => {
    const bare = {
      frame: 1,
      field: "subheadline",
      detail: "it has a headline and nothing under it",
      weight: 3,
    };
    /* finish() runs the last resort twice per attempt: before and after
       the last fix call. The first attempt is left with a fault. */
    lastResortLeaves.mockReturnValueOnce([bare]).mockReturnValueOnce([bare]);
    lastStandLeaves.mockReturnValueOnce([bare]);
    reader.mockClear();
    const result = await runWith(COPY);
    expect(result.refused).toEqual([]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(result.modelCalls).toBeGreaterThan(MAX_MODEL_CALLS / 2);
  });

  it("refuses, by default, a set that still breaches after every repair", async () => {
    const breaching = { ...COPY, cta: "Get 50% off today" };
    const reported = await runWith(breaching, "report");
    expect(reported.refused.length).toBeGreaterThan(0);
    expect(reported.refused[0].detail).toContain("50");
    await expect(runWith(breaching)).rejects.toBeInstanceOf(
      SequenceShipRefusedError,
    );
  });

  it("cuts a footer line that breaches rather than refusing the set", async () => {
    const result = await runWith({
      ...COPY,
      frames: [
        ...COPY.frames.slice(0, 2),
        copyFrame(
          "Patience over shortcuts",
          "We would rather wait than rush a glass.",
          ["Voted best in Lagos 2024"],
        ),
        COPY.frames[3],
      ],
    });
    expect(result.refused).toEqual([]);
    expect(
      result.plan.frames.flatMap((f) => f.footerLines).join(" "),
    ).not.toContain("Voted best");
  });
});

describe("planSequence: the audit", () => {
  const fourFrames = {
    ...ARC,
    frames: [
      arcFrame(1, "One farm"),
      arcFrame(2, "Roasted here"),
      arcFrame(0, "Reserve yours"),
    ],
    spare: [3],
  };
  const threeCopy = {
    ...COPY,
    frames: [COPY.frames[0], COPY.frames[1], COPY.frames[3]],
  };

  it("gives a frame the audit reads as an earlier frame's point a spare point", async () => {
    answer({
      arc: fourFrames,
      copy: threeCopy,
      audit: {
        repeats: [{ frame: 2, sameAs: 1 }],
        unsourced: [],
        freshSpares: [3],
      },
    });
    await plan({ frameCount: 3 });
    const [fix] = promptsOf(isFix);
    expect(fix).toContain("makes frame 1's point");
    expect(fix).toContain(
      'NEW CLAIM: its point was another frame\'s, so it now makes this one instead: "Patience over shortcuts"',
    );
  });

  it("offers no spare point the audit reads as said already", async () => {
    answer({
      arc: fourFrames,
      copy: threeCopy,
      audit: {
        repeats: [{ frame: 2, sameAs: 1 }],
        unsourced: [],
        freshSpares: [],
      },
    });
    await plan({ frameCount: 3 });
    expect(promptsOf(isFix).join("\n")).not.toContain("NEW CLAIM");
  });

  it("cuts a sentence giving a number no source gives when no rewrite takes it out", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame(
            "Roasted in-house each week",
            "Each batch is roasted here before it is brewed. We roast 40 kilos at a time.",
          ),
          ...COPY.frames.slice(2),
        ],
      },
    });
    const result = await plan();
    expect(result.plan.frames[1].subheadline).toBe(
      "Each batch is roasted here before it is brewed.",
    );
    expect(result.invented).toEqual([]);
  });

  it("asks the fix call to take out a statement the audit reads as unsourced, and cuts it when the fix leaves it", async () => {
    answer({
      copy: {
        ...COPY,
        frames: [
          COPY.frames[0],
          copyFrame(
            "Roasted in-house each week",
            "Each batch is roasted here before it is brewed. No appointment needed for a tasting.",
          ),
          ...COPY.frames.slice(2),
        ],
      },
      audit: {
        repeats: [],
        unsourced: [{ frame: 2, text: "No appointment needed" }],
        freshSpares: [],
      },
    });
    const result = await plan();
    expect(promptsOf(isFix).join("\n")).toContain("No appointment needed");
    expect(result.plan.frames[1].subheadline).toBe(
      "Each batch is roasted here before it is brewed.",
    );
    expect(result.invented).toEqual([]);
    expect(result.faults.map((f) => f.detail).join("\n")).not.toContain(
      "No appointment needed",
    );
  });

  it("plans on code's faults alone when the audit fails", async () => {
    generateObject.mockImplementation(async (o: unknown) => {
      if (isArc(o)) return { object: ARC };
      if (isCopy(o)) return { object: COPY };
      throw new Error("provider down");
    });
    const result = await plan();
    expect(result.plan.frames).toHaveLength(4);
  });

  it("never takes the piece itself for what the brief offers", async () => {
    answer();
    const result = await planSequence(
      {
        context: context(),
        kind: "presentation",
        frameCount: 4,
        imageSource: "none",
        image: null,
        memorySummary: "",
        recentLayouts: [],
      },
      {
        onBlocked: "report",
        briefReader: async () => ({
          facts: [{ kind: "contact", text: "WhatsApp 0803 555 0142" }],
          offering: { kind: "product", phrase: "Investor deck" },
          people: [],
        }),
      },
    );
    expect(result.offering).toBeNull();
    expect(result.facts.map((f) => f.text)).not.toContain("Investor deck");
  });

  it("keeps an offering that only mentions a piece's word", async () => {
    answer();
    const result = await planSequence(
      {
        context: context({
          briefText:
            "Deck chairs for patios are back. WhatsApp 0803 555 0142 to order.",
        }),
        kind: "carousel",
        frameCount: 4,
        imageSource: "none",
        image: null,
        memorySummary: "",
        recentLayouts: [],
      },
      {
        onBlocked: "report",
        briefReader: async () => ({
          facts: [{ kind: "contact", text: "WhatsApp 0803 555 0142" }],
          offering: { kind: "product", phrase: "Deck chairs for patios" },
          people: [],
        }),
      },
    );
    expect(result.offering).toBe("Deck chairs for patios");
  });
});

describe("auditFlags", () => {
  const frames = [
    { headline: "Hook", subheadline: "", footerLines: [], role: "hook" },
    {
      headline: "Fast delivery",
      subheadline: "",
      footerLines: [],
      role: "body",
    },
    {
      headline: "At your door within the hour",
      subheadline: "Free parking at the shop.",
      footerLines: [],
      role: "body",
    },
  ] as never;

  it("holds a repeat to the later frame and never the hook", () => {
    expect(
      auditFlags(
        {
          repeats: [
            { frame: 2, sameAs: 3 },
            { frame: 1, sameAs: 2 },
          ],
          unsourced: [],
        },
        frames,
        "",
      ),
    ).toEqual([
      {
        kind: "repeat",
        frame: 2,
        sameAs: 1,
        headline: "At your door within the hour",
      },
      { kind: "repeat", frame: 1, sameAs: 0, headline: "Fast delivery" },
    ]);
  });

  it("keeps an unsourced statement only where it is written and no source says it", () => {
    expect(
      auditFlags(
        {
          repeats: [],
          unsourced: [
            { frame: 3, text: "Free parking at the shop" },
            { frame: 3, text: "Something not on the frame" },
            { frame: 2, text: "Fast delivery" },
          ],
        },
        frames,
        "we promise fast delivery",
      ),
    ).toEqual([
      { kind: "unsourced", frame: 2, text: "Free parking at the shop" },
    ]);
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

  it("plans a set with no image as text-led frames in more than two compositions", async () => {
    answer();
    const result = await plan();
    expect(result.plan.frames.every((f) => !f.showsImage)).toBe(true);
    const layouts = result.plan.frames.map((f) => f.layout);
    expect(
      layouts.every((l) =>
        ["hero-center", "quote-card", "stat-highlight", "split-left"].includes(
          l,
        ),
      ),
    ).toBe(true);
    expect(new Set(layouts).size).toBeGreaterThanOrEqual(3);
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
      modelCalls: 6,
    });
    expect(trace.arc).toHaveLength(4);
    info.mockRestore();
  });
});
