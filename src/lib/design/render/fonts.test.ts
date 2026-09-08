// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
/* Only the bucket read is mocked. storageKeyFrom is the guard these tests
   exist to exercise, so it runs for real. */
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

import { __resetFontCaches, isRenderableFont, loadBrandFonts } from "./fonts";

const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

/** A buffer that opens with a signature satori accepts. */
function fontBytes(signature: number[]) {
  const bytes = new Uint8Array(64);
  bytes.set(signature, 0);
  return Buffer.from(bytes);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
});

afterEach(() => {
  __resetFontCaches();
});

describe("isRenderableFont", () => {
  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00]],
    ["a 'true' TrueType", [0x74, 0x72, 0x75, 0x65]],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f]],
    ["a TrueType collection", [0x74, 0x74, 0x63, 0x66]],
  ])("accepts %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(true);
  });

  /* Satori rejects both with "Unsupported OpenType signature", so they must
     never reach it. */
  it.each([
    ["WOFF", [0x77, 0x4f, 0x46, 0x46]],
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["a PNG", [0x89, 0x50, 0x4e, 0x47]],
    ["nothing", [0x00, 0x00, 0x00, 0x00]],
  ])("rejects %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(false);
  });
});

/* Raised for contention, not for any single case: the slowest here is ~1.8s
   and the rest are well under a second, but they read the real vendored font
   files, so under parallel load they tip past the per-test default together.
   Wide enough to absorb that, narrow enough that a genuine hang in the font
   fetch still fails rather than hiding. */
describe("loadBrandFonts", { timeout: 12_000 }, () => {
  it("uses the built-in families when the brand has no font", async () => {
    const fonts = await loadBrandFonts();

    expect(fonts.map((f) => f.name)).toContain("Display");
    expect(fonts.map((f) => f.name)).toContain("Body");
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("substitutes the uploaded face for the display family", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x00, 0x01, 0x00, 0x00]));

    const fonts = await loadBrandFonts(FONT_URL);
    const display = fonts.filter((f) => f.name === "Display");

    expect(getObjectBytes).toHaveBeenCalledWith("fonts/u1/brand.ttf");
    expect(display).toHaveLength(1);
    // Body keeps its two weights, so the hierarchy the layouts rely on stands.
    expect(fonts.filter((f) => f.name === "Body")).toHaveLength(2);
  });

  /* A bad or missing font must cost the typeface, never the design. */
  it("falls back to the built-ins when the file is unreadable", async () => {
    getObjectBytes.mockRejectedValue(new Error("no such key"));

    const fonts = await loadBrandFonts(FONT_URL);
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
    expect(fonts.length).toBeGreaterThan(1);
  });

  it("falls back when the file is not a font satori can parse", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x77, 0x4f, 0x46, 0x32]));

    const fonts = await loadBrandFonts(FONT_URL);
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  /* The brand row is user-writable, so the URL in it is not a fetch target. */
  it("refuses a URL outside our own storage", async () => {
    const fonts = await loadBrandFonts("https://evil.example.com/font.ttf");

    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  it("reads each font once and serves the rest from cache", async () => {
    getObjectBytes.mockResolvedValue(fontBytes([0x4f, 0x54, 0x54, 0x4f]));

    await loadBrandFonts(FONT_URL);
    await loadBrandFonts(FONT_URL);

    expect(getObjectBytes).toHaveBeenCalledTimes(1);
  });

  /* The cache is keyed rather than shared: one brand's face must never be
     served to another rendering at the same time. */
  it("keeps separate brands' fonts apart", async () => {
    getObjectBytes.mockImplementation(async (key: string) =>
      key.includes("good")
        ? fontBytes([0x00, 0x01, 0x00, 0x00])
        : fontBytes([0x77, 0x4f, 0x46, 0x32]),
    );

    const good = await loadBrandFonts(`${BASE}/fonts/u1/good.ttf`);
    const bad = await loadBrandFonts(`${BASE}/fonts/u2/bad.ttf`);

    expect(getObjectBytes).toHaveBeenCalledTimes(2);
    // Both render; only one is wearing the brand's own face.
    expect(good.filter((f) => f.name === "Display")).toHaveLength(1);
    expect(bad.filter((f) => f.name === "Display")).toHaveLength(1);
  });

  it("remembers a failure so a broken font is not re-fetched every render", async () => {
    getObjectBytes.mockRejectedValue(new Error("gone"));

    await loadBrandFonts(FONT_URL);
    await loadBrandFonts(FONT_URL);

    expect(getObjectBytes).toHaveBeenCalledTimes(1);
  });
});

/* ── KOOS-FEAT-020 ─────────────────────────────────────────────────────── */

/* The acceptance criterion that matters most: a generated design must set
   headings in the heading face and body copy in the body face. Everything
   above this point only proves the files load. */
