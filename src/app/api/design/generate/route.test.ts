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

describe("design generate route attachments", () => {
  const OTHER_ID = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: { id: "u1", emailVerifiedAt: new Date() },
    });
    requireVerifiedEmail.mockReturnValue(null);
    checkRateLimit.mockResolvedValue({ ok: true });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, workspaceId: WORKSPACE_ID },
    });
    resolveDesignProviders.mockReturnValue([{ id: "google" }]);
    isStorageConfigured.mockReturnValue(true);
    checkDesignQuota.mockResolvedValue({ ok: true });
    resolveDesignContext.mockResolvedValue({ source: "quick" });
    createGenerationJob.mockResolvedValue({ id: "job-1" });
  });

  it("passes a well-formed attachment list through to the resolver", async () => {
    const res = await POST(
      post({
        brandId: BRAND_ID,
        attachments: [
          { type: "brief", id: OTHER_ID },
          { type: "calendar_item", id: BRAND_ID },
        ],
      }),
    );

    expect(res.status).toBe(202);
    expect(resolveDesignContext).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { type: "brief", id: OTHER_ID },
          { type: "calendar_item", id: BRAND_ID },
        ],
      }),
    );
  });

  it("treats a missing list as no attachments", async () => {
    await POST(post({ brandId: BRAND_ID, freeform: "hi" }));
    expect(resolveDesignContext).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [] }),
    );
  });

  /* The ids come from the client, so a malformed list is a 400 rather than a
     partially-honoured request. Ownership is proved separately, per type. */
  it.each([
    ["not an array", "nope"],
    ["a non-object entry", ["brief"]],
    [
      "an unknown type",
      [{ type: "brand", id: "11111111-1111-4111-8111-111111111111" }],
    ],
    ["a missing type", [{ id: "11111111-1111-4111-8111-111111111111" }]],
    ["a non-uuid id", [{ type: "brief", id: "../../etc/passwd" }]],
    ["a numeric id", [{ type: "brief", id: 7 }]],
    ["a null entry", [null]],
  ])("rejects %s", async (_label, attachments) => {
    const res = await POST(post({ brandId: BRAND_ID, attachments }));
    expect(res.status).toBe(400);
    expect(resolveDesignContext).not.toHaveBeenCalled();
  });

  it("caps how many can be attached at once", async () => {
    const many = Array.from({ length: 11 }, () => ({
      type: "brief" as const,
      id: OTHER_ID,
    }));
    const res = await POST(post({ brandId: BRAND_ID, attachments: many }));
    expect(res.status).toBe(400);
    expect(resolveDesignContext).not.toHaveBeenCalled();
  });

  /* resolveDesignContext throws DesignContextError for an id belonging to
     another brand; that must surface as a 404, not a 500. */
  it("404s when an attachment does not belong to this brand", async () => {
    // The class comes from the mocked module, so construct it from there
    // rather than a local stand-in the route would not recognise.
    const { DesignContextError } = await import("@/lib/design/context");
    resolveDesignContext.mockRejectedValue(
      new DesignContextError("Calendar item not found."),
    );
    const res = await POST(
      post({
        brandId: BRAND_ID,
        attachments: [{ type: "calendar_item", id: OTHER_ID }],
      }),
    );
    expect(res.status).toBe(404);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("records the attachment list on the job", async () => {
    await POST(
      post({
        brandId: BRAND_ID,
        attachments: [{ type: "brief", id: OTHER_ID }],
      }),
    );
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          attachments: [{ type: "brief", id: OTHER_ID }],
        }),
      }),
    );
  });
});
