import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { CAFE_BRIEF } from "./fixtures";
import { planSequence } from "./plan";

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
const isRepair = (o: unknown) =>
  promptOf(o).includes("cannot go out as they are");

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
    subheadline: "",
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

function answer(handlers: {
  outline?: () => unknown;
  copy?: () => unknown;
  repair?: (o: unknown) => unknown;
}) {
  generateObject.mockImplementation(async (o: unknown) => {
    if (isOutline(o)) return (handlers.outline ?? (() => outline()))();
    if (isCopy(o)) return (handlers.copy ?? (() => copy()))();
    if (isRepair(o) && handlers.repair) return handlers.repair(o);
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
    expect(result.modelCalls).toBe(3);
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
      'must state, in these words: "₦2,500 a bottle"',
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
    const repairCall = generateObject.mock.calls.map(([o]) => o).find(isRepair);
    const asked = promptOf(repairCall);
    expect(asked).toContain("says what frame 1's");
    expect(asked).toContain('no frame states "WhatsApp 0803 555 0142"');
    expect(asked).not.toMatch(/^frame [123]:$/m);
    expect(asked).toContain(
      'It must still state, in these words: "our Yaba bar"',
    );
    expect(result.problems).toEqual([]);
    expect(result.repaired).toBe(true);
    expect(result.modelCalls).toBe(4);
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
      generateObject.mock.calls.map(([o]) => o).find(isRepair),
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
    expect(result.modelCalls).toBe(4);
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

  it("leaves a trace of what it did", async () => {
    answer({});
    await planSequence(input(), { briefReader: reader });
    expect(console.info).toHaveBeenCalledWith(
      "design.sequence.planned",
      expect.objectContaining({ kind: "carousel", frames: 5, modelCalls: 3 }),
    );
  });
});
