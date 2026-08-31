// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderCompositeDesign = vi.fn();

vi.mock("@/lib/design/render/composite", () => ({
  renderCompositeDesign: (input: unknown) => renderCompositeDesign(input),
}));
vi.mock("@/lib/db/queries", () => ({
  createDesignGeneration: vi.fn(),
  getBrandById: vi.fn(),
  getDesignGenerationById: vi.fn(),
  updateDesignGeneration: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  getObjectBytes: vi.fn(),
  uploadObject: vi.fn(),
  STORAGE_PREFIXES: { generated: "generated" },
  storageKeyFrom: vi.fn(),
}));

import { renderVariant } from "@/lib/jobs/run-design-generation";

/** A real PNG header, so the size comes from the file rather than a stub. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const spec = {
  aspectRatio: "1:1",
  layout: "hero-center",
  headline: "Launch week",
  subheadline: "Free delivery",
  cta: "Order now",
  palette: { background: "#000", foreground: "#fff", accent: "#f00" },
  logoPlacement: "bottom-right",
  backgroundPrompt: "a skyline",
  backgroundTreatment: "photographic",
  nativePrompt: "a launch poster",
} as never;
const context = { brand: { id: "b1" }, brandSummary: "s" } as never;

function nativeVariant(image: { bytes: Uint8Array; contentType: string }) {
  return {
    renderer: "native" as const,
    adapter: {
      id: "google",
      supportsReferenceImages: false,
      generate: vi.fn().mockResolvedValue(image),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The size the model chose is only observable in the bytes it returns. Without
 * this the native rows store null and every surface downstream — the aspect
 * box, the modal label, the download filename — falls back to a hardcoded
 * 1080, and nothing fails.
 */
describe("renderVariant native sizing", () => {
  it("reports the size the model actually produced", async () => {
    const result = await renderVariant(
      nativeVariant({ bytes: png(2048, 2048), contentType: "image/png" }),
      spec,
      context,
      null,
      [],
    );

    expect(result.width).toBe(2048);
    expect(result.height).toBe(2048);
  });

  it("carries a non-square size through unchanged", async () => {
    const result = await renderVariant(
      nativeVariant({ bytes: png(1536, 1024), contentType: "image/png" }),
      spec,
      context,
      null,
      [],
    );

    expect(result).toMatchObject({ width: 1536, height: 1024 });
  });

  /* Reporting a guess would put a wrong size in the filename and reserve the
     wrong aspect box; absent is honest, and the log line is the trace. */
  it("omits the size and says so when the bytes are unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await renderVariant(
      nativeVariant({
        bytes: new TextEncoder().encode("not a png at all......."),
        contentType: "image/jpeg",
      }),
      spec,
      context,
      null,
      [],
    );

    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });

  /* The composite renderer knows its own canvas; the size must come from
     there, not from re-reading the bytes it just produced. */
  it("takes the composite size from the renderer", async () => {
    renderCompositeDesign.mockResolvedValue({
      bytes: png(1, 1),
      width: 1344,
      height: 756,
    });

    const result = await renderVariant(
      {
        renderer: "composite",
        adapter: {
          id: "bedrock-stability",
          generate: vi.fn().mockRejectedValue(new Error("plate down")),
        },
      } as never,
      spec,
      context,
      null,
      [],
    );

    expect(result).toMatchObject({ width: 1344, height: 756 });
  });
});