describe("two brand faces, each in its own role", () => {
  const HEADING_URL = `${BASE}/fonts/u1/heading.ttf`;
  const BODY_URL = `${BASE}/fonts/u1/body.ttf`;
  const TRUETYPE = [0x00, 0x01, 0x00, 0x00];

  const namesOf = (fonts: { name: string }[]) => fonts.map((f) => f.name);

  it("replaces the display face with the heading upload", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const fonts = await loadBrandFonts({ heading: HEADING_URL });
    expect(namesOf(fonts)).toContain("Display");
    // The bundled body faces survive: only the heading role was replaced.
    expect(namesOf(fonts)).toContain("Body");
  });

  it("replaces the body face with the body upload", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const fonts = await loadBrandFonts({ body: BODY_URL });
    expect(namesOf(fonts)).toContain("Body");
    expect(namesOf(fonts)).toContain("Display");
  });

  /* The defect this prevents: dropping BOTH defaults whenever either slot is
     filled would leave a brand with one uploaded face rendering its other
     role in no font at all. */
  it("keeps the bundled face for the role that was not uploaded", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const only = await loadBrandFonts({ heading: HEADING_URL });
    const bodyFaces = only.filter((f) => f.name === "Body");
    const defaults = await loadBrandFonts();
    expect(bodyFaces).toHaveLength(
      defaults.filter((f) => f.name === "Body").length,
    );
  });

  it("uses both uploads when both are given", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const fonts = await loadBrandFonts({
      heading: HEADING_URL,
      body: BODY_URL,
    });
    expect(namesOf(fonts)).toContain("Display");
    expect(namesOf(fonts)).toContain("Body");
    // Both roles were fetched — one call per distinct URL.
    expect(getObjectBytes).toHaveBeenCalledTimes(2);
  });

  /* The slots are independent all the way down: a broken body font must not
     cost the brand its heading face. */
  it("keeps the good face when the other file is unusable", async () => {
    getObjectBytes.mockImplementation(async (key: string) =>
      key.includes("body") ? Buffer.alloc(64) : fontBytes(TRUETYPE),
    );
    const fonts = await loadBrandFonts({
      heading: HEADING_URL,
      body: BODY_URL,
    });
    expect(namesOf(fonts)).toContain("Display");
    expect(namesOf(fonts)).toContain("Body");
  });

  /* Every existing caller passes a bare string, and every brand in the
     database has only that one column filled. It must keep meaning "heading". */
  it("still accepts the single-URL form as the heading face", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const legacy = await loadBrandFonts(HEADING_URL);
    __resetFontCaches();
    const explicit = await loadBrandFonts({ heading: HEADING_URL });
    expect(namesOf(legacy).sort()).toEqual(namesOf(explicit).sort());
  });

  it("returns the bundled faces when neither slot is filled", async () => {
    const fonts = await loadBrandFonts({ heading: null, body: null });
    expect(fonts).toEqual(await loadBrandFonts());
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  /* Weight is part of the role. The bundled Display face is bold and the body
     face is regular; loading a brand's heading face at 400 leaves satori with
     no bold Display to reach for, so headings render at the wrong weight or
     fall back entirely. */
  it("loads each face at the weight its role renders in", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const fonts = await loadBrandFonts({
      heading: HEADING_URL,
      body: BODY_URL,
    });
    const display = fonts.find((f) => f.name === "Display");
    const body = fonts.find((f) => f.name === "Body");
    expect(display?.weight).toBe(700);
    expect(body?.weight).toBe(400);
  });

  /* One file in BOTH slots is a legitimate choice — a brand with a single
     typeface. */
  it("serves one file in both roles when both slots point at it", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    const fonts = await loadBrandFonts({
      heading: HEADING_URL,
      body: HEADING_URL,
    });
    expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
    expect(fonts.filter((f) => f.name === "Body")).toHaveLength(1);
    expect(fonts.find((f) => f.name === "Body")?.weight).toBe(400);
  });

  /* The cache lives for the PROCESS, so the roles must be separate keys.
     Keyed by URL alone this passes within a single call — each role overwrites
     then immediately reads — and fails across two, which is the shape a server
     actually sees: one render caches the file as a heading, the next render
     asks for it as a body face and is handed the heading back. */
  it("does not serve a cached heading face into the body role", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    // First render: this file is a heading face.
    await loadBrandFonts({ heading: HEADING_URL });
    // Second render, same process: the same file, now as the body face.
    const second = await loadBrandFonts({ body: HEADING_URL });

    const body = second.find((f) => f.name === "Body");
    expect(body?.weight).toBe(400);
    // The heading role was not asked for, so no uploaded Display may appear.
    expect(second.filter((f) => f.name === "Display")).toHaveLength(
      (await loadBrandFonts()).filter((f) => f.name === "Display").length,
    );
  });

  /* Caching is per URL per role, so one brand's face cannot be served in the
     wrong role to another brand. */
  it("caches each face separately", async () => {
    getObjectBytes.mockResolvedValue(fontBytes(TRUETYPE));
    await loadBrandFonts({ heading: HEADING_URL, body: BODY_URL });
    await loadBrandFonts({ heading: HEADING_URL, body: BODY_URL });
    expect(getObjectBytes).toHaveBeenCalledTimes(2);
  });
});
