import { describe, expect, it } from "vitest";
import { DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import { repairSequenceFor, repairSequenceText } from "./repair";
import {
  ANGLE_MAX,
  arcResponseSchema,
  copyResponseSchema,
  rewriteResponseSchema,
} from "./schema";

const arcFrame = (over: Record<string, unknown> = {}) => ({
  point: 1,
  title: "A point",
  layout: "hero-center",
  showsImage: false,
  ...over,
});

const arcAnswer = (over: Record<string, unknown> = {}) => ({
  palette: { background: "#111111", foreground: "#FFFFFF", accent: "#D9822B" },
  logoPlacement: "top-left",
  logoFree: false,
  logoFreeQuote: "",
  backgroundTreatment: "solid",
  footerStyle: "none",
  hookAngle: "One visit and the bike is safe again",
  kinds: ["how-it-works", "proof"],
  sameAs: [],
  frames: [
    arcFrame({ point: 1 }),
    arcFrame({ point: 2 }),
    arcFrame({ point: 0 }),
  ],
  spare: [],
  ...over,
});

const copyFrame = (headline: string) => ({
  title: "",
  headline,
  subheadline: "",
  footerLines: [],
  backgroundPrompt: "",
});

async function repaired(value: unknown, count?: number): Promise<unknown> {
  const text = await repairSequenceText({
    text: JSON.stringify(value),
    count,
  });
  return text === null ? null : JSON.parse(text);
}

describe("repairSequenceText", () => {
  it("unquotes enums the model quoted twice, and the empty logo quote", async () => {
    const answer = arcAnswer({
      logoPlacement: '"top-left"',
      backgroundTreatment: '"solid"',
      footerStyle: '"none"',
      logoFreeQuote: '""',
      frames: [
        arcFrame({ point: "1", layout: '"hero-center"' }),
        arcFrame({ point: 2 }),
        arcFrame({ point: 0 }),
      ],
    });
    expect(arcResponseSchema(3).safeParse(answer).success).toBe(false);
    const fixed = await repaired(answer, 3);
    expect(arcResponseSchema(3).safeParse(fixed).success).toBe(true);
    expect(fixed).toMatchObject({
      logoPlacement: "top-left",
      logoFreeQuote: "",
      frames: [{ point: 1, layout: "hero-center" }, {}, {}],
    });
  });

  it("parses frames sent as a JSON string, and string booleans", async () => {
    const answer = arcAnswer({
      logoFree: "false",
      frames: JSON.stringify([
        arcFrame({ showsImage: "true" }),
        arcFrame({ point: 2 }),
        arcFrame({ point: 0 }),
      ]),
    });
    const fixed = await repaired(answer, 3);
    const parsed = arcResponseSchema(3).safeParse(fixed);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.frames[0]).toMatchObject({ showsImage: true });
  });

  it("never unquotes copy: a headline in quotation marks keeps them", async () => {
    const fixed = (await repaired(
      {
        frames: [copyFrame('"Worth the wait"'), copyFrame("B"), copyFrame("C")],
        cta: '"Book now"',
      },
      3,
    )) as { frames: { headline: string }[]; cta: string } | null;
    expect(fixed).toBeNull();
  });

  it("shortens a field past its parse limit at a word boundary, for the fault check to name", async () => {
    const long = `${"word ".repeat(40)}end`;
    const fixed = (await repaired(
      {
        frames: [copyFrame(long), copyFrame("B"), copyFrame("C")],
        cta: "Book now",
        otherHooks: [],
      },
      3,
    )) as { frames: { headline: string }[] };
    const headline = fixed.frames[0].headline;
    expect(headline.length).toBeLessThanOrEqual(DRAFT_LIMITS.headline);
    expect(headline.endsWith("word")).toBe(true);
    expect(copyResponseSchema(3).safeParse(fixed).success).toBe(true);
  });

  it("keeps the first frames and the last when one too many came", async () => {
    const fixed = (await repaired(
      {
        frames: [
          copyFrame("Hook"),
          copyFrame("Point"),
          copyFrame("Point again"),
          copyFrame("Act"),
        ],
        cta: "Book now",
        otherHooks: [],
      },
      3,
    )) as { frames: { headline: string }[] };
    expect(fixed.frames.map((f) => f.headline)).toEqual([
      "Hook",
      "Point",
      "Act",
    ]);
    expect(copyResponseSchema(3).safeParse(fixed).success).toBe(true);
  });

  it("leaves too few frames to fail: a missing frame is not invented", async () => {
    const answer = {
      frames: [copyFrame("Hook"), copyFrame("Act")],
      cta: "Book now",
    };
    expect(await repaired(answer, 3)).toBeNull();
  });

  it("leaves a rewrite's frames uncounted", async () => {
    const fixed = (await repairSequenceFor()({
      text: JSON.stringify({
        frames: JSON.stringify([
          {
            frame: 1,
            title: "The launch",
            headline: "A",
            subheadline: "",
            footerLines: [],
            cta: "",
          },
          {
            frame: 1,
            title: "The launch",
            headline: "B",
            subheadline: "",
            footerLines: [],
            cta: "",
          },
        ]),
      }),
    })) as string;
    const parsed = rewriteResponseSchema.safeParse(JSON.parse(fixed));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.frames).toHaveLength(2);
  });

  it("gives up on text that is not JSON, and on a correct answer", async () => {
    expect(await repairSequenceText({ text: "{ truncated" })).toBeNull();
    expect(await repaired(arcAnswer(), 3)).toBeNull();
  });

  it("leaves an off-list enum to fail rather than guess one", async () => {
    const fixed = await repaired(
      arcAnswer({ logoPlacement: '"somewhere"' }),
      3,
    );
    expect(arcResponseSchema(3).safeParse(fixed).success).toBe(false);
  });
});

