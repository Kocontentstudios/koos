// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadObject = vi.fn();
vi.mock("@/lib/storage", () => ({
  uploadObject: (input: unknown) => uploadObject(input),
  STORAGE_PREFIXES: { generated: "generated" },
}));

const checkPlateShowsProduct = vi.fn();
vi.mock("@/lib/design/quality/plate-check", () => ({
  checkPlateShowsProduct: (input: unknown) => checkPlateShowsProduct(input),
}));

const { briefNamesPeople, paintPlate, platePrompt, storeDrawnMark } =
  await import("./imagery");
const { BRAND_ID, designPng, draftOf, verdict } = await import("./fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

const promptSent = (
  plateModel: ReturnType<typeof adapter>,
  call: number,
): string =>
  (plateModel.generate.mock.calls[call] as unknown as [{ prompt: string }])[0]
    .prompt;

function adapter(bytes: Uint8Array | Error) {
  return {
    id: "bedrock-stability" as const,
    label: "Stability",
    model: "stable-image-core",
    supportsTextRendering: false,
    supportsReferenceImages: false,
    generate: vi.fn(() =>
      bytes instanceof Error
        ? Promise.reject(bytes)
        : Promise.resolve({ bytes, contentType: "image/png" }),
    ),
  };
}

const PRODUCT = {
  name: "strawberry mille-feuille",
  look: "a rectangular slice of three puff pastry layers with cream and strawberries",
};

beforeEach(() => {
  uploadObject.mockReset();
  uploadObject.mockResolvedValue(undefined);
  checkPlateShowsProduct.mockReset();
  checkPlateShowsProduct.mockResolvedValue(verdict(true, ""));
});

describe("paintPlate", () => {
  const paint = (
    plateModel: ReturnType<typeof adapter>,
    product: typeof PRODUCT | null = null,
  ) =>
    paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      product,
      brandId: BRAND_ID,
    });

  it("makes one call and stores the plate under generated/{brand}/plates/", async () => {
    const plateModel = adapter(designPng(1024, 1280));
    const { placed, imageCalls, check } = await paint(plateModel, PRODUCT);
    expect(plateModel.generate).toHaveBeenCalledTimes(1);
    expect(imageCalls).toBe(1);
    expect(check).toBe("passed");
    expect(plateModel.generate).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: "4:5" }),
    );
    expect(placed?.ref.key).toMatch(
      new RegExp(`^generated/${BRAND_ID}/plates/[0-9a-f-]{36}\\.png$`),
    );
    expect(uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: placed?.ref.key,
        contentType: "image/png",
      }),
    );
  });

  /* Round-3 code critic P4a: a plate with no product to check it for was
     recorded "passed" after a look for lettering only. */
  it("records a plate with no product to check as unchecked, not passed", async () => {
    const { check } = await paint(adapter(designPng(1024, 1280)));
    expect(check).toBe("unchecked");
  });

  it("names a JPEG plate for what it is", async () => {
    const { placed } = await paint(adapter(JPEG));
    expect(placed?.ref.key).toMatch(/\.jpg$/);
    expect(placed?.asset.contentType).toBe("image/jpeg");
  });

  it("renders flat rather than hand satori a WEBP", async () => {
    expect((await paint(adapter(WEBP))).placed).toBeNull();
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("renders flat when the plate model fails", async () => {
    expect((await paint(adapter(new Error("throttled")))).placed).toBeNull();
  });

  it("never references a plate that could not be stored", async () => {
    uploadObject.mockRejectedValue(new Error("R2 down"));
    expect((await paint(adapter(designPng(64, 64)))).placed).toBeNull();
  });

  it("names the product first and keeps the direction's own scene", async () => {
    const plateModel = adapter(designPng(64, 64));
    await paint(plateModel, PRODUCT);
    const prompt = promptSent(plateModel, 0);
    expect(
      prompt.startsWith("A strawberry mille-feuille, clearly recognisable"),
    ).toBe(true);
    expect(prompt).toContain("a bakery counter at dawn");
    expect(prompt).toContain("No text, no letters");
  });

  /* Round-1 live critic: 3 of 4 KO plates showed no mille-feuille. */
  it("keeps a plate the check confirms shows the product", async () => {
    const result = await paint(adapter(designPng(64, 64)), PRODUCT);
    expect(checkPlateShowsProduct).toHaveBeenCalledWith(
      expect.objectContaining({ product: PRODUCT.name, look: PRODUCT.look }),
    );
    expect(result.check).toBe("passed");
    expect(result.imageCalls).toBe(1);
    expect(result.placed).not.toBeNull();
  });

  it("paints once more, naming what was wrong, when the check rejects it", async () => {
    checkPlateShowsProduct
      .mockResolvedValueOnce(verdict(false, "a round strawberry tart"))
      .mockResolvedValueOnce(verdict(true, ""));
    const plateModel = adapter(designPng(64, 64));
    const result = await paint(plateModel, PRODUCT);
    expect(plateModel.generate).toHaveBeenCalledTimes(2);
    const retry = promptSent(plateModel, 1);
    expect(retry.startsWith(PRODUCT.look)).toBe(true);
    expect(retry).toContain("a round strawberry tart instead");
    expect(result).toMatchObject({
      check: "passed-on-retry",
      imageCalls: 2,
      seen: ["a round strawberry tart"],
    });
    expect(result.placed).not.toBeNull();
    expect(uploadObject).toHaveBeenCalledTimes(1);
  });

  it("draws flat rather than over the wrong product twice", async () => {
    checkPlateShowsProduct.mockResolvedValue(verdict(false, "bread rolls"));
    const plateModel = adapter(designPng(64, 64));
    const result = await paint(plateModel, PRODUCT);
    expect(plateModel.generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      check: "failed",
      imageCalls: 2,
      placed: null,
    });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("keeps the plate, marked unchecked, when the check cannot answer", async () => {
    checkPlateShowsProduct.mockResolvedValue(null);
    const result = await paint(adapter(designPng(64, 64)), PRODUCT);
    expect(result.check).toBe("unchecked");
    expect(result.placed).not.toBeNull();
    expect(result.imageCalls).toBe(1);
  });
});

/* Round-3 live critic: the eval painted a woman as "Ada Obi". */
describe("people on a plate", () => {
  it("sees a named person in the brief", () => {
    expect(
      briefNamesPeople(
        "Announce our panel with architect Ada Obi, Friday 14 March.",
      ),
    ).toBe(true);
    expect(briefNamesPeople("Speaker: Tunde Bakare on fintech")).toBe(true);
    expect(
      briefNamesPeople("Launch our new strawberry mille-feuille, ₦4,500"),
    ).toBe(false);
  });

  it("paints no one when the brief names someone, and no stand-in otherwise", () => {
    expect(platePrompt(draftOf(), null, undefined, null, true)).toMatch(
      /No people, faces or hands/,
    );
    expect(platePrompt(draftOf(), null)).toMatch(
      /never posed as a named host, speaker or customer/,
    );
  });
});

describe("platePrompt", () => {
  it("is the scene alone when the brief names no product", () => {
    expect(platePrompt(draftOf(), null).startsWith("a bakery counter")).toBe(
      true,
    );
  });

  /* Round-2 live run: a Lagos bakery's pastry on a European street, and a
     made-up brand name on a zobo bottle. */
  it("sets the scene where the brand is and keeps packaging unlettered", () => {
    const prompt = platePrompt(draftOf(), PRODUCT, undefined, "Lekki, Lagos");
    expect(prompt).toContain("Set in Lekki, Lagos");
    expect(
      prompt.startsWith(
        `A ${PRODUCT.name}, clearly recognisable, as the subject, in Lekki, Lagos.`,
      ),
    ).toBe(true);
    expect(prompt).toContain("plain and unbranded, with no label text");
  });

  it("names lettering as what was wrong on a retry", () => {
    expect(platePrompt(draftOf(), PRODUCT, { lettering: true })).toContain(
      "painted lettering on it",
    );
  });
});

describe("paintPlate, lettering and unnamed products", () => {
  const paint = (
    plateModel: ReturnType<typeof adapter>,
    extra: Record<string, unknown> = {},
  ) =>
    paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      product: PRODUCT,
      brandId: BRAND_ID,
      ...extra,
    });

  it("paints again when the product carries made-up writing", async () => {
    checkPlateShowsProduct
      .mockResolvedValueOnce(verdict(true, "a bottle", { lettering: true }))
      .mockResolvedValueOnce(verdict(true, "a bottle"));
    const plateModel = adapter(designPng(64, 64));
    const result = await paint(plateModel);
    expect(result).toMatchObject({ check: "passed-on-retry", imageCalls: 2 });
    expect(promptSent(plateModel, 1)).toContain("painted lettering");
  });

  it("draws flat when both plates are lettered", async () => {
    checkPlateShowsProduct.mockResolvedValue(
      verdict(true, "a bottle", { lettering: true }),
    );
    const result = await paint(adapter(designPng(64, 64)));
    expect(result).toMatchObject({
      check: "failed-lettering",
      imageCalls: 2,
      placed: null,
    });
  });

  it("hands back the look at the delivered plate", async () => {
    const subject = { x: 0.2, y: 0.3, w: 0.5, h: 0.5 };
    checkPlateShowsProduct.mockResolvedValue(
      verdict(true, "a slice", { subject, items: ["a slice", "a fork"] }),
    );
    const result = await paint(adapter(designPng(64, 64)));
    expect(result.look).toMatchObject({
      subject,
      items: ["a slice", "a fork"],
    });
  });

  /* Round-2 code critic: a product the brief does not name was recorded as
     "not-applicable" with no check at all. */
  it("records a product it could not check for as unchecked", async () => {
    const plateModel = adapter(designPng(64, 64));
    const result = await paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      product: null,
      productUnchecked: true,
      brandId: BRAND_ID,
    });
    expect(result.check).toBe("unchecked");
    expect(checkPlateShowsProduct).toHaveBeenCalledWith(
      expect.objectContaining({ product: "" }),
    );
  });
});

