import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkRateLimit = vi.fn();
const checkBrandAccess = vi.fn();
const requireVerifiedEmail = vi.fn();
const generateBrandImage = vi.fn();
const buildImagePrompt = vi.fn();
const uploadObject = vi.fn();
const publicUrl = vi.fn();
const getSignedReadUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (dbUser: unknown) => requireVerifiedEmail(dbUser),
}));
vi.mock("@/lib/ai/image", () => ({
  generateBrandImage: (args: unknown) => generateBrandImage(args),
}));
vi.mock("@/lib/ai/prompts/image", () => ({
  buildImagePrompt: (args: unknown) => buildImagePrompt(args),
}));
vi.mock("@/lib/storage", () => ({
  uploadObject: (args: unknown) => uploadObject(args),
  publicUrl: (key: string) => publicUrl(key),
  getSignedReadUrl: (key: string, ttl: number) => getSignedReadUrl(key, ttl),
  STORAGE_PREFIXES: { generated: "generated" },
}));

import { POST } from "./route";

describe("design generate-image route", () => {
  const BRAND_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: { id: "u1", emailVerifiedAt: new Date() },
    });
    checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, userId: "u1", name: "Acme" },
    });
    requireVerifiedEmail.mockReturnValue(null);
    buildImagePrompt.mockReturnValue("composed prompt");
    generateBrandImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    uploadObject.mockResolvedValue(undefined);
    publicUrl.mockReturnValue("https://cdn.example.com/generated/key.png");
    getSignedReadUrl.mockResolvedValue("https://signed.example.com/key.png");
    delete process.env.R2_PUBLIC_BASE_URL;
  });

  function request(body: unknown) {
    return new Request("http://x/api/design/generate-image", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(401);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("rejects an invalid body with 400", async () => {
    const res = await POST(request({ brandId: "not-a-uuid", prompt: "" }));
    expect(res.status).toBe(400);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt with 400", async () => {
    const res = await POST(request({ brandId: BRAND_ID, prompt: "   " }));
    expect(res.status).toBe(400);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("returns the rate limiter's response when the limit is exceeded", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(429);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("does not generate when brand access is denied", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(404);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("does not generate when the email is unverified", async () => {
    requireVerifiedEmail.mockReturnValue(
      Response.json({ error: "verify" }, { status: 403 }),
    );
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(403);
    expect(generateBrandImage).not.toHaveBeenCalled();
  });

  it("generates, uploads, and returns a signed url when no public base is configured", async () => {
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      url: string;
      key: string;
      contentType: string;
    };
    expect(body.url).toBe("https://signed.example.com/key.png");
    expect(body.contentType).toBe("image/png");
    expect(body.key).toMatch(new RegExp(`^generated/${BRAND_ID}/`));
    expect(uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(new RegExp(`^generated/${BRAND_ID}/`)),
        contentType: "image/png",
      }),
    );
    expect(getSignedReadUrl).toHaveBeenCalled();
    expect(publicUrl).not.toHaveBeenCalled();
  });

  it("returns a public url when R2_PUBLIC_BASE_URL is configured", async () => {
    process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com";
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://cdn.example.com/generated/key.png");
    expect(publicUrl).toHaveBeenCalled();
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("returns a clean 500 when generation fails", async () => {
    generateBrandImage.mockRejectedValue(new Error("bedrock exploded"));
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("returns a clean 500 when upload fails", async () => {
    uploadObject.mockRejectedValue(new Error("r2 exploded"));
    const res = await POST(request({ brandId: BRAND_ID, prompt: "a cat" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
