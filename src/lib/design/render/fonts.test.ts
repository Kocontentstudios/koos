// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
/* Only the bucket read is mocked. storageKeyFrom is the guard these tests
   exist to exercise, so it runs for real. */
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

const readVendoredFace = vi.fn();

/* scripts/fetch-fonts.mjs vendors the three built-in faces at build time, and
   the gate lane must not depend on that having run — nor read a real font off
   disk to load three defaults every test. Only reads under the directory the
   module actually uses are intercepted, keyed off its own exported FONT_DIR so
   this is not another copy of the path; everything else gets the real fs. */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = actual.readFile as (...args: unknown[]) => unknown;
  return {
    ...actual,
    readFile: (target: unknown, ...rest: unknown[]) =>
      typeof target === "string" && target.startsWith(FONT_DIR)
        ? readVendoredFace(target)
        : readFile(target, ...rest),
  };
});

import { join } from "node:path";
import { buildFont, signatureOnlyFont } from "./font-fixtures";
import {
  __resetFontCaches,
  FONT_DIR,
  isRenderableFont,
  loadBrandFonts,
} from "./fonts";

const BASE = "https://cdn.example.com";
const FONT_URL = `${BASE}/fonts/u1/brand.ttf`;

/** A real, renderable font, built at runtime rather than committed.
 *
 *  A four-byte stub will not do: both load paths now validate structurally, so
 *  a signature followed by padding is refused exactly as a corrupt upload is. */
function fontBytes(signature?: number[]) {
  return Buffer.from(buildFont(signature ? { signature } : {}));
}

/* Every URL any code under test tried to reach. The assertion lives in
   afterEach so it covers every case in the file, not just the one written to
   check it: font loading must never call out to the network, and a change that
   reintroduces the call fails here instead of flaking in CI a week later. */
const attemptedRequests: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  __resetFontCaches();
  process.env.R2_PUBLIC_BASE_URL = BASE;
  attemptedRequests.length = 0;
  readVendoredFace.mockImplementation(async () => fontBytes());
  vi.stubGlobal("fetch", (input: unknown) => {
    attemptedRequests.push(String(input));
    throw new Error(`unexpected network call: ${String(input)}`);
  });
});

afterEach(() => {
  expect(attemptedRequests).toEqual([]);
  vi.unstubAllGlobals();
  __resetFontCaches();
});

describe("isRenderableFont", () => {
  it.each([
    ["TrueType", [0x00, 0x01, 0x00, 0x00]],
    ["a 'true' TrueType", [0x74, 0x72, 0x75, 0x65]],
    ["CFF OpenType", [0x4f, 0x54, 0x54, 0x4f]],
  ])("accepts %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(true);
  });

  /* Satori rejects each of these outright, so they must never reach it. The
     collection is the one that used to be accepted here: satori refuses every
     .ttc with "Unsupported OpenType signature ttcf", verified against eight
     real collections, so accepting it only moved the failure into the render
     where the message no longer names the font. */
  it.each([
    ["WOFF", [0x77, 0x4f, 0x46, 0x46]],
    ["WOFF2", [0x77, 0x4f, 0x46, 0x32]],
    ["a PNG", [0x89, 0x50, 0x4e, 0x47]],
    ["nothing", [0x00, 0x00, 0x00, 0x00]],
    ["a TrueType collection", [0x74, 0x74, 0x63, 0x66]],
  ])("rejects %s", (_label, signature) => {
    expect(isRenderableFont(new Uint8Array(signature))).toBe(false);
  });
});

