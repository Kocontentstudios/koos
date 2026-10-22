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

const { paintPlate, platePrompt, storeDrawnMark } = await import("./imagery");
const { BRAND_ID, designPng, draftOf } = await import("./fixtures");

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
  checkPlateShowsProduct.mockResolvedValue({ shows: true, seen: "" });
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
    const { placed, imageCalls, check } = await paint(plateModel);
    expect(plateModel.generate).toHaveBeenCalledTimes(1);
    expect(imageCalls).toBe(1);
    expect(check).toBe("not-applicable");
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
      .mockResolvedValueOnce({ shows: false, seen: "a round strawberry tart" })
      .mockResolvedValueOnce({ shows: true, seen: "" });
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
    checkPlateShowsProduct.mockResolvedValue({
      shows: false,
      seen: "bread rolls",
    });
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

describe("platePrompt", () => {
  it("is the scene alone when the brief names no product", () => {
    expect(platePrompt(draftOf(), null).startsWith("a bakery counter")).toBe(
      true,
    );
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
