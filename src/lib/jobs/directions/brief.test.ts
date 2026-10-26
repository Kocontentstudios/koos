// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const {
  applyFits,
  draftDirections,
  plausibleProduct,
  fitRequests,
  nameOffering,
  namesOffering,
  ART_DIRECTOR_IMAGE_MAX_BYTES,
} = await import("./brief");
const { factLedger } = await import("./claims");
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

/* The claim check is its own model call (claim-check.ts); these tests count
   the art director's, so it finds nothing unless a test says otherwise. */
const claimChecker = vi.fn(async () => [] as never[]);
const footerRepeatChecker = vi.fn(async () => [] as never[]);
/* The brief reader too (brief-read.ts): its own call, counted in
   modelCalls, tested in brief-read.test.ts. */
const briefReader = vi.fn(async () => ({
  facts: [],
  offering: null,
  people: [],
}));

function input(over: Record<string, unknown> = {}) {
  return {
    context: directionsContext(),
    imageSource: "ko" as const,
    image: null,
    lenses,
    recentLayouts: [],
    claimChecker,
    briefReader,
    footerRepeatChecker,
    footerRewriter: async () => [],
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
    /* The art director's call, the brief reader's and the claim check's. */
    expect(result.modelCalls).toBe(3);
    expect(claimChecker).toHaveBeenCalledTimes(1);
    expect(result.directions).toHaveLength(2);
    for (const direction of result.directions) {
      expect(directionSpecSchema.safeParse(direction).success).toBe(true);
    }
  });

  it("repairs a stringified directions array instead of failing the job", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    await draftDirections(input());
    const repair = (
      generateObject.mock.calls[0][0] as {
        experimental_repairText: (o: { text: string }) => Promise<string>;
      }
    ).experimental_repairText;
    const fixed = await repair({
      text: JSON.stringify({
        directions: JSON.stringify([draftOf(), draftOf()]),
      }),
    });
    expect(JSON.parse(fixed).directions).toHaveLength(2);
  });

  /* Round-2 code critic: a regenerate asks for one direction while showing
     the model two, and an answer with both failed the whole job. */
  it("keeps the first direction when a regenerate answers with more", async () => {
    generateObject.mockResolvedValue(answer(draftOf()));
    await draftDirections(input({ lenses: [lenses[0]] }));
    const repair = (
      generateObject.mock.calls[0][0] as {
        experimental_repairText: (o: { text: string }) => Promise<string>;
      }
    ).experimental_repairText;
    const fixed = await repair({
      text: JSON.stringify({ directions: [draftOf(), contrastingDraft()] }),
    });
    expect(JSON.parse(fixed).directions).toHaveLength(1);
    expect(JSON.parse(fixed).directions[0].headline).toBe(draftOf().headline);
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
      headline: "Almond croissants, for every commute",
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
    expect(result.modelCalls).toBe(4);
    expect(result.directions[1].title).toBe("Morning bake");
  });

  /* Round-6 eval, cafe: the redraft came back with the same headline, and
     the pair shipped as near-duplicates. */
  it("gives a headline the redraft could not move the brief's title", async () => {
    const first = draftOf();
    const twin = contrastingDraft({ headline: first.headline });
    generateObject
      .mockResolvedValueOnce(answer(first, twin))
      .mockResolvedValueOnce(answer(twin));
    const result = await draftDirections(input());
    expect(result.directions[1].headline).toBe("Croissant launch");
    expect(result.overlap?.headline ?? 1).toBeLessThan(0.5);
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

  describe("the fit pass", () => {
    const overlong = draftOf({
      headline: "Seven minutes from your door",
      cta: "Pre-order your almond croissants today before they go",
    });
    const fitPrompt = (i: number) =>
      (generateObject.mock.calls[i][0] as { prompt: string }).prompt;

    it("asks once for every field that cannot be drawn, and applies the rewrites", async () => {
      generateObject
        .mockResolvedValueOnce(answer(overlong, contrastingDraft()))
        .mockResolvedValueOnce({
          object: {
            fixes: [
              { id: "0.headline", text: "Almond croissants for the commute" },
              { id: "0.cta", text: "Order for pickup" },
            ],
          },
        });
      const result = await draftDirections(input());
      expect(generateObject).toHaveBeenCalledTimes(2);
      expect(fitPrompt(1)).toContain('id "0.headline"');
      expect(fitPrompt(1)).toContain("states Seven");
      expect(fitPrompt(1)).toContain('id "0.cta"');
      expect(result.fit).toEqual({ asked: 2, fixed: 2 });
      expect(result.directions[0].headline).toBe(
        "Almond croissants for the commute",
      );
      expect(result.directions[0].cta).toBe("Order for pickup");
      /* The eval scores the model's own answer, not the rewrite. */
      expect(result.drafts[0].cta).toBe(overlong.cta);
      expect(result.modelCalls).toBe(4);
    });

    it("ignores a rewrite that still breaks a rule, and never cuts a clause", async () => {
      generateObject
        .mockResolvedValueOnce(answer(overlong, contrastingDraft()))
        .mockResolvedValueOnce({
          object: {
            fixes: [
              { id: "0.headline", text: "Seven minutes away, every morning" },
              { id: "0.cta", text: "Pre-order your almond croissants today" },
            ],
          },
        });
      const result = await draftDirections(input());
      expect(result.fit).toEqual({ asked: 2, fixed: 0 });
      expect(result.directions[0].headline).toBe("Croissant launch");
      expect(result.directions[0].cta).toBeUndefined();
    });

    it("settles the design as written when the fit call fails", async () => {
      generateObject
        .mockResolvedValueOnce(answer(overlong, contrastingDraft()))
        .mockRejectedValueOnce(new Error("throttled"));
      const result = await draftDirections(input());
      expect(result.directions).toHaveLength(2);
      for (const direction of result.directions) {
        expect(directionSpecSchema.safeParse(direction).success).toBe(true);
      }
    });

    it("rewrites a reason that claims a position or invents a fact", async () => {
      generateObject
        .mockResolvedValueOnce(
          answer(
            draftOf({
              rationale: [
                "The croissant fills two-thirds of the frame",
                "Leads with the croissant, the product commuters queue for",
              ],
            }),
            contrastingDraft(),
          ),
        )
        .mockResolvedValueOnce({
          object: {
            fixes: [
              {
                id: "0.rationale.0",
                text: "The headline names the almond croissants",
              },
            ],
          },
        });
      const result = await draftDirections(input());
      expect(fitPrompt(1)).toContain('id "0.rationale.0"');
      expect(result.directions[0].rationale).toContain(
        "The headline names the almond croissants",
      );
    });
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
        headline: "Your weekend table is waiting",
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
            subheadline: "A box of pastries, one ribbon",
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
              title: "Weekend table",
              headline: "Your weekend table is waiting",
            }),
          ),
        )
        .mockResolvedValueOnce(
          answer(
            draftOf({
              layout: "banner-bottom",
              title: "Almond gift box",
              headline: "Give a box of almond joy",
              subheadline: "A box of pastries, one ribbon",
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

/* Round-3 live critic: "Still Warm at 7am", "gone by morning" and a
   "[REGISTRATION LINK]" placeholder were delivered; the pattern checks
   read zero. */
describe("the claim check", () => {
  it("replaces a flagged field with a rewrite that passes every check", async () => {
    generateObject.mockResolvedValue(
      answer(
        draftOf({ headline: "Just show up for almond croissants" }),
        contrastingDraft(),
      ),
    );
    const checker = vi.fn(async () => [
      {
        id: "0.headline",
        statement: "Just show up",
        rewrite: "Almond croissants before work",
      },
    ]);
    const result = await draftDirections(input({ claimChecker: checker }));
    expect(result.directions[0].headline).toBe("Almond croissants before work");
    expect(result.claimCheck).toMatchObject({
      available: true,
      flagged: 1,
      rewritten: 1,
      dropped: 0,
    });
    const fields = (
      checker.mock.calls[0] as unknown as [{ fields: { id: string }[] }]
    )[0].fields;
    expect(fields.map((f) => f.id)).toEqual(
      expect.arrayContaining(["0.headline", "1.headline", "0.rationale.0"]),
    );
  });

  it("leaves off a field whose rewrite still fails, and keeps two reasons", async () => {
    generateObject.mockResolvedValue(
      answer(
        draftOf({ subheadline: "Come early and beat the queue" }),
        contrastingDraft(),
      ),
    );
    const result = await draftDirections(
      input({
        claimChecker: async () => [
          {
            id: "0.subheadline",
            statement: "beat the queue",
            rewrite: "Free delivery before they are gone",
          },
          { id: "0.rationale.0", statement: "croissant", rewrite: "" },
          { id: "0.rationale.1", statement: "croissant", rewrite: "" },
        ],
      }),
    );
    expect(result.directions[0].subheadline).toBeUndefined();
    expect(result.directions[0].rationale.length).toBeGreaterThanOrEqual(2);
    expect(result.claimCheck).toMatchObject({ flagged: 3, dropped: 3 });
  });

  it("delivers on the pattern checks when the claim check is unavailable", async () => {
    generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
    const result = await draftDirections(
      input({ claimChecker: async () => null }),
    );
    expect(result.directions).toHaveLength(2);
    expect(result.claimCheck.available).toBe(false);
  });
});

describe("an answer off the schema", () => {
  it("is asked for once more before the job fails", async () => {
    const offSchema = Object.assign(new Error("No object generated"), {
      name: "AI_NoObjectGeneratedError",
      text: "{}",
    });
    generateObject
      .mockRejectedValueOnce(offSchema)
      .mockResolvedValue(answer(draftOf(), contrastingDraft()));
    const result = await draftDirections(input());
    expect(result.directions).toHaveLength(2);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("does not retry any other failure", async () => {
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    await expect(draftDirections(input())).rejects.toThrow("throttled");
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});

/* Round-4 live run: with no brief title, a refused headline fell back to
   the concept's name ("Origin voice") and was drawn as the headline. */
it("falls back from a refused headline to the product, never the concept title", async () => {
  generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
  const result = await draftDirections(
    input({
      context: directionsContext({ title: "" }),
      claimChecker: async () => [
        { id: "0.headline", statement: "x", rewrite: "Seven minutes away" },
      ],
    }),
  );
  expect(result.directions[0].headline).toBe("Almond croissants");
  expect(result.directions[0].headline).not.toBe(result.directions[0].title);
});

it("never rewrites a headline into its sibling's", async () => {
  generateObject.mockResolvedValue(answer(draftOf(), contrastingDraft()));
  const result = await draftDirections(
    input({
      claimChecker: async () => [
        {
          id: "1.headline",
          statement: "x",
          rewrite: "Almond croissants for the commute",
        },
      ],
    }),
  );
  expect(result.directions[1].headline).not.toBe(result.directions[0].headline);
});

/* Round-4 live critic: the product's name was dumped into the footer of a
   direction that never said it; round 5 asks the fit pass instead. */
describe("naming what the brief promotes", () => {
  const checks = {
    ledger: factLedger(["Handmade stoneware cups, ₦9,500 each."]),
    briefText: "Handmade stoneware cups, ₦9,500 each.",
    title: "Cups",
  };
  const draft = draftOf({
    headline: "Take one home",
    subheadline: "Glazed by hand in Yaba",
    cta: "Ask at the bar",
  });

  it("asks the subheadline to name it when no copy does", () => {
    expect(namesOffering(draft, "stoneware cups")).toBe(false);
    const requests = fitRequests([draft], checks, "stoneware cups");
    expect(requests).toContainEqual(
      expect.objectContaining({
        id: "0.subheadline",
        problems: [
          'does not name what the brief promotes; name it as "stoneware cups"',
        ],
      }),
    );
  });

  it("keeps only a rewrite that names it", () => {
    const requests = fitRequests([draft], checks, "stoneware cups");
    const refused = applyFits(
      [draft],
      requests,
      [{ id: "0.subheadline", text: "Glazed by hand, made to keep" }],
      checks,
      "stoneware cups",
    );
    expect(refused.fixed).toBe(0);
    const kept = applyFits(
      [draft],
      requests,
      [{ id: "0.subheadline", text: "Stoneware cups glazed by hand" }],
      checks,
      "stoneware cups",
    );
    expect(kept.drafts[0].subheadline).toBe("Stoneware cups glazed by hand");
  });

  it("asks nothing of a direction that names it", () => {
    expect(
      fitRequests(
        [draftOf({ headline: "Stoneware cups are in" })],
        checks,
        "stoneware cups",
      ).filter((r) => r.problems.some((p) => p.startsWith("does not name"))),
    ).toEqual([]);
  });
});

/* Round-5 code critic (rerun-r4-product.log): with the reader down, the
   model's names fell back to a shop, an offer, a possessive and a colour,
   each painted and checked as the product. */
describe("plausibleProduct", () => {
  it.each([
    "Ikeja salon",
    "Free cookie",
    "bakery's",
    "black leather",
    "Our shop",
  ])("refuses %s", (name) => {
    expect(plausibleProduct(name)).toBe(false);
  });

  it.each(["Leather bag", "Oat latte", "Doughnut box", "chin chin"])(
    "keeps %s",
    (name) => {
      expect(plausibleProduct(name)).toBe(true);
    },
  );
});

/* Round-6 eval, textile-launch-ko direction 1: "Twelve autumn pieces" and
   never the aso-oke collection. */
describe("nameOffering", () => {
  const checks = {
    ledger: factLedger([
      "Launch our autumn aso-oke collection: twelve new throws and cushions.",
    ]),
    briefText:
      "Launch our autumn aso-oke collection: twelve new throws and cushions.",
    title: "",
  };
  const read = {
    offering: { kind: "product" as const, phrase: "autumn aso-oke collection" },
  };

  it("leads the subheadline with the offering when the copy never names it", () => {
    const out = nameOffering(
      {
        headline: "One artisan. Every piece.",
        subheadline: "Twelve new throws and cushions.",
        cta: "Discover",
      },
      read,
      checks,
    );
    expect(out.subheadline).toBe(
      "Autumn aso-oke collection: Twelve new throws and cushions.",
    );
  });

  it("leaves a direction that names it alone", () => {
    const d = {
      headline: "The autumn aso-oke collection",
      subheadline: "Twelve new throws.",
    };
    expect(nameOffering(d, read, checks)).toBe(d);
  });
});

/* Round-6 eval, recruitment-ko: the claim check set one headline to the
   brief's title, which the other already was in all but one word. */
describe("headlines kept apart after the claim check", () => {
  it("moves the subheadline's first sentence up when the title is taken", async () => {
    const first = draftOf({ headline: "Almond bakers wanted in Lekki" });
    const twin = contrastingDraft({
      headline: "Almond bakers wanted",
      subheadline: "Early starts in Lekki. Apply on WhatsApp.",
    });
    generateObject.mockResolvedValue(answer(first, twin));
    const result = await draftDirections(
      input({
        context: directionsContext({
          title: "Almond bakers wanted",
          briefText:
            "Almond bakers wanted for early starts in Lekki. Apply on WhatsApp.",
        }),
      }),
    );
    expect(result.directions[1].headline).toBe("Early starts in Lekki");
    expect(result.directions[1].subheadline).toBe("Apply on WhatsApp.");
  });
});

describe("buttons kept apart", () => {
  /* Round-6 eval, conference-ko: short copy with "Register Free" on both
     buttons read as one direction twice. */
  it("drops the later of two identical buttons when that separates the pair", async () => {
    const first = draftOf({
      headline: "Croissant mornings",
      subheadline: undefined,
      cta: "Reserve a tray",
      footerLines: [],
    });
    const twin = contrastingDraft({
      headline: "Croissant weekends",
      subheadline: undefined,
      cta: "Reserve a tray",
      footerLines: [],
    });
    generateObject.mockResolvedValue(answer(first, twin));
    const result = await draftDirections(
      input({
        context: directionsContext({
          briefText: "Promote our almond croissants.",
        }),
      }),
    );
    expect(result.directions[0].cta).toBe("Reserve a tray");
    expect(result.directions[1].cta).toBeUndefined();
    expect(result.overlap?.copy ?? 1).toBeLessThan(0.45);
  });
});

describe("headlines kept apart, either direction", () => {
  /* Round-6 eval, masterclass-ko: "Latte Art Masterclass" beside "Learn
     Latte Art"; only the earlier direction could move. */
  it("moves the earlier direction's headline when the later cannot move", async () => {
    const first = draftOf({
      headline: "Almond croissant mornings",
      subheadline: "Pickup from 7am in Lekki",
    });
    const twin = contrastingDraft({
      headline: "Almond croissant weekends",
      subheadline: undefined,
    });
    generateObject.mockResolvedValue(answer(first, twin));
    const result = await draftDirections(
      input({
        context: directionsContext({
          title: "Almond croissant weekends",
          briefText:
            "Promote our almond croissant mornings and weekends. Pickup from 7am in Lekki.",
        }),
      }),
    );
    expect(result.overlap?.headline ?? 1).toBeLessThan(0.5);
  });
});

describe("footer detail merged up", () => {
  it("carries a footer item's detail into the subheadline and records it", async () => {
    const first = draftOf({
      headline: "Almond croissants",
      subheadline: "Pickup from 7am.",
      footerLines: ["Saturdays from 7am"],
      footerStyle: "text",
    });
    generateObject.mockResolvedValue(answer(first, contrastingDraft()));
    briefReader.mockResolvedValueOnce({
      facts: [{ kind: "day", text: "Saturdays" }] as never[],
      offering: null,
      people: [],
    });
    const result = await draftDirections(
      input({
        context: directionsContext({
          briefText: "Almond croissants, pickup from 7am on Saturdays.",
        }),
        footerRepeatChecker: async () => [
          {
            id: "0.0",
            repeats: "the pickup time",
            field: "subheadline" as const,
            rewrite: "Pickup from 7am on Saturdays.",
          },
        ],
      }),
    );
    expect(result.directions[0].subheadline).toBe(
      "Pickup from 7am on Saturdays.",
    );
    expect(result.directions[0].footerLines).toEqual([]);
    expect(result.footerRepeats.outcomes).toEqual([
      expect.objectContaining({
        dropped: true,
        merged: expect.objectContaining({ field: "subheadline" }),
      }),
    ]);
  });
});

describe("every marked footer item that carries a fact gets a merge attempt", () => {
  it("asks again for a rewrite the first answer left out, and merges it", async () => {
    const first = draftOf({
      headline: "Almond croissants",
      subheadline: "Pickup from 7am.",
      footerLines: ["Saturdays from 7am"],
      footerStyle: "text",
    });
    generateObject.mockResolvedValue(answer(first, contrastingDraft()));
    briefReader.mockResolvedValueOnce({
      facts: [{ kind: "day", text: "Saturdays" }] as never[],
      offering: null,
      people: [],
    });
    const footerRewriter = vi.fn(async () => [
      {
        id: "0.0",
        field: "subheadline" as const,
        rewrite: "Pickup from 7am on Saturdays.",
      },
    ]);
    const result = await draftDirections(
      input({
        context: directionsContext({
          briefText: "Almond croissants, pickup from 7am on Saturdays.",
        }),
        footerRepeatChecker: async () => [
          { id: "0.0", repeats: "the pickup time" },
        ],
        footerRewriter,
      }),
    );
    expect(footerRewriter).toHaveBeenCalledWith(expect.anything(), [
      { id: "0.0", item: "Saturdays from 7am" },
    ]);
    expect(result.directions[0].subheadline).toBe(
      "Pickup from 7am on Saturdays.",
    );
    expect(result.footerRepeats.outcomes[0]).toMatchObject({
      dropped: true,
      merged: { field: "subheadline" },
    });
  });
});
