// @vitest-environment node
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const listSetFrames = vi.fn();
const getObjectBytes = vi.fn();
const uploadObject = vi.fn();
const getSignedReadUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, p: string) =>
    checkBrandAccess(u, b, p),
  listSetFrames: (b: string, s: string) => listSetFrames(b, s),
}));
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (key: string) => getObjectBytes(key),
  uploadObject: (params: unknown) => uploadObject(params),
  getSignedReadUrl: (key: string, ttl: number, opts: unknown) =>
    getSignedReadUrl(key, ttl, opts),
  STORAGE_PREFIXES: { generated: "generated" },
}));

import { GET } from "./route";

const SET = "1a2b3c4d-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 12, minute));

type Status = "pending" | "succeeded" | "failed";

function frame(
  index: number,
  role: "hook" | "body" | "cta",
  opts: {
    id?: string;
    status?: Status;
    minute?: number;
    supersededBy?: string | null;
    imageKey?: string | null;
    count?: number;
  } = {},
) {
  const id = opts.id ?? `f${index}`;
  return {
    id,
    brandId: BRAND,
    setId: SET,
    frameIndex: index,
    frameCount: opts.count ?? 3,
    status: opts.status ?? "succeeded",
    supersededBy: opts.supersededBy ?? null,
    createdAt: at(opts.minute ?? index),
    imageKey:
      opts.imageKey === undefined
        ? `generated/${BRAND}/${id}.png`
        : opts.imageKey,
    rationale: { title: `Frame ${index}`, reasons: [], role },
    designType: "Instagram carousel",
    width: 1080,
    height: 1350,
  };
}

const SET_ROWS = [frame(0, "hook"), frame(1, "body"), frame(2, "cta")];

/* Each key gets its own PNG, sized by the key, so a test can tell which
   object ended up where. */
const SIZES: Record<string, [number, number]> = {};
async function pngFor(key: string): Promise<Buffer> {
  const [width, height] = SIZES[key] ?? [108, 135];
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: key.length * 7, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
}

function call(
  query: Record<string, string> = { brandId: BRAND, format: "zip" },
  setId = SET,
) {
  const url = new URL(`http://x/api/design/sets/${setId}/download`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url), { params: Promise.resolve({ setId }) });
}

interface Uploaded {
  key: string;
  body: Uint8Array;
  contentType: string;
  contentDisposition: string;
}

function uploaded(): Uploaded {
  expect(uploadObject).toHaveBeenCalledTimes(1);
  return uploadObject.mock.calls[0][0] as Uploaded;
}

/* The file itself is what reached R2; the response only points at it. */
async function zipOf(res: Response) {
  expect(res.status).toBe(302);
  return unzipSync(uploaded().body);
}

