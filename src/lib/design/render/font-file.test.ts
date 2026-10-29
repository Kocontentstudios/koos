// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkFontBytes,
  fontExtension,
  fontRejectionMessage,
  isRenderableFont,
  MAX_GLYPH_EM,
} from "./font-file";
import {
  buildFont,
  CORRUPT_FONTS,
  collectionWithBadOffset,
  OUTLINE_GLYPH,
  signatureOnlyFont,
  truncatedFont,
} from "./font-fixtures";

/* KOS-V1-BUG-018. The four-byte signature says only that a file CLAIMS to be a
   font. Satori parses lazily, inside ImageResponse.arrayBuffer(), so a valid
   signature on a shredded body was accepted at upload, written to the brand,
   and then threw "RangeError: Offset is outside the bounds of the DataView"
   halfway through every design that brand ever rendered.

   The reference is satori itself, not this module's opinion: every fixture
   below was run through the real next/og renderer. Where they differ, this
   module is deliberately the stricter one — a handful of malformed fixtures
   (an impossible unitsPerEm, hhea/maxp disagreeing on glyph count, a loca
   entry past the end of glyf) happen to render the one string satori was
   given, and would throw on a different one. Refusing them is the safe
   direction; accepting a font satori cannot draw is not. Measured against 179
   real fonts, the strictness costs nothing: zero are rejected. */

describe("checkFontBytes", () => {
  it("accepts a font the renderer can actually draw with", () => {
    expect(checkFontBytes(buildFont())).toEqual({ ok: true });
  });

  /* Satori loops when a word-breaking line is narrower than one glyph; the
     layer renderer keeps lines MAX_GLYPH_EM wide per code point, which only
     holds for a face whose letters are no wider. */
  it("rejects a face with a letter wider than designs can wrap", () => {
    expect(checkFontBytes(buildFont({ advance: MAX_GLYPH_EM * 1000 }))).toEqual(
      { ok: true },
    );
    const check = checkFontBytes(
      buildFont({ advance: MAX_GLYPH_EM * 1000 + 1 }),
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/wider than designs/);
  });

  /* R4-1. Satori reaches glyphs no cmap range names: .notdef for a code
     point no face covers, a ligature, a glyph mapped from any plane. Each
     of these looped satori on schema-valid copy while the round-4 check,
     which walked cmap ranges below U+1D800, passed the face
     (scripts/feat-033 attack evidence, font-width.jsonl). */
  const WIDE = MAX_GLYPH_EM * 1000 + 1;
  it.each([
    [".notdef", buildFont({ advances: { 0: WIDE } })],
    [
      "a glyph no cmap maps (a ligature, or a code point past the BMP)",
      buildFont({ numGlyphs: 100, advances: { 99: WIDE } }),
    ],
    [
      "the last glyph, whose advance every later glyph reuses",
      buildFont({
        numGlyphs: 100,
        numberOfHMetrics: 100,
        advances: { 99: WIDE },
      }),
    ],
  ])("rejects a wide %s", (_label, bytes) => {
    const check = checkFontBytes(bytes);
    expect(check.ok === false && check.reason).toMatch(/wider than designs/);
  });

  describe("CFF outlines", () => {
    it("accepts a CFF face whose drawn widths match its metrics", () => {
      expect(checkFontBytes(buildFont({ cff: {} }))).toEqual({ ok: true });
      expect(
        checkFontBytes(buildFont({ cff: { nominalWidthX: 300 } })),
      ).toEqual({ ok: true });
    });

    /* opentype.js replaces a glyph's hmtx advance with its charstring width
       the first time it is drawn, so hmtx alone says nothing about a CFF
       face. The satori smoke test shows the second draw looping. */
    it("rejects a glyph that draws wider than its hmtx advance", () => {
      const check = checkFontBytes(
        buildFont({ cff: { widths: { [OUTLINE_GLYPH]: WIDE } } }),
      );
      expect(check.ok === false && check.reason).toMatch(/wider than designs/);
    });

    it("rejects a wide .notdef charstring", () => {
      expect(
        checkFontBytes(buildFont({ cff: { widths: { 0: WIDE } } })).ok,
      ).toBe(false);
    });

    it("rejects a defaultWidthX used by a glyph with no width operand", () => {
      expect(
        checkFontBytes(
          buildFont({ cff: { defaultWidthX: WIDE, widths: { 5: null } } }),
        ).ok,
      ).toBe(false);
      /* Unused: every glyph states its own width. */
      expect(
        checkFontBytes(buildFont({ cff: { defaultWidthX: WIDE } })),
      ).toEqual({ ok: true });
    });

    it("measures widths relative to nominalWidthX", () => {
      expect(
        checkFontBytes(
          buildFont({ cff: { nominalWidthX: 3000, widths: { 7: 4000 } } }),
        ),
      ).toEqual({ ok: true });
      expect(
        checkFontBytes(
          buildFont({ cff: { nominalWidthX: 3000, widths: { 7: WIDE } } }),
        ).ok,
      ).toBe(false);
    });
  });

  /* A cluster of several glyphs is measured with the kerning between them,
     so the bound holds only if a glyph plus its widest kern is within it. */
  describe("kerning", () => {
    it.each(["GPOS", "kern"] as const)(
      "rejects a %s pair that carries a glyph past the bound",
      (table) => {
        const kerned = (value: number) =>
          checkFontBytes(
            buildFont({
              advance: 2000,
              kerning: {
                table,
                left: OUTLINE_GLYPH,
                right: OUTLINE_GLYPH,
                value,
              },
            }),
          );
        expect(kerned(2000)).toEqual({ ok: true });
        expect(kerned(-3000)).toEqual({ ok: true });
        const check = kerned(2001);
        expect(check.ok === false && check.reason).toMatch(/spacing after/);
      },
    );
  });

  it("never throws on a CFF table whose programs are noise", () => {
    const font = buildFont({ cff: {} });
    const view = new DataView(font.buffer);
    const tables = view.getUint16(4);
    for (let i = 0; i < tables; i += 1) {
      const at = 12 + i * 16;
      if (String.fromCharCode(...font.subarray(at, at + 4)) !== "CFF ")
        continue;
      const offset = view.getUint32(at + 8);
      const length = view.getUint32(at + 12);
      for (let seed = 1; seed < 40; seed += 1) {
        const noisy = font.slice();
        for (let b = 40; b < length; b += 7) {
          noisy[offset + b] = (b * seed * 31) & 0xff;
        }
        expect(() => checkFontBytes(noisy)).not.toThrow();
      }
    }
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
