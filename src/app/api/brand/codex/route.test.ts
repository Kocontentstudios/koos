import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getBrandById = vi.fn();
const getBrandContext = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  getBrandById: (id: string) => getBrandById(id),
  getBrandContext: (id: string, s: string) => getBrandContext(id, s),
}));

import { GET } from "./route";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const get = (query = `?brandId=${BRAND_ID}`) =>
  new Request(`http://x/api/brand/codex${query}`);

const GUIDE = {
  toneSpectrum: ["Warm to cool: warm"],
  dos: ["Lead with craft"],
  donts: ["Never say cheap"],
  writingStyleRules: ["Active voice"],
  vocabularyGuardrails: ["Use handwoven"],
  exampleLines: ["Woven by hand."],
};

describe("GET /api/brand/codex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: BRAND_ID } });
    getBrandById.mockResolvedValue({ name: "Lagos Loom", tone: "Bold, Warm" });
    getBrandContext.mockResolvedValue({ dataJson: { guide: GUIDE } });
  });

  it("serves the codex as a named markdown download", async () => {
    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="lagos-loom-brand-codex.md"',
    );
    const body = await res.text();
    expect(body).toContain("# Lagos Loom — Brand Codex");
    expect(body).toContain("Never say cheap");
  });

  /* A brand edited a minute ago must not serve last week's codex. */
  it("is never cached", async () => {
    expect((await GET(get())).headers.get("Cache-Control")).toBe("no-store");
  });

  /* Synthesis runs after the response and may not have landed, or may have
     failed. The rest of the profile is still worth downloading. */
  it("still serves a codex when no guide has been synthesized", async () => {
    getBrandContext.mockResolvedValue(null);
    const body = await (await GET(get())).text();

    expect(body).toContain("# Lagos Loom — Brand Codex");
    expect(body).not.toContain("Voice & Messaging Guide");
  });

  it("tolerates a stored context with no guide in it", async () => {
    getBrandContext.mockResolvedValue({ dataJson: {} });
    expect((await GET(get())).status).toBe(200);
  });

  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await GET(get())).status).toBe(401);
  });

  it.each(["", "?brandId=", "?brandId=not-a-uuid"])(
    "rejects a missing or malformed brandId (%j)",
    async (query) => {
      expect((await GET(get(query))).status).toBe(400);
      expect(checkBrandAccess).not.toHaveBeenCalled();
    },
  );

  /* The admin export is admin-only and stays that way; this one is guarded by
     brand access like every other user-facing brand route. */
  it("refuses a brand the caller cannot manage", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    expect((await GET(get())).status).toBe(403);
    expect(getBrandById).not.toHaveBeenCalled();
  });

  it("asks for manage_content on the requested brand", async () => {
    await GET(get());
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      BRAND_ID,
      "manage_content",
    );
  });

  it("404s a brand that vanished between the check and the read", async () => {
    getBrandById.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(404);
  });
});
