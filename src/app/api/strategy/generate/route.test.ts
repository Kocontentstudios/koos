import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const createGenerationJob = vi.fn();
const executeGenerationJob = vi.fn();
const generateStrategyWork = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  executeGenerationJob: (id: string, work: () => Promise<unknown>) =>
    executeGenerationJob(id, work),
  generateStrategyWork: (args: unknown) => generateStrategyWork(args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true, retryAfterSeconds: 0 }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
// Run the post-response work inline so assertions can see it.
vi.mock("next/server", () => ({ after: (cb: () => unknown) => cb() }));

import { POST } from "./route";

describe("strategy generate route", () => {
  const BRAND_ID = "11111111-1111-4111-8111-111111111111";
  const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: { id: "u1", emailVerifiedAt: new Date() },
    });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, userId: "u1", name: "Acme" },
    });
    createGenerationJob.mockResolvedValue({ id: "job-1" });
    executeGenerationJob.mockImplementation(
      async (_id: string, work: () => Promise<unknown>) => {
        await work();
      },
    );
    generateStrategyWork.mockResolvedValue({
      resultId: "s1",
      result: { strategyId: "s1" },
    });
  });

  it("returns 202 with a job id and forwards conversationId to the work", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: BRAND_ID,
        conversation: "user: hi",
        conversationId: CONVERSATION_ID,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toBe("job-1");
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "strategy",
        userId: "u1",
        brandId: BRAND_ID,
        input: { conversationId: CONVERSATION_ID },
      }),
    );
    expect(generateStrategyWork).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID }),
    );
  });

  it("still works when conversationId is omitted (null)", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(generateStrategyWork).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });

  it("rejects a malformed conversationId with 400", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: BRAND_ID,
        conversation: "user: hi",
        conversationId: "bad",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("rejects an unverified email with 403 before any work", async () => {
    getAuthUser.mockResolvedValue({
      dbUser: { id: "u1", emailVerifiedAt: null },
    });
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("does not create a job for a brand the caller doesn't own", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });
});
