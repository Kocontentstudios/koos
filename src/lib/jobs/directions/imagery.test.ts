// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadObject = vi.fn();
vi.mock("@/lib/storage", () => ({
  uploadObject: (input: unknown) => uploadObject(input),
  STORAGE_PREFIXES: { generated: "generated" },
}));

const { paintPlate, storeDrawnMark } = await import("./imagery");
const { BRAND_ID, designPng, draftOf } = await import("./fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

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

beforeEach(() => {
  uploadObject.mockReset();
  uploadObject.mockResolvedValue(undefined);
});

describe("paintPlate", () => {
  it("makes one call and stores the plate under generated/{brand}/plates/", async () => {
    const plateModel = adapter(designPng(1024, 1280));
    const placed = await paintPlate({
      adapter: plateModel,
      spec: draftOf(),
      brandId: BRAND_ID,
    });
    expect(plateModel.generate).toHaveBeenCalledTimes(1);
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
    const placed = await paintPlate({
      adapter: adapter(JPEG),
      spec: draftOf(),
      brandId: BRAND_ID,
    });
    expect(placed?.ref.key).toMatch(/\.jpg$/);
    expect(placed?.asset.contentType).toBe("image/jpeg");
  });

  it("renders flat rather than hand satori a WEBP", async () => {
    expect(
      await paintPlate({
        adapter: adapter(WEBP),
        spec: draftOf(),
        brandId: BRAND_ID,
      }),
    ).toBeNull();
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("renders flat when the plate model fails", async () => {
    expect(
      await paintPlate({
        adapter: adapter(new Error("throttled")),
        spec: draftOf(),
        brandId: BRAND_ID,
      }),
    ).toBeNull();
  });

  it("never references a plate that could not be stored", async () => {
    uploadObject.mockRejectedValue(new Error("R2 down"));
    expect(
      await paintPlate({
        adapter: adapter(designPng(64, 64)),
        spec: draftOf(),
        brandId: BRAND_ID,
      }),
    ).toBeNull();
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