async function pdfOf(res: Response) {
  expect(res.status).toBe(302);
  return PDFDocument.load(uploaded().body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FEATURE_MULTI_FRAME", "on");
  for (const key of Object.keys(SIZES)) delete SIZES[key];
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({
    ok: true,
    brand: { id: BRAND, name: "Acme Bakery" },
  });
  listSetFrames.mockResolvedValue(SET_ROWS);
  getObjectBytes.mockImplementation(pngFor);
  uploadObject.mockResolvedValue(undefined);
  getSignedReadUrl.mockResolvedValue("https://r2.example/signed");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/design/sets/[setId]/download: refusals", () => {
  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(listSetFrames).not.toHaveBeenCalled();
  });

  /* H6: with the flag off the route does not exist. */
  it("404s with the flag off, without touching the database", async () => {
    vi.stubEnv("FEATURE_MULTI_FRAME", "");
    expect((await call()).status).toBe(404);
    expect(checkBrandAccess).not.toHaveBeenCalled();
    expect(listSetFrames).not.toHaveBeenCalled();
  });

  it("404s a set id that is not a uuid", async () => {
    expect((await call(undefined, "not-a-uuid")).status).toBe(404);
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });

  it.each([[{ format: "zip" }], [{ brandId: "nope", format: "zip" }]])(
    "400s a missing or invalid brandId (%j)",
    async (query) => {
      expect((await call(query)).status).toBe(400);
      expect(checkBrandAccess).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ brandId: BRAND }],
    [{ brandId: BRAND, format: "png" }],
    [{ brandId: BRAND, format: "ZIP" }],
  ])("400s a missing or unknown format (%j)", async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "zip or pdf",
    );
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });

  /* H10: another brand's set reads as a set that does not exist, whatever
     the reason access was refused. */
  it.each([
    [{ ok: false, status: 404, error: "Brand not found" }],
    [{ ok: false, status: 403, error: "Forbidden" }],
  ])("404s a brand the caller cannot reach (%j)", async (refusal) => {
    checkBrandAccess.mockResolvedValue(refusal);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(listSetFrames).not.toHaveBeenCalled();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("looks the set up inside the brand it was asked for", async () => {
    await call();
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      BRAND,
      "manage_content",
    );
    expect(listSetFrames).toHaveBeenCalledWith(BRAND, SET);
  });

  it("explains a set with no rows", async () => {
    listSetFrames.mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe(
      "This set has no finished frames to download yet.",
    );
  });

  it("explains a set whose frames are all still rendering or failed", async () => {
    listSetFrames.mockResolvedValue([
      frame(0, "hook", { status: "pending", imageKey: null }),
      frame(1, "body", { status: "failed", imageKey: null }),
    ]);
    const res = await call();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain(
      "no finished frames",
    );
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses to read a key outside the generated prefix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listSetFrames.mockResolvedValue([
      frame(0, "hook"),
      frame(1, "body", { imageKey: "logos/b1/other.png" }),
    ]);
    expect((await call()).status).toBe(404);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("reports a storage read failure instead of a broken file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getObjectBytes.mockRejectedValue(new Error("R2 down"));
    expect((await call()).status).toBe(502);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("reports a failed upload rather than redirecting to nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    uploadObject.mockRejectedValue(new Error("R2 down"));
    expect((await call()).status).toBe(502);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("reports a signing failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSignedReadUrl.mockRejectedValue(new Error("no creds"));
    expect((await call()).status).toBe(502);
  });
});

describe("GET /api/design/sets/[setId]/download?format=zip", () => {
  it("sends every live frame as a numbered PNG, in frame order", async () => {
    const zip = await zipOf(await call());
    expect(Object.keys(zip)).toEqual([
      "01-hook.png",
      "02-body.png",
      "03-cta.png",
    ]);
    expect(Buffer.from(zip["02-body.png"])).toEqual(
      await pngFor(`generated/${BRAND}/f1.png`),
    );
  });

  /* Rows come back from the query in index order, but the file must not
     depend on that. */
  it("orders by frame index whatever order the rows arrive in", async () => {
    listSetFrames.mockResolvedValue([...SET_ROWS].reverse());
    const zip = await zipOf(await call());
    expect(Object.keys(zip)).toEqual([
      "01-hook.png",
      "02-body.png",
      "03-cta.png",
    ]);
  });

  /* H9 + H10: a regenerated frame ships its new take, never the old one. */
  it("ships the replacement of a regenerated frame, not the frame it replaced", async () => {
    listSetFrames.mockResolvedValue([
      frame(0, "hook"),
      frame(1, "body", { id: "old", supersededBy: "new", minute: 1 }),
      frame(1, "body", { id: "new", minute: 9 }),
      frame(2, "cta"),
    ]);
    const zip = await zipOf(await call());
    expect(Object.keys(zip)).toEqual([
      "01-hook.png",
      "02-body.png",
      "03-cta.png",
    ]);
    const read = getObjectBytes.mock.calls.map(([key]) => key);
    expect(read).toContain(`generated/${BRAND}/new.png`);
    expect(read).not.toContain(`generated/${BRAND}/old.png`);
  });

  /* A regenerate still running keeps the frame on show, so the download
     matches what the user sees. */
  it("keeps the frame on show while its regenerate is pending", async () => {
    listSetFrames.mockResolvedValue([
      frame(0, "hook"),
      frame(1, "body", { id: "shown", minute: 1 }),
      frame(1, "body", { id: "pending", status: "pending", imageKey: null }),
      frame(2, "cta"),
    ]);
    const zip = await zipOf(await call());
    expect(Object.keys(zip)).toHaveLength(3);
    expect(getObjectBytes.mock.calls.map(([k]) => k)).toContain(
      `generated/${BRAND}/shown.png`,
    );
  });

  /* A failed frame leaves a visible gap rather than renumbering the rest. */
  it("keeps each frame's own number when one failed", async () => {
    listSetFrames.mockResolvedValue([
      frame(0, "hook", { count: 4 }),
      frame(1, "body", { count: 4, status: "failed", imageKey: null }),
      frame(2, "body", { count: 4 }),
      frame(3, "cta", { count: 4 }),
    ]);
    const zip = await zipOf(await call());
    expect(Object.keys(zip)).toEqual([
      "01-hook.png",
      "03-body.png",
      "04-cta.png",
    ]);
  });

  it("pads to two digits on a ten-frame carousel", async () => {
    listSetFrames.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        frame(i, i === 0 ? "hook" : i === 9 ? "cta" : "body", { count: 10 }),
      ),
    );
    const names = Object.keys(await zipOf(await call()));
    expect(names[0]).toBe("01-hook.png");
    expect(names[9]).toBe("10-cta.png");
  });

  /* Vercel refuses a response body over 4.5 MB, so the bytes go to R2 and
     the browser follows a short-lived attachment URL, as a single design's
     download does. */
  it("redirects to a short-lived attachment URL named for the brand and set", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://r2.example/signed");

    const { key, contentType, contentDisposition } = uploaded();
    expect(contentType).toBe("application/zip");
    const fileName = "acme-bakery-instagram-carousel-1080x1350-1a2b3c4d.zip";
    expect(contentDisposition).toBe(`attachment; filename="${fileName}"`);

    const [signedKey, ttl, opts] = getSignedReadUrl.mock.calls[0];
    expect(signedKey).toBe(key);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(opts).toEqual({ disposition: "attachment", fileName });
  });

  it("writes the file under the brand's generated prefix, keyed by its live frames", async () => {
    await call();
    const first = uploaded().key;
    expect(first.startsWith(`generated/${BRAND}/sets/${SET}/`)).toBe(true);
    expect(first).toMatch(/\/[0-9a-f]{16}\.zip$/);

    /* The same frames again overwrite the same object. */
    uploadObject.mockClear();
    await call();
    expect(uploaded().key).toBe(first);

    /* A regenerated frame makes a new file, never a stale one. */
    uploadObject.mockClear();
    listSetFrames.mockResolvedValue([
      frame(0, "hook"),
      frame(1, "body", { id: "old", supersededBy: "new", minute: 1 }),
      frame(1, "body", { id: "new", minute: 9 }),
      frame(2, "cta"),
    ]);
    await call();
    expect(uploaded().key).not.toBe(first);
  });

  it("leaves a trace line with what it sent", async () => {
    await call();
    const line = vi
      .mocked(console.log)
      .mock.calls.map(([l]) => String(l))
      .find((l) => l.startsWith("design.sequence.download "));
    expect(line).toBeDefined();
    expect(
      JSON.parse((line as string).slice("design.sequence.download ".length)),
    ).toMatchObject({ setId: SET, format: "zip", frames: 3 });
  });
});

