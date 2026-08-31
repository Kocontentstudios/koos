import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getDesignGenerationById = vi.fn();
const getSignedReadUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, p: string) =>
    checkBrandAccess(u, b, p),
  getDesignGenerationById: (id: string) => getDesignGenerationById(id),
}));
vi.mock("@/lib/storage", () => ({
  getSignedReadUrl: (key: string, ttl: number, opts: unknown) =>
    getSignedReadUrl(key, ttl, opts),
  STORAGE_PREFIXES: { generated: "generated" },
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

const GENERATION = {
  id: ID,
  brandId: "b1",
  imageKey: "generated/b1/abc.png",
  designType: "Instagram post",
  width: 1080,
  height: 1350,
};

function call(id = ID) {
  return GET(new Request("http://x"), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  getDesignGenerationById.mockResolvedValue(GENERATION);
  getSignedReadUrl.mockResolvedValue("https://r2.example/signed");
});

describe("GET /api/design/generations/[id]/download", () => {
  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  /* Until now the only thing guarding a generated object was that its public
     R2 URL is unguessable. */
  it("refuses a brand the caller cannot reach", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      error: "Forbidden",
      status: 403,
    });
    expect((await call()).status).toBe(404);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("404s an id that is not a uuid, without touching the database", async () => {
    expect((await call("not-a-uuid")).status).toBe(404);
    expect(getDesignGenerationById).not.toHaveBeenCalled();
  });

  it("404s a generation that does not exist", async () => {
    getDesignGenerationById.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  /* A variant that failed or is still rendering has no bytes to send. */
  it("explains a generation with no image yet", async () => {
    getDesignGenerationById.mockResolvedValue({
      ...GENERATION,
      imageKey: null,
    });
    const res = await call();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain(
      "not ready",
    );
  });

  /* The whole point: a `download` attribute is ignored cross-origin, so the
     disposition has to come from the signed URL itself. */
  it("redirects to a short-lived attachment URL", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://r2.example/signed");

    const [key, ttl, opts] = getSignedReadUrl.mock.calls[0];
    expect(key).toBe("generated/b1/abc.png");
    expect(ttl).toBeLessThanOrEqual(300);
    expect(opts).toMatchObject({ disposition: "attachment" });
  });

  /* The key comes off the row, never from round-tripping the public URL. */
  it("names the file from what the card shows", async () => {
    await call();
    const [, , opts] = getSignedReadUrl.mock.calls[0];
    expect((opts as { fileName: string }).fileName).toBe(
      "instagram-post-1080x1350-11111111.png",
    );
  });

  /* The commit this branch sits on established that a stored key is never
     handed to the storage client unchecked. */
  it.each([
    "logos/b1/other.png",
    "../logos/b1/other.png",
    "generatedX/b1/x.png",
    "",
  ])(
    "refuses to sign %j, which is outside the generated prefix",
    async (imageKey) => {
      getDesignGenerationById.mockResolvedValue({ ...GENERATION, imageKey });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await call()).status).toBe(404);
      expect(getSignedReadUrl).not.toHaveBeenCalled();
    },
  );

  it("reports a signing failure rather than redirecting nowhere", async () => {
    getSignedReadUrl.mockRejectedValue(new Error("no creds"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call()).status).toBe(502);
  });
});