describe("loadBrandFonts", () => {
  it("uses the built-in families when the brand has no font", async () => {
    const fonts = await loadBrandFonts();

    expect(fonts.map((f) => f.name)).toContain("Display");
    expect(fonts.map((f) => f.name)).toContain("Body");
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  /* KOS-V1-BUG-010: the vendored directory did not exist, so this path never
     ran and every render — and every run of this file — went to Google.
     Asserted as whole paths built from the exported FONT_DIR, so pointing the
     read at some other directory while leaving FONT_DIR correct fails here. */
  it("reads all three built-in faces from the vendored directory", async () => {
    const fonts = await loadBrandFonts();

    expect(readVendoredFace.mock.calls.map(([path]) => path)).toEqual([
      join(FONT_DIR, "display-bold.ttf"),
      join(FONT_DIR, "body-regular.ttf"),
      join(FONT_DIR, "body-semibold.ttf"),
    ]);
    expect(fonts.map((f) => `${f.name}:${f.weight}`)).toEqual([
      "Display:700",
      "Body:400",
      "Body:600",
    ]);
  });

  it("loads the built-in faces once per process", async () => {
    await loadBrandFonts();
    await loadBrandFonts();

    expect(readVendoredFace).toHaveBeenCalledTimes(3);
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

  /* KOS-V1-BUG-018. The signature check passed this file and satori then threw
     "Offset is outside the bounds of the DataView" mid-render, so every design
     the brand generated failed with a message naming nothing. The upload route
     refuses it now, but a brand that stored one before that landed still has
     it, and only the read path can save those. */
  it.each([
    ["a body of zeros behind a valid signature", signatureOnlyFont()],
    ["a half-finished upload", buildFont({ truncateTo: 220 })],
  ])(
    "keeps the bundled faces when the stored font is %s",
    async (_l, bytes) => {
      getObjectBytes.mockResolvedValue(Buffer.from(bytes));

      const fonts = await loadBrandFonts(FONT_URL);
      expect(fonts.filter((f) => f.name === "Display")).toHaveLength(1);
      expect(fonts.every((f) => !f.fromBrand)).toBe(true);
    },
  );

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

/* ── KOS-V1-BUG-010 ────────────────────────────────────────────────────── */

/* The Google fetch is kept as a safety net for a deploy whose file tracing
   dropped the vendored .ttf files, and it is the path `pnpm dev` takes before
   anyone has run the prefetch. Both cases here install their own transport, so
   the recorder in beforeEach never sees a call and nothing leaves the process
   either way. */
describe("the network fallback, when the vendored files are missing", () => {
  const absent = () => {
    readVendoredFace.mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );
  };

  const GOOGLE_CSS =
    "@font-face{src:url(https://fonts.gstatic.com/s/x.ttf) format('truetype');}";

  it("asks Google with the User-Agent that yields TTF rather than WOFF2", async () => {
    absent();
    const transport = vi.fn(
      async (url: string, _init?: { headers?: Record<string, string> }) =>
        url.endsWith(".ttf")
          ? { arrayBuffer: async () => new ArrayBuffer(64) }
          : { text: async () => GOOGLE_CSS },
    );
    vi.stubGlobal("fetch", transport);

    const fonts = await loadBrandFonts();

    expect(fonts.map((f) => f.name)).toEqual(["Display", "Body", "Body"]);
    const [, init] = transport.mock.calls[0];
    // A modern UA gets WOFF2, which satori rejects outright.
    expect(init?.headers?.["User-Agent"]).toContain("AppleWebKit/533.21.1");
  });

  /* A vendored file that is present but corrupt is the failure the prefetch
     newly made reachable: readFile succeeds, so nothing would fall back, and
     satori throws on a bad signature rather than declining — the render 500s
     instead of degrading. */
  it("falls back when the vendored file is present but not a font", async () => {
    readVendoredFace.mockResolvedValue(fontBytes([0x77, 0x4f, 0x46, 0x32]));
    const transport = vi.fn(async (url: string) =>
      url.endsWith(".ttf")
        ? { arrayBuffer: async () => new ArrayBuffer(64) }
        : { text: async () => GOOGLE_CSS },
    );
    vi.stubGlobal("fetch", transport);

    const fonts = await loadBrandFonts();

    expect(fonts.map((f) => f.name)).toEqual(["Display", "Body", "Body"]);
    expect(transport).toHaveBeenCalled();
  });

  /* A transient failure must not poison the process: caching the empty result
     would leave every later render fontless until the instance recycled. */
  it("does not cache an empty result when the fetch also fails", async () => {
    absent();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });

    expect(await loadBrandFonts()).toEqual([]);

    readVendoredFace.mockResolvedValue(fontBytes([0x00, 0x01, 0x00, 0x00]));
    expect((await loadBrandFonts()).map((f) => f.name)).toEqual([
      "Display",
      "Body",
      "Body",
    ]);
  });
});
