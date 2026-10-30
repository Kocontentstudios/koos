import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { CAFE_BRIEF } from "./fixtures";
import { MAX_MODEL_CALLS, planSequence } from "./plan";
import { validateSequence } from "./validate";

type Call = {
  system: string;
  messages: {
    content: ({ type: "text"; text: string } | { type: "image" })[];
  }[];
};

const promptOf = (options: unknown): string => {
  const call = options as Call;
  const part = call.messages?.[0]?.content?.[0];
  return part && part.type === "text" ? part.text : "";
};
const isOutline = (o: unknown) =>
  promptOf(o).includes("First, lay out the arc");
const isCopy = (o: unknown) => promptOf(o).includes("Now write the copy");
const isEdit = (o: unknown) =>
  promptOf(o).includes('In "review", list every frame after frame 1');
const isChoice = (o: unknown) =>
  promptOf(o).includes("You are the editor choosing");
type Rewrites = { object: { frames: unknown[] } };
const noVersions = (): Rewrites => ({ object: { frames: [] } });

const context = (over: Record<string, unknown> = {}) =>
  directionsContext({
    title: "Cold brew launch",
    briefText: CAFE_BRIEF,
    designType: "Instagram carousel",
    brandSummary: {
      name: "Kiln Coffee",
      overview: "Coffee bar in Yaba, Lagos",
      tone: "Warm",
    },
    ...over,
  });

