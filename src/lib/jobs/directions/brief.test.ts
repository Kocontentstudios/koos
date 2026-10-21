// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { draftDirections, ART_DIRECTOR_IMAGE_MAX_BYTES } = await import(
  "./brief"
);
const { planConcepts, regenerationConcept } = await import("./concepts");
const { directionSpecSchema } = await import("./schema");
const { contrastingDraft, directionsContext, draftOf } = await import(
  "./fixtures"
);

const lenses = planConcepts("food");
const PHOTO = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };

function answer(...drafts: ReturnType<typeof draftOf>[]) {
  return { object: { directions: drafts } };
}

function input(over: Record<string, unknown> = {}) {
  return {
    context: directionsContext(),
    imageSource: "ko" as const,
    image: null,
    lenses,
    category: "food" as const,
    recentLayouts: [],
    ...over,
  };
}

type Call = {
  messages: { content: { type: string; text?: string }[] }[];
  system: string;
};
const call = (i: number) => generateObject.mock.calls[i][0] as Call;
const promptOf = (i: number) => call(i).messages[0].content[0].text ?? "";

beforeEach(() => {
  generateObject.mockReset();
});

describe("draftDirections", () => {
  it("writes both directions in one model call", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    const result = await draftDirections(input());
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.modelCalls).toBe(1);
    expect(result.directions).toHaveLength(2);
    for (const direction of result.directions) {
      expect(directionSpecSchema.safeParse(direction).success).toBe(true);
    }
  });

  it("repairs a stringified directions array instead of failing the job", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    await draftDirections(input());
    const { repairDirectionsText } = await import("./repair");
    expect(
      (generateObject.mock.calls[0][0] as { experimental_repairText: unknown })
        .experimental_repairText,
    ).toBe(repairDirectionsText);
  });

  it("hands each direction its own concept and the direction rules", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    await draftDirections(input());
    expect(promptOf(0)).toContain(
      `Direction 1 concept: ${lenses[0].instruction}`,
    );
    expect(promptOf(0)).toContain(
      `Direction 2 concept: ${lenses[1].instruction}`,
    );
    expect(call(0).system).toContain("You are writing DIRECTIONS");
  });

  it("forces the second layout apart when the model repeats one", async () => {
    generateObject.mockResolvedValue(
      answer(draftOf(), contrastingDraft({ layout: "hero-center" })),
    );
    const result = await draftDirections(
      input({ recentLayouts: ["split-left"] }),
    );
    expect(result.directions.map((d) => d.layout)).toEqual([
      "hero-center",
      "banner-bottom",
    ]);
    expect(result.layoutsForced).toBe(1);
  });

  it("shows the art director the user's photograph", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    await draftDirections(input({ imageSource: "upload", image: PHOTO }));
    const content = call(0).messages[0].content;
    expect(content).toContainEqual({
      type: "image",
      image: PHOTO.bytes,
      mediaType: "image/png",
    });
    expect(promptOf(0)).toContain("The photograph is attached");
  });

  it("writes without the photograph when it is too large to send", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    await draftDirections(
      input({
        imageSource: "upload",
        image: {
          bytes: new Uint8Array(ART_DIRECTOR_IMAGE_MAX_BYTES + 1),
          contentType: "image/jpeg",
        },
      }),
    );
    expect(
      call(0).messages[0].content.some((part) => part.type === "image"),
    ).toBe(false);
    expect(promptOf(0)).toContain("The photograph is not shown to you");
  });

  it("falls back to the text brief when the provider refuses the image", async () => {
    generateObject
      .mockRejectedValueOnce(new Error("image parts not supported"))
      .mockResolvedValueOnce(answer(draftOf(), contrastingDraft()));
    const result = await draftDirections(
      input({ imageSource: "upload", image: PHOTO }),
    );
    expect(result.directions).toHaveLength(2);
    expect(
      call(1).messages[0].content.some((part) => part.type === "image"),
    ).toBe(false);
  });

  it("writes a near-duplicate again, once, and keeps the distinct redraft", async () => {
    const twin = draftOf({
      layout: "split-left",
      title: "Morning bake",
      headline: "Fresh croissants, every single morning",
    });
    const fresh = contrastingDraft();
    generateObject
      .mockResolvedValueOnce(answer(draftOf(), twin))
      .mockResolvedValueOnce(answer(fresh));
    const result = await draftDirections(input());

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toContain("same idea as one that already exists");
    expect(promptOf(1)).toContain(lenses[1].instruction);
    expect(result.redrafted).toBe(true);
    expect(result.directions[1].headline).toBe(fresh.headline);
    expect(result.overlap?.max ?? 1).toBeLessThan(0.5);
  });

  it("keeps the first draft when the redraft is no further apart", async () => {
    const twin = draftOf({ layout: "split-left", title: "Morning bake" });
    generateObject
      .mockResolvedValueOnce(answer(draftOf(), twin))
      .mockResolvedValueOnce(answer(twin));
    const result = await draftDirections(input());
    expect(result.redrafted).toBe(false);
    expect(result.modelCalls).toBe(2);
    expect(result.directions[1].title).toBe("Morning bake");
  });

  it("keeps the first draft when the redraft call fails", async () => {
    const twin = draftOf({ layout: "split-left" });
    generateObject
      .mockResolvedValueOnce(answer(draftOf(), twin))
      .mockRejectedValueOnce(new Error("throttled"));
    const result = await draftDirections(input());
    expect(result.directions).toHaveLength(2);
    expect(result.redrafted).toBe(false);
  });

  it("does not redraft two distinct directions", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    const result = await draftDirections(input());
    expect(result.redrafted).toBe(false);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  describe("regenerating one direction", () => {
    const existing = [
      {
        title: "Morning bake story",
        headline: "Fresh croissants every morning",
        subheadline: "Baked before sunrise in Lekki",
        cta: "Order for pickup",
        backgroundPrompt: "a bakery counter at dawn",
        layout: "hero-center",
      },
      {
        title: "Weekend table invitation",
        headline: "Your Saturday table is waiting",
        backgroundPrompt: "a sunlit cafe table",
        layout: "quote-card",
      },
    ];

    it("asks for one direction that avoids both existing ones", async () => {
      generateObject.mockResolvedValue(
        answer(
          draftOf({
            layout: "hero-center",
            title: "Almond gift box",
            headline: "Give a box of almond joy",
            subheadline: "Twelve pastries, one ribbon",
            cta: "Pre-order",
            backgroundPrompt: "a ribboned pastry box on linen",
          }),
        ),
      );
      const result = await draftDirections(
        input({ lenses: [regenerationConcept("food")], existing }),
      );
      expect(result.directions).toHaveLength(1);
      expect(promptOf(0)).toContain('"Morning bake story"');
      expect(promptOf(0)).toContain("Do not use the quote-card layout");
      expect(["hero-center", "quote-card"]).not.toContain(
        result.directions[0].layout,
      );
    });

    it("redrafts a replacement that copies its sibling", async () => {
      generateObject
        .mockResolvedValueOnce(
          answer(
            draftOf({
              layout: "banner-bottom",
              title: "Saturday table",
              headline: "Your Saturday table is waiting",
            }),
          ),
        )
        .mockResolvedValueOnce(
          answer(
            draftOf({
              layout: "banner-bottom",
              title: "Almond gift box",
              headline: "Give a box of almond joy",
              subheadline: "Twelve pastries, one ribbon",
              cta: "Pre-order",
              backgroundPrompt: "a ribboned pastry box on linen",
            }),
          ),
        );
      const result = await draftDirections(
        input({ lenses: [regenerationConcept("food")], existing }),
      );
      expect(result.redrafted).toBe(true);
      expect(result.directions[0].title).toBe("Almond gift box");
    });
  });
});