describe("GET /api/design/sets/[setId]/download?format=pdf", () => {
  it("sends one page per frame, in order, each at its PNG's pixel size", async () => {
    SIZES[`generated/${BRAND}/f0.png`] = [108, 135];
    SIZES[`generated/${BRAND}/f1.png`] = [120, 120];
    SIZES[`generated/${BRAND}/f2.png`] = [192, 108];
    listSetFrames.mockResolvedValue([...SET_ROWS].reverse());

    const doc = await pdfOf(await call({ brandId: BRAND, format: "pdf" }));
    const { key, contentType, contentDisposition } = uploaded();
    expect(key).toMatch(/\.pdf$/);
    expect(contentType).toBe("application/pdf");
    expect(contentDisposition).toBe(
      'attachment; filename="acme-bakery-instagram-carousel-1080x1350-1a2b3c4d.pdf"',
    );
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [108, 135],
      [120, 120],
      [192, 108],
    ]);
  });

  it("leaves out a superseded frame", async () => {
    SIZES[`generated/${BRAND}/old.png`] = [50, 50];
    listSetFrames.mockResolvedValue([
      frame(0, "hook"),
      frame(1, "body", { id: "old", supersededBy: "new", minute: 1 }),
      frame(1, "body", { id: "new", minute: 9 }),
      frame(2, "cta"),
    ]);
    const doc = await pdfOf(await call({ brandId: BRAND, format: "pdf" }));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => p.getWidth())).not.toContain(50);
  });

  it("reports a frame that is not a PNG instead of a broken PDF", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getObjectBytes.mockResolvedValue(Buffer.from("not an image"));
    expect((await call({ brandId: BRAND, format: "pdf" })).status).toBe(502);
  });
});