const reader = vi.fn(async () => ({
  facts: [
    { kind: "price", text: "₦2,500 a bottle" },
    { kind: "date", text: "Saturday 15 November" },
    { kind: "time", text: "8am to 2pm" },
    { kind: "place", text: "our Yaba bar" },
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
  footerStyle: "none",
};

/* Fact numbers are 1-based as the prompt lists them, in the brief's order:
   1 cold brew (the offering), 2 place, 3 price, 4 date, 5 time, 6 contact. */
const outline = (frames = OUTLINE_FRAMES) => ({
  object: { ...BRAND, frames },
});

const OUTLINE_FRAMES = [
  {
    beat: "promise",
    title: "The launch",
    point: "Cold brew is here",
    facts: [],
    layout: "banner-bottom",
    showsImage: false,
  },
  {
    beat: "price",
    title: "The price",
    point: "A bottle costs the price",
    facts: [3],
    layout: "banner-bottom",
    showsImage: false,
  },
  {
    beat: "when-where",
    title: "The day",
    point: "It happens one Saturday morning",
    facts: [4, 5],
    layout: "hero-center",
    showsImage: false,
  },
  {
    beat: "detail",
    title: "The place",
    point: "Where the bar is",
    facts: [2],
    layout: "split-left",
    showsImage: true,
  },
  {
    beat: "action",
    title: "Reserve",
    point: "Message to reserve",
    facts: [6],
    layout: "quote-card",
    showsImage: false,
  },
];

const copyFrames = () => [
  {
    headline: "Your Saturday, slowed down",
    subheadline: "Our cold brew, slow-steeped and poured over ice",
    footerLines: [],
    backgroundPrompt: "a bottle of cold brew on a bar",
  },
  {
    headline: "₦2,500 a bottle",
    subheadline: "Kept cold, ready at the counter",
    footerLines: [],
    backgroundPrompt: "",
  },
  {
    headline: "Saturday 15 November",
    subheadline: "8am to 2pm",
    footerLines: [],
    backgroundPrompt: "",
  },
  {
    headline: "Pour one at our Yaba bar",
    subheadline: "",
    footerLines: [],
    backgroundPrompt: "a sunlit bar counter",
  },
  {
    headline: "Reserve a bottle before Saturday",
    subheadline: "",
    footerLines: ["WhatsApp 0803 555 0142"],
    backgroundPrompt: "",
  },
];

const copy = (frames = copyFrames(), cta = "Message us") => ({
  object: { frames, cta },
});

const input = (over: Record<string, unknown> = {}) => ({
  context: context(),
  kind: "carousel" as const,
  frameCount: 5,
  imageSource: "ko" as const,
  image: null,
  memorySummary: "",
  recentLayouts: [],
  ...over,
});

/** The edit pass answers with the editor's review and every version it
 *  wrote in one call: `repair` gives the versions of the frames code
 *  listed, `hook` the hook's, `review` the frames the editor named. */
function answer(handlers: {
  outline?: () => unknown;
  copy?: (draft: number) => unknown;
  repair?: (o: unknown) => Rewrites;
  hook?: (o: unknown) => Rewrites;
  review?: { frame: number; fails: string }[];
  choice?: (o: unknown) => unknown;
}) {
  let drafts = 0;
  generateObject.mockImplementation(async (o: unknown) => {
    if (isOutline(o)) return (handlers.outline ?? (() => outline()))();
    if (isCopy(o)) {
      drafts += 1;
      return (handlers.copy ?? (() => copy()))(drafts);
    }
    if (isEdit(o)) {
      const repaired = (handlers.repair ?? noVersions)(o);
      const hooks = (handlers.hook ?? noVersions)(o);
      return {
        object: {
          review: handlers.review ?? [],
          frames: [...repaired.object.frames, ...hooks.object.frames],
        },
      };
    }
    if (isChoice(o) && handlers.choice) return handlers.choice(o);
    throw new Error(`unexpected call: ${promptOf(o).slice(0, 80)}`);
  });
}

beforeEach(() => {
  generateObject.mockReset();
  reader.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("planSequence", () => {
  it("delivers exactly the frames asked for, hook first and cta last", async () => {
    answer({});
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames).toHaveLength(5);
    expect(result.plan.frames.map((f) => f.role)).toEqual([
      "hook",
      "body",
      "body",
      "body",
      "cta",
    ]);
    expect(result.problems).toEqual([]);
    expect(result.repaired).toBe(false);
    /* Brief read, outline, two drafts (alike, so no choice), hook. */
    expect(result.modelCalls).toBe(5);
    expect(result.offering).toBe("cold brew");
    expect(result.facts.map((f) => f.text)).toEqual([
      "cold brew",
      "our Yaba bar",
      "₦2,500 a bottle",
      "Saturday 15 November",
      "8am to 2pm",
      "WhatsApp 0803 555 0142",
    ]);
  });

  it("asks for the outline before any copy, then the copy to it", async () => {
    answer({});
    await planSequence(input(), { briefReader: reader });
    const calls = generateObject.mock.calls.map(([o]) => o);
    expect(isOutline(calls[0])).toBe(true);
    expect(isCopy(calls[1])).toBe(true);
    const copyPrompt = promptOf(calls[1]);
    expect(copyPrompt).toContain(
      'must state, in these words: "WhatsApp 0803 555 0142", "₦2,500 a bottle"',
    );
    expect(copyPrompt).toContain('must state, in these words: "cold brew"');
    expect((calls[0] as Call).system).toContain(
      "The first frame earns the swipe",
    );
  });

  it("shares one palette, logo and footer system across the set", async () => {
    answer({});
    const { plan } = await planSequence(input(), { briefReader: reader });
    expect(plan.palette).toEqual(BRAND.palette);
    expect(plan.logoPlacement).toBe("top-left");
    expect(plan.footerStyle).toBe("text");
  });

  it("settles the outline in code: roles, the hook's image, layouts", async () => {
    answer({});
    const { plan } = await planSequence(input(), { briefReader: reader });
    expect(plan.frames[0].showsImage).toBe(true);
    expect(plan.frames[1].layout).not.toBe("banner-bottom");
    expect(plan.frames.slice(1).map((f) => f.cta)).toEqual([
      "",
      "",
      "",
      "Message us",
    ]);
    expect(plan.frames[0].cta).toBe("");
  });

  it("uses the context's aspect for a carousel and 16:9 for a presentation", async () => {
    answer({});
    const carousel = await planSequence(input(), { briefReader: reader });
    expect(carousel.plan.aspectRatio).toBe("4:5");
    answer({});
    const deck = await planSequence(
      input({
        kind: "presentation",
        context: context({ designType: "Pitch deck" }),
      }),
      { briefReader: reader },
    );
    expect(deck.plan.aspectRatio).toBe("16:9");
    expect(deck.plan.kind).toBe("presentation");
  });

  it("asks one repair pass for the frames that break a rule, by name", async () => {
    const broken = copyFrames();
    broken[3] = { ...broken[3], headline: "Your Saturday, slowed right down" };
    broken[4] = { ...broken[4], footerLines: [] };
    answer({
      copy: () => copy(broken),
      repair: () => ({
        object: {
          frames: [
            {
              frame: 4,
              title: "The place",
              headline: "Pour one at our Yaba bar",
              subheadline: "",
              footerLines: [],
              cta: "",
            },
            {
              frame: 5,
              title: "Reserve",
              headline: "Reserve a bottle before Saturday",
              subheadline: "",
              footerLines: ["WhatsApp 0803 555 0142"],
              cta: "Message us",
            },
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    const repairCall = generateObject.mock.calls.map(([o]) => o).find(isEdit);
    const asked = promptOf(repairCall);
    expect(asked).toContain("says what frame 1's");
    expect(asked).toContain('no frame states "WhatsApp 0803 555 0142"');
    const withProblems = asked
      .split("\n\n")
      .filter((block) => /^frame \d \(/.test(block))
      .filter((block) => block.includes("problem:"))
      .map((block) => block.slice(0, 7));
    expect(withProblems).toEqual(["frame 4", "frame 5"]);
    expect(asked).toContain('  must state, in these words: "our Yaba bar"');
    expect(result.problems).toEqual([]);
    expect(result.repaired).toBe(true);
    /* The brief read, the outline, two drafts and the one edit pass. */
    expect(result.modelCalls).toBe(5);
  });

  it("keeps the first copy where a rewrite would leave more problems, and returns what stands", async () => {
    const broken = copyFrames();
    broken[4] = { ...broken[4], footerLines: [] };
    answer({
      copy: () => copy(broken),
      repair: () => ({
        object: {
          frames: [
            {
              frame: 5,
              title: "Reserve",
              headline: "x".repeat(90),
              subheadline: "",
              footerLines: [],
              cta: "Message us",
            },
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[4].headline).toBe(
      "Reserve a bottle before Saturday",
    );
    expect(result.repaired).toBe(false);
    expect(result.problems).toEqual([
      {
        frame: null,
        rule: "fact-uncovered",
        detail: 'no frame states "WhatsApp 0803 555 0142"',
      },
    ]);
  });

  it("ignores a rewrite of a frame it did not ask about", async () => {
    const broken = copyFrames();
    broken[4] = { ...broken[4], footerLines: [] };
    answer({
      copy: () => copy(broken),
      repair: () => ({
        object: {
          frames: [
            {
              frame: 2,
              title: "The price",
              headline: "Cheap",
              subheadline: "",
              footerLines: ["WhatsApp 0803 555 0142"],
              cta: "",
            },
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[1].headline).toBe("₦2,500 a bottle");
  });

  it("asks a repair for a number the brief never gave", async () => {
    const invented = copyFrames();
    invented[1] = { ...invented[1], subheadline: "Only 40 bottles made" };
    answer({
      copy: () => copy(invented),
      repair: () => ({
        object: {
          frames: [
            {
              frame: 2,
              title: "The price",
              headline: "₦2,500 a bottle",
              subheadline: "",
              footerLines: [],
              cta: "",
            },
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    const asked = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isEdit),
    );
    expect(asked).toContain("which the brief does not give");
    expect(result.plan.frames[1].subheadline).toBe("");
  });

  it("never fixes copy in code when the repair pass fails", async () => {
    const broken = copyFrames();
    broken[0] = { ...broken[0], headline: "A".repeat(80) };
    answer({
      copy: () => copy(broken),
      repair: () => {
        throw new Error("model down");
      },
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[0].headline).toBe("A".repeat(80));
    expect(result.problems.map((p) => p.rule)).toContain("copy-length");
  });

  it("asks once more for an outline that makes one point twice", async () => {
    const twice = OUTLINE_FRAMES.map((f) => ({ ...f }));
    twice[2] = {
      ...twice[2],
      title: "The price again",
      point: "A bottle costs the price",
    };
    let asked = 0;
    answer({
      outline: () => {
        asked += 1;
        return outline(asked === 1 ? twice : OUTLINE_FRAMES);
      },
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(asked).toBe(2);
    expect(promptOf(generateObject.mock.calls[1][0])).toContain(
      "made the same point twice",
    );
    expect(result.plan.frames[2].title).toBe("The day");
  });

  it("asks again when an answer does not match the schema", async () => {
    let first = true;
    answer({
      outline: () => {
        if (first) {
          first = false;
          throw Object.assign(new Error("bad"), {
            name: "AI_NoObjectGeneratedError",
          });
        }
        return outline();
      },
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames).toHaveLength(5);
    /* The brief read, the outline twice, two drafts and the edit pass. */
    expect(result.modelCalls).toBe(6);
  });

  it("shows the planner an upload, and plans without it if the provider refuses", async () => {
    const image = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    };
    answer({});
    await planSequence(input({ imageSource: "upload", image }), {
      briefReader: reader,
    });
    const parts = (generateObject.mock.calls[0][0] as Call).messages[0].content;
    expect(parts.some((p) => p.type === "image")).toBe(true);

    generateObject.mockReset();
    let refused = false;
    generateObject.mockImplementation(async (o: unknown) => {
      const withImage = (o as Call).messages[0].content.some(
        (p) => p.type === "image",
      );
      if (withImage) {
        refused = true;
        throw new Error("image parts not supported");
      }
      return isOutline(o) ? outline() : copy();
    });
    const result = await planSequence(input({ imageSource: "upload", image }), {
      briefReader: reader,
    });
    expect(refused).toBe(true);
    expect(result.plan.frames).toHaveLength(5);
  });

  it("plans a set with no image as text-led frames", async () => {
    answer({});
    const { plan } = await planSequence(input({ imageSource: "none" }), {
      briefReader: reader,
    });
    expect(plan.frames.every((f) => !f.showsImage)).toBe(true);
    expect(
      plan.frames.every((f) =>
        ["hero-center", "stat-highlight", "quote-card"].includes(f.layout),
      ),
    ).toBe(true);
  });

  it("still plans when the brief reader is down, held to the brief's phone", async () => {
    answer({});
    const result = await planSequence(input(), {
      briefReader: async () => {
        throw new Error("down");
      },
    });
    expect(result.offering).toBeNull();
    expect(result.facts.map((f) => f.kind)).toEqual(["contact"]);
    expect(result.plan.frames).toHaveLength(5);
  });

  it("refuses a frame count no set can have", async () => {
    await expect(
      planSequence(input({ frameCount: 1 }), { briefReader: reader }),
    ).rejects.toThrow(RangeError);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("reads a venue the brief calls ours the way the directions do (round-1 probe)", async () => {
    const venueReader = vi.fn(async () => ({
      facts: [{ kind: "place", text: "our Yaba bar" }],
      offering: { kind: "product", phrase: "cold brew" },
      people: [],
    }));
    const frames = copyFrames();
    frames[3] = { ...frames[3], headline: "Find Brew Lab, Yaba" };
    answer({ copy: () => copy(frames) });
    const result = await planSequence(
      input({
        context: context({
          brandSummary: { name: "Brew Lab", overview: "Coffee bar, Lagos" },
        }),
      }),
      { briefReader: venueReader },
    );
    expect(result.problems.map((p) => p.rule)).not.toContain("fact-uncovered");
    const edit = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isEdit),
    );
    expect(edit).not.toContain("no frame states");
    expect(edit).not.toContain("problem:");
    const place = result.facts.find((f) => f.kind === "place");
    expect(place?.text).toBe("our Yaba bar");
    /* The same facts the job's drawn-copy check receives. */
    expect(
      validateSequence(result.plan, {
        frameCount: 5,
        facts: result.facts,
        offering: result.offering,
        hasImage: true,
        brandName: "Brew Lab",
      }).map((p) => p.rule),
    ).toEqual([]);
  });

  it("asks the edit pass for the hook when it still announces, and keeps the best version", async () => {
    const flat = copyFrames();
    flat[0] = {
      ...flat[0],
      headline: "Cold brew is here",
      subheadline: "Steeped slow at our bar",
    };
    answer({
      copy: () => copy(flat),
      repair: () => ({
        object: {
          frames: [
            {
              frame: 1,
              title: "The launch",
              headline: "Kiln cold brew has arrived",
              subheadline: "Steeped slow at our bar",
              footerLines: [],
              cta: "",
            },
          ],
        },
      }),
      hook: () => ({
        object: {
          frames: [
            {
              frame: 1,
              title: "The launch",
              headline: "Introducing cold brew",
              subheadline: "Steeped slow",
              footerLines: [],
              cta: "",
            },
            {
              frame: 1,
              title: "The launch",
              headline: "Your slowest Saturday yet?",
              subheadline: "Kiln's cold brew, poured over ice",
              footerLines: [],
              cta: "",
            },
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    const hookCall = generateObject.mock.calls.map(([o]) => o).find(isEdit);
    expect(promptOf(hookCall)).toContain(
      "announces the offering, which gives no reason to swipe",
    );
    expect(result.plan.frames[0].headline).toBe("Your slowest Saturday yet?");
    expect(result.plan.frames[0].role).toBe("hook");
    expect(result.faults).toEqual([]);
    expect(result.repaired).toBe(true);
    expect(result.modelCalls).toBe(5);
  });

  it("returns the hook's faults when no version fixes them, instead of hiding them", async () => {
    const flat = copyFrames();
    flat[0] = {
      ...flat[0],
      headline: "Cold brew is here",
      subheadline: "Steeped slow at our bar",
    };
    const stillFlat = () => ({
      object: {
        frames: [
          {
            frame: 1,
            title: "The launch",
            headline: "Cold brew is here",
            subheadline: "Steeped slow at our bar",
            footerLines: [],
            cta: "",
          },
        ],
      },
    });
    answer({ copy: () => copy(flat), repair: stillFlat, hook: stillFlat });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[0].headline).toBe("Cold brew is here");
    expect(result.problems).toEqual([]);
    expect(result.faults).toEqual([
      {
        frame: 0,
        detail: expect.stringContaining("announces the offering"),
      },
    ]);
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({
        hookAsked: [expect.stringContaining("announces the offering")],
        hook: expect.objectContaining({ index: 0, by: "code" }),
      }),
    );
  });

  it("keeps a hook no version beats, and asks the editor only between versions code cannot tell apart", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const hookVersion = (headline: string, subheadline: string) => ({
      frame: 1,
      title: "A longer title the model gave this version",
      headline,
      subheadline,
      footerLines: [],
      cta: "",
    });
    answer({
      hook: () => ({
        object: {
          frames: [
            hookVersion("Cold brew is here", "Kiln's cold brew"),
            hookVersion(
              "Slow mornings, cold glasses",
              "Kiln's cold brew, over ice",
            ),
          ],
        },
      }),
      choice: () => ({ object: { choice: 2, why: "It pulls harder." } }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    const choiceCall = generateObject.mock.calls.map(([o]) => o).find(isChoice);
    const shown = promptOf(choiceCall);
    expect(shown).toContain('1. headline "Your Saturday, slowed down"');
    expect(shown).toContain('2. headline "Slow mornings, cold glasses"');
    expect(shown).not.toContain("Cold brew is here");
    expect(result.plan.frames[0].headline).toBe("Slow mornings, cold glasses");
    expect(result.plan.frames[0].title).toBe("The launch");
    expect(result.faults).toEqual([]);
  });

  it("goes on with the draft that breaks fewer rules, with no editor call", async () => {
    const broken = copyFrames();
    broken[4] = { ...broken[4], footerLines: [] };
    answer({ copy: (draft) => (draft === 1 ? copy(broken) : copy()) });
    const result = await planSequence(input(), { briefReader: reader });
    expect(generateObject.mock.calls.map(([o]) => o).some(isChoice)).toBe(
      false,
    );
    expect(result.plan.frames[4].footerLines).toEqual([
      "WhatsApp 0803 555 0142",
    ]);
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({
        draft: expect.objectContaining({ index: 1, by: "code" }),
      }),
    );
  });

  it("asks the editor between clean drafts and maps its pick back through the shuffle", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const second = copyFrames();
    second[4] = { ...second[4], headline: "Hold a bottle for yourself" };
    answer({
      copy: (draft) => (draft === 1 ? copy() : copy(second)),
      choice: () => ({ object: { choice: 1, why: "Builds better." } }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    const asked = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isChoice),
    );
    /* random 0 swaps the two, so draft 1 as shown is the second written. */
    expect(asked.indexOf("Hold a bottle for yourself")).toBeLessThan(
      asked.indexOf("Draft 2:"),
    );
    expect(result.plan.frames[4].headline).toBe("Hold a bottle for yourself");
  });

  it("plans from the one draft that came back when the other call fails", async () => {
    answer({
      copy: (draft) => {
        if (draft === 1) throw new Error("model down");
        return copy();
      },
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames).toHaveLength(5);
    expect(result.problems).toEqual([]);
  });

  it("plans a set through two malformed answers in a row, rescued by repairText", async () => {
    /* What the AI SDK does with an answer that fails the schema: hands the
       text to experimental_repairText and checks the schema again. */
    type Options = {
      schema: {
        safeParse: (v: unknown) => { success: boolean; data?: unknown };
      };
      experimental_repairText?: (a: {
        text: string;
        error: unknown;
      }) => Promise<string | null>;
    };
    const sdk = async (o: unknown, text: string) => {
      const options = o as Options;
      const tryParse = (t: string) => {
        try {
          return options.schema.safeParse(JSON.parse(t));
        } catch {
          return { success: false };
        }
      };
      let parsed = tryParse(text);
      if (!parsed.success && options.experimental_repairText) {
        const repaired = await options.experimental_repairText({
          text,
          error: new Error("schema"),
        });
        if (repaired) parsed = tryParse(repaired);
      }
      if (!parsed.success) {
        throw Object.assign(new Error("No object generated"), {
          name: "AI_NoObjectGeneratedError",
          text,
        });
      }
      return { object: parsed.data };
    };
    const quotedOutline = JSON.stringify({
      ...BRAND,
      logoPlacement: '"top-left"',
      footerStyle: '"none"',
      logoFreeQuote: '""',
      frames: JSON.stringify(OUTLINE_FRAMES),
    });
    const extraFrame = JSON.stringify({
      frames: [
        ...copyFrames().slice(0, 4),
        { ...copyFrames()[3], headline: "A frame too many" },
        copyFrames()[4],
      ],
      cta: "Message us",
    });
    let outlineAsks = 0;
    let copyAsks = 0;
    generateObject.mockImplementation(async (o: unknown) => {
      if (isOutline(o)) {
        outlineAsks += 1;
        return sdk(o, outlineAsks === 1 ? "{ truncated" : quotedOutline);
      }
      if (isCopy(o)) {
        copyAsks += 1;
        return sdk(o, extraFrame);
      }
      if (isEdit(o)) return { object: { review: [], frames: [] } };
      throw new Error("unexpected call");
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(outlineAsks).toBe(2);
    expect(copyAsks).toBe(2);
    expect(result.plan.frames).toHaveLength(5);
    expect(result.plan.logoPlacement).toBe("top-left");
    expect(result.plan.frames.map((f) => f.headline)).not.toContain(
      "A frame too many",
    );
    expect(result.plan.frames[4].cta).toBe("Message us");
    expect(result.problems).toEqual([]);
  });

  it("leaves a trace of what it did", async () => {
    answer({});
    await planSequence(input(), { briefReader: reader });
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({ kind: "carousel", frames: 5, modelCalls: 5 }),
    );
  });
});

describe("planSequence: the edit pass and its limits", () => {
  const rewriteOf = (frame: number, over: Record<string, unknown> = {}) => ({
    frame,
    title: "A title",
    headline: "A headline",
    subheadline: "",
    footerLines: [],
    cta: "",
    ...over,
  });

  it("folds the hook's versions into the one repair pass", async () => {
    answer({});
    const result = await planSequence(input(), { briefReader: reader });
    const calls = generateObject.mock.calls.map(([o]) => o);
    expect(calls.filter(isEdit)).toHaveLength(1);
    expect(calls).toHaveLength(4);
    expect(result.modelCalls).toBe(5);
  });

  it("never makes more than MAX_MODEL_CALLS calls, however often answers fail", async () => {
    const malformed = () => {
      throw Object.assign(new Error("bad"), {
        name: "AI_NoObjectGeneratedError",
      });
    };
    let outlines = 0;
    answer({
      outline: () => {
        outlines += 1;
        if (outlines % 2 === 1) malformed();
        /* The second outline makes a point twice, so it is asked again. */
        return outline(
          outlines === 2
            ? OUTLINE_FRAMES.map((f, i) =>
                i === 2 ? { ...f, title: "The price", beat: "price" } : f,
              )
            : OUTLINE_FRAMES,
        );
      },
      copy: (draft) => {
        if (draft <= 2) malformed();
        return copy();
      },
    });
    const result = await planSequence(input(), { briefReader: reader });
    /* The brief read, four outline asks and four draft asks spend the
       budget, so the optional edit pass is skipped rather than the wait
       growing. */
    expect(result.modelCalls).toBe(MAX_MODEL_CALLS);
    expect(generateObject.mock.calls.length + 1).toBe(MAX_MODEL_CALLS);
    expect(generateObject.mock.calls.map(([o]) => o).some(isEdit)).toBe(false);
    expect(result.plan.frames).toHaveLength(5);
  });

  it("sends a photograph the provider refused only once", async () => {
    const image = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    };
    let withImage = 0;
    generateObject.mockImplementation(async (o: unknown) => {
      if ((o as Call).messages[0].content.some((p) => p.type === "image")) {
        withImage += 1;
        throw new Error("image parts not supported");
      }
      if (isOutline(o)) return outline();
      if (isCopy(o)) return copy();
      return { object: { review: [], frames: [] } };
    });
    const result = await planSequence(input({ imageSource: "upload", image }), {
      briefReader: reader,
    });
    expect(withImage).toBe(1);
    expect(result.plan.frames).toHaveLength(5);
  });

  it("keeps a version of a frame the editor's review named when it leaves no more problems", async () => {
    answer({
      review: [{ frame: 3, fails: "says frame 1's Saturday again" }],
      repair: () => ({
        object: {
          frames: [
            rewriteOf(3, {
              title: "The day",
              headline: "Saturday 15 November",
              subheadline: "8am to 2pm, doors open",
            }),
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[2].subheadline).toBe("8am to 2pm, doors open");
    expect(result.plan.frames[2].title).toBe("The day");
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({
        review: [{ frame: 3, fails: "says frame 1's Saturday again" }],
        rewritesKept: 1,
      }),
    );
  });

  it("refuses a reviewed frame's version that breaks a rule or drops a fact", async () => {
    answer({
      review: [{ frame: 3, fails: "flat" }],
      repair: () => ({
        object: {
          frames: [rewriteOf(3, { headline: "Come early", subheadline: "" })],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[2].headline).toBe("Saturday 15 November");
    expect(result.problems).toEqual([]);
  });

  it("ignores a review of the hook or of a frame the set does not have", async () => {
    answer({
      review: [
        { frame: 1, fails: "flat" },
        { frame: 9, fails: "?" },
      ],
      repair: () => ({
        object: {
          frames: [rewriteOf(9, { headline: "Nowhere" })],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames.map((f) => f.headline)).not.toContain("Nowhere");
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({ review: [] }),
    );
  });

  it("breaks a hook tie for the version without an announcement, with no editor call", async () => {
    const flat = copyFrames();
    flat[0] = {
      ...flat[0],
      headline: "Cold brew is here",
      subheadline: "Steeped slow at our bar",
    };
    answer({
      copy: () => copy(flat),
      hook: () => ({
        object: {
          frames: [
            rewriteOf(1, {
              headline: "Cold brew, finally",
              subheadline: "Kiln's cold brew over ice",
            }),
            rewriteOf(1, {
              headline: "Why wait for Saturday?",
              subheadline: "Kiln's cold brew over ice",
            }),
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[0].headline).toBe("Why wait for Saturday?");
    expect(generateObject.mock.calls.map(([o]) => o).some(isChoice)).toBe(
      false,
    );
  });

  it("shows the hook editor the faults code found on each version", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    answer({
      hook: () => ({
        object: {
          frames: [
            rewriteOf(1, {
              headline: "Slow mornings, cold glasses",
              subheadline: "Kiln's cold brew, over ice",
            }),
          ],
        },
      }),
      choice: () => ({ object: { choice: 1, why: "It pulls." } }),
    });
    await planSequence(input(), { briefReader: reader });
    const choice = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isChoice),
    );
    expect(choice).toContain("A version with a fault listed loses");
    expect(choice).toContain("put the name in the subheadline");
  });

  it("puts a carousel's price on the action frame, and a deck's where the outline put it", async () => {
    answer({});
    await planSequence(input(), { briefReader: reader });
    const copyPrompt = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isCopy),
    );
    const blocks = copyPrompt.split("\n\n");
    expect(blocks.find((b) => b.startsWith("frame 2 ("))).not.toContain(
      "₦2,500",
    );
    expect(blocks.find((b) => b.startsWith("frame 5 ("))).toContain(
      '"₦2,500 a bottle"',
    );

    generateObject.mockReset();
    answer({});
    await planSequence(
      input({
        kind: "presentation",
        context: context({ designType: "Pitch deck" }),
      }),
      { briefReader: reader },
    );
    const deckPrompt = promptOf(
      generateObject.mock.calls.map(([o]) => o).find(isCopy),
    );
    expect(
      deckPrompt.split("\n\n").find((b) => b.startsWith("slide 2 (")),
    ).toContain('"₦2,500 a bottle"');
  });

  it("keeps the set's button when a rewrite of the action frame leaves it empty", async () => {
    const broken = copyFrames();
    broken[4] = { ...broken[4], footerLines: [] };
    answer({
      copy: () => copy(broken),
      repair: () => ({
        object: {
          frames: [
            rewriteOf(5, {
              title: "Reserve",
              headline: "Reserve a bottle before Saturday",
              footerLines: ["WhatsApp 0803 555 0142"],
              cta: "",
            }),
          ],
        },
      }),
    });
    const result = await planSequence(input(), { briefReader: reader });
    expect(result.plan.frames[4].cta).toBe("Message us");
    expect(result.problems).toEqual([]);
  });
});
