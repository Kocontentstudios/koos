import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkRateLimit = vi.fn();
const checkBrandAccess = vi.fn();
const createGenerationJob = vi.fn();
const requireVerifiedEmail = vi.fn();
const resolveDesignProviders = vi.fn();
const resolveDesignContext = vi.fn();
const checkDesignQuota = vi.fn();
const isStorageConfigured = vi.fn();
const executeGenerationJob = vi.fn();
const generateDesignWork = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (dbUser: unknown) => requireVerifiedEmail(dbUser),
}));
vi.mock("@/lib/ai/image", () => ({
  resolveDesignProviders: () => resolveDesignProviders(),
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("@/lib/design/quota", () => ({
  checkDesignQuota: (workspaceId: string) => checkDesignQuota(workspaceId),
  quotaExceeded: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/storage", () => ({
  isStorageConfigured: () => isStorageConfigured(),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  executeGenerationJob: (...args: unknown[]) => executeGenerationJob(...args),
}));
vi.mock("@/lib/jobs/run-design-generation", () => ({
  generateDesignWork: (...args: unknown[]) => generateDesignWork(...args),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: () => Promise.resolve("s1"),
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import { POST } from "./route";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return new Request("http://x/api/design/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("design generate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: { id: "u1", emailVerifiedAt: new Date() },
    });
    requireVerifiedEmail.mockReturnValue(null);
    checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, workspaceId: WORKSPACE_ID, name: "Acme" },
    });
    resolveDesignProviders.mockReturnValue([{ id: "bedrock-stability" }]);
    isStorageConfigured.mockReturnValue(true);
    checkDesignQuota.mockResolvedValue({ ok: true, used: 1, limit: 200 });
    resolveDesignContext.mockResolvedValue({ brand: { id: BRAND_ID } });
    createGenerationJob.mockResolvedValue({ id: "job-1" });
    executeGenerationJob.mockResolvedValue(undefined);
  });

  it("returns 202 with a job id", async () => {
    const res = await POST(post({ brandId: BRAND_ID }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "design_render", brandId: BRAND_ID }),
    );
  });

  it("rejects an unauthenticated caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(401);
  });

  it("rejects an unverified email before doing any work", async () => {
    requireVerifiedEmail.mockReturnValue(new Response(null, { status: 403 }));
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(403);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("passes through the rate limiter", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(429);
  });

  it("passes through the brand-access status", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(404);
  });

  it("rejects a malformed brandId", async () => {
    expect((await POST(post({ brandId: "nope" }))).status).toBe(400);
  });

  it("rejects an unsupported aspect ratio", async () => {
    const res = await POST(post({ brandId: BRAND_ID, aspectRatio: "3:7" }));
    expect(res.status).toBe(400);
  });

  it("503s without creating a job when no provider is configured", async () => {
    resolveDesignProviders.mockReturnValue([]);
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(503);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("503s without creating a job when storage is unconfigured", async () => {
    isStorageConfigured.mockReturnValue(false);
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(503);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("enforces the workspace monthly quota", async () => {
    checkDesignQuota.mockResolvedValue({ ok: false, used: 200, limit: 200 });
    expect((await POST(post({ brandId: BRAND_ID }))).status).toBe(429);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });
});