const without = (value: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

describe("the planner's answer schemas", () => {
  /* Bedrock compiles each optional property into a grammar union (spec.ts),
     so every field the model answers is required, with "" or [] for none. */
  it("require every field of the arc", () => {
    const arc = arcAnswer();
    expect(arcResponseSchema(3).safeParse(arc).success).toBe(true);
    for (const key of Object.keys(arc)) {
      expect(arcResponseSchema(3).safeParse(without(arc, key)).success).toBe(
        false,
      );
    }
    for (const key of Object.keys(arcFrame())) {
      const frames = arc.frames.map((f, i) => (i === 0 ? without(f, key) : f));
      expect(arcResponseSchema(3).safeParse({ ...arc, frames }).success).toBe(
        false,
      );
    }
  });

  it("names a frame of copy that came without its title as untitled, for code to name", async () => {
    const { title: _title, ...untitled } = copyFrame("Hook");
    const fixed = await repaired(
      { frames: [untitled], cta: "", otherHooks: [] },
      1,
    );
    expect(copyResponseSchema(1).safeParse(fixed).success).toBe(true);
  });

  it("require every field of the copy and of a rewrite", () => {
    const frame = copyFrame("Hook");
    const copy = { frames: [frame], cta: "", otherHooks: [] };
    expect(copyResponseSchema(1).safeParse(copy).success).toBe(true);
    for (const key of Object.keys(copy)) {
      expect(copyResponseSchema(1).safeParse(without(copy, key)).success).toBe(
        false,
      );
    }
    for (const key of Object.keys(frame)) {
      expect(
        copyResponseSchema(1).safeParse({
          ...copy,
          frames: [without(frame, key)],
        }).success,
      ).toBe(false);
    }
    const rewrite = {
      frame: 1,
      title: "The launch",
      headline: "A",
      subheadline: "",
      footerLines: [],
      cta: "",
    };
    expect(rewriteResponseSchema.safeParse({ frames: [rewrite] }).success).toBe(
      true,
    );
    for (const key of Object.keys(rewrite)) {
      expect(
        rewriteResponseSchema.safeParse({ frames: [without(rewrite, key)] })
          .success,
      ).toBe(false);
    }
  });
});

describe("repairSequenceText: the arc's own fields", () => {
  it("parses spare points, sameAs pairs and other hooks sent as strings, and shortens a long angle", async () => {
    const answer = arcAnswer({
      hookAngle: "x ".repeat(ANGLE_MAX),
      spare: "[2, 3]",
      kinds: '["\\"proof\\"", "belief"]',
      sameAs: JSON.stringify([{ a: 2, b: 3 }]),
    });
    const fixed = await repaired(answer, 3);
    const parsed = arcResponseSchema(3).safeParse(fixed);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.spare).toEqual([2, 3]);
    expect(parsed.data?.sameAs).toEqual([{ a: 2, b: 3 }]);
    expect(parsed.data?.kinds).toEqual(["proof", "belief"]);
    expect(parsed.data?.hookAngle.length).toBeLessThanOrEqual(ANGLE_MAX);
  });

  it("reads a point it cannot number as none", async () => {
    const fixed = (await repaired(
      arcAnswer({
        frames: [arcFrame({ point: "first" }), arcFrame(), arcFrame()],
      }),
      3,
    )) as { frames: { point: number }[] };
    expect(fixed.frames[0].point).toBe(0);
  });

  it("parses other hooks sent as a string", async () => {
    const fixed = await repaired(
      {
        frames: [copyFrame("Hook"), copyFrame("B"), copyFrame("C")],
        cta: "Book now",
        otherHooks: JSON.stringify([
          { headline: "Why wait?", subheadline: "" },
        ]),
      },
      3,
    );
    expect(copyResponseSchema(3).safeParse(fixed).success).toBe(true);
  });
});
