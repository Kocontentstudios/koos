// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkFontBytes,
  fontExtension,
  fontRejectionMessage,
  isRenderableFont,
} from "./font-file";
import {
  buildFont,
  CORRUPT_FONTS,
  collectionWithBadOffset,
  signatureOnlyFont,
  truncatedFont,
} from "./font-fixtures";

/* KOS-V1-BUG-018. The four-byte signature says only that a file CLAIMS to be a
   font. Satori parses lazily, inside ImageResponse.arrayBuffer(), so a valid
   signature on a shredded body was accepted at upload, written to the brand,
   and then threw "RangeError: Offset is outside the bounds of the DataView"
   halfway through every design that brand ever rendered.

   The reference for these cases is satori itself, not this module's opinion:
   each fixture below was run through the real next/og renderer, and the
   verdicts here match what it does. */

describe("checkFontBytes", () => {
  it("accepts a font the renderer can actually draw with", () => {
    expect(checkFontBytes(buildFont())).toEqual({ ok: true });
  });

  it("rejects the production repro: a signature followed by zeros", () => {
    const check = checkFontBytes(signatureOnlyFont());
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/no font tables/);
  });

  it.each([0.12, 0.5, 0.99])(
    "rejects a real font truncated to %s of its length",
    (fraction) => {
      expect(checkFontBytes(truncatedFont(fraction)).ok).toBe(false);
    },
  );

  /* Named individually so a regression says WHICH corruption came back. */
  it.each(CORRUPT_FONTS.map((f) => [f.label, f.bytes] as const))(
    "rejects %s",
    (_label, bytes) => {
      expect(checkFontBytes(bytes).ok).toBe(false);
    },
  );

  /* Satori refuses every collection with "Unsupported OpenType signature
     ttcf", verified against eight real .ttc files, so the reason names the
     format rather than reporting a structural fault the user cannot act on. */
  it("rejects a TrueType collection by naming the format", () => {
    const check = checkFontBytes(collectionWithBadOffset());
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/collection/);
  });

  /* The signature is tested before the length so an 8-byte PNG is refused as
     "not a font" rather than "too short", which would send the user looking
     for a longer copy of a file that was never a font. */
  it("calls a short non-font a non-font, not a truncated font", () => {
    const check = checkFontBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).not.toMatch(/end of the file/);
  });

  it("never throws, whatever it is handed", () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([0x00]),
      new Uint8Array(3),
      Uint8Array.from({ length: 512 }, (_, i) => (i * 37) % 256),
    ]) {
      expect(() => checkFontBytes(bytes)).not.toThrow();
    }
  });

  /* getObjectBytes returns a Buffer, which is a view into a shared pool. A
     DataView built on .buffer alone reads whatever else is in that pool, so
     the same bytes would validate differently depending on what ran before. */
  it("reads only its own bytes when handed a pooled Buffer view", () => {
    const font = buildFont();
    const pool = Buffer.alloc(font.length + 128, 0xff);
    const view = pool.subarray(64, 64 + font.length);
    view.set(font);
    expect(checkFontBytes(view)).toEqual({ ok: true });
  });
});

describe("fontExtension", () => {
  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00], "ttf"],
    ["'true' TrueType", [0x74, 0x72, 0x75, 0x65], "ttf"],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f], "otf"],
  ])("stores %s as .%s", (_label, signature, ext) => {
    expect(fontExtension(buildFont({ signature }))).toBe(ext);
  });

  it.each([
    ["WOFF", [0x77, 0x4f, 0x46, 0x46]],
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["a collection", [0x74, 0x74, 0x63, 0x66]],
  ])("gives %s no extension", (_label, signature) => {
    expect(fontExtension(new Uint8Array(signature))).toBeNull();
  });

  /* One table, so the upload route and the renderer cannot disagree about
     what is acceptable — which is how .ttc came to be accepted in one and
     refused in the other. */
  it("agrees with isRenderableFont on every signature", () => {
    for (const signature of [
      [0x00, 0x01, 0x00, 0x00],
      [0x74, 0x72, 0x75, 0x65],
      [0x4f, 0x54, 0x54, 0x4f],
      [0x74, 0x74, 0x63, 0x66],
      [0x77, 0x4f, 0x46, 0x32],
    ]) {
      const bytes = new Uint8Array(signature);
      expect(fontExtension(bytes) !== null).toBe(isRenderableFont(bytes));
    }
  });
});

describe("fontRejectionMessage", () => {
  it("names the file and the reason", () => {
    const message = fontRejectionMessage("Acme Display.ttf", "it is truncated");
    expect(message).toContain("Acme Display.ttf");
    expect(message).toContain("it is truncated");
  });

  /* The name comes from the client and is echoed into the UI. */
  it("clamps a filename chosen to blow up the message", () => {
    expect(
      fontRejectionMessage("z".repeat(500), "it is bad").length,
    ).toBeLessThan(200);
  });

  it("stays a sentence when the file has no name at all", () => {
    expect(fontRejectionMessage("   ", "it is bad")).toMatch(/^That file/);
  });
});