describe("events, services and named people", () => {
  const CLASS = {
    name: "teen sourdough baking class",
    look: "",
    kind: "event" as const,
  };

  it("paints an event as a scene and checks it as one", async () => {
    const plateModel = adapter(designPng(64, 64));
    await paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      product: CLASS,
      brandId: BRAND_ID,
    });
    expect(promptSent(plateModel, 0)).toMatch(
      /^A scene from the teen sourdough baking class, recognisable as that event/,
    );
    expect(checkPlateShowsProduct).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "event" }),
    );
  });

  /* Round-4 live critic: an AI woman beside "with Ada Obi". */
  it("refuses a face when the brief names a person, and draws flat after two", async () => {
    checkPlateShowsProduct.mockResolvedValue(
      verdict(true, "a woman at a lectern", { person: true }),
    );
    const plateModel = adapter(designPng(64, 64));
    const result = await paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      product: { ...CLASS, name: "panel" },
      namesPeople: true,
      brandId: BRAND_ID,
    });
    expect(result).toMatchObject({
      check: "failed-people",
      imageCalls: 2,
      placed: null,
    });
    expect(result.seen).toEqual([
      "a woman at a lectern (a face)",
      "a woman at a lectern (a face)",
    ]);
    expect(promptSent(plateModel, 1)).toContain("painted a person's face");
  });

  it("keeps a face when nobody is named", async () => {
    checkPlateShowsProduct.mockResolvedValue(
      verdict(true, "a baker", { person: true }),
    );
    const result = await paintPlate({
      adapter: adapter(designPng(64, 64)),
      spec: draftOf(),
      product: CLASS,
      brandId: BRAND_ID,
    });
    expect(result.check).toBe("passed");
  });
});

describe("storeDrawnMark", () => {
  const logo = {
    bytes: designPng(200, 50),
    contentType: "image/png",
    darkest: 0.02,
    lightest: 0.1,
    aspect: 4,
  };

  it("stores the drawn bytes under one key per mark", async () => {
    const first = await storeDrawnMark(BRAND_ID, logo);
    const second = await storeDrawnMark(BRAND_ID, logo);
    expect(first?.ref.key).toMatch(
      new RegExp(`^generated/${BRAND_ID}/marks/[0-9a-f]{32}\\.png$`),
    );
    expect(second?.ref.key).toBe(first?.ref.key);
    expect(first?.asset.bytes).toBe(logo.bytes);
  });

  it("reports a mark it could not store as absent", async () => {
    uploadObject.mockRejectedValue(new Error("R2 down"));
    expect(await storeDrawnMark(BRAND_ID, logo)).toBeNull();
  });
});
