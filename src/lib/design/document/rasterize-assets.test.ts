// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DocumentAssetError,
  MAX_DOCUMENT_ASSET_EDGE,
  rasterizeDocument,
} from "./rasterize";
import type { DesignDocument } from "./schema";

/* The size check reads the header and refuses before anything decodes, so a
   header that claims the size is enough to prove it. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const DOC: DesignDocument = {
  version: 1,
  width: 1080,
  height: 1350,
  background: "#FFFFFF",
  elements: [],
};

const draw = (bytes: Uint8Array) =>
  rasterizeDocument({
    doc: DOC,
    assets: { "design-images/b1/a.png": { bytes, contentType: "image/png" } },
    brand: {},
  });

describe("rasterizeDocument asset sizes", () => {
  it("refuses an asset past the largest side the cost bench timed", async () => {
    await expect(
      draw(pngHeader(MAX_DOCUMENT_ASSET_EDGE + 1, 10)),
    ).rejects.toMatchObject({
      name: "DocumentAssetError",
      reason: "too_large",
    });
    await expect(
      draw(pngHeader(10, MAX_DOCUMENT_ASSET_EDGE * 2)),
    ).rejects.toBeInstanceOf(DocumentAssetError);
  });

  it("refuses bytes whose size it cannot read", async () => {
    await expect(draw(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      reason: "unreadable",
    });
  });
});
