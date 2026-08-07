import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const updateBrand = vi.fn();
const createGenerationJob = vi.fn();
const getStrategyById = vi.fn();
const createTicketFromRequest = vi.fn();
const executeGenerationJob = vi.fn();
const generateStrategyWork = vi.fn();
const generateCalendarWork = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true, retryAfterSeconds: 0 }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  updateBrand: (brandId: string, fields: unknown) =>
    updateBrand(brandId, fields),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
  getStrategyById: (id: string) => getStrategyById(id),
}));
vi.mock("@/lib/design/ticket-create", () => ({
  createTicketFromRequest: (input: unknown, deps: unknown) =>
    createTicketFromRequest(input, deps),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  CALENDAR_SLICE_BUDGET_MS: 240_000,
  executeGenerationJob: (id: string, work: () => Promise<unknown>) =>
    executeGenerationJob(id, work),
  generateStrategyWork: (args: unknown) => generateStrategyWork(args),
  generateCalendarWork: (args: unknown, runtime: unknown) =>
    generateCalendarWork(args, runtime),
}));
// Run the post-response work inline so assertions can see it.
vi.mock("next/server", () => ({ after: (cb: () => unknown) => cb() }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/actions/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const STRATEGY_ID = "22222222-2222-4222-8222-222222222222";

describe("POST /api/actions/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({
      dbUser: {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@x.com",
        emailVerifiedAt: new Date(),
      },
    });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, name: "Acme" },
    });
  });

  it("rejects a proposal for a brand the user cannot access", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "brand_fields",
          summary: "x",
          data: { fields: { tone: "bold" } },
        },
      }),
    );
    expect(res.status).toBe(404);
    expect(updateBrand).not.toHaveBeenCalled();
  });

  it("applies a confirmed brand_fields proposal", async () => {
    updateBrand.mockResolvedValue({ id: BRAND_ID });
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "brand_fields",
          summary: "Set tone",
          data: { fields: { tone: "bold" } },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(updateBrand).toHaveBeenCalledWith(BRAND_ID, { tone: "bold" });
  });

  it("400s on an invalid proposal", async () => {
    const res = await POST(
      req({ brandId: BRAND_ID, proposal: { kind: "nope" } }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a design ticket from a confirmed design_ticket proposal", async () => {
    createTicketFromRequest.mockResolvedValue({ ticket: { id: "t1" } });
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "design_ticket",
          summary: "New flyer",
          data: { designType: "flyer", brief: "Promote the sale" },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resultId: string };
    expect(body.resultId).toBe("t1");
    expect(createTicketFromRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND_ID,
        userId: "u1",
        designType: "flyer",
        brief: "Promote the sale",
      }),
      expect.objectContaining({
        brandName: "Acme",
        requesterName: "Ada Lovelace",
        requesterEmail: "ada@x.com",
      }),
    );
  });

  it("kicks off strategy generation as a job for a confirmed strategy proposal", async () => {
    createGenerationJob.mockResolvedValue({ id: "job-1" });
    executeGenerationJob.mockImplementation(
      async (_id: string, work: () => Promise<unknown>) => {
        await work();
      },
    );
    generateStrategyWork.mockResolvedValue({ resultId: "s1" });

    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "strategy",
          summary: "Q3 plan",
          data: { name: "Q3 plan", seed: "Grow awareness" },
        },
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { resultId: string };
    expect(body.resultId).toBe("job-1");
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "strategy",
        userId: "u1",
        brandId: BRAND_ID,
      }),
    );
    expect(generateStrategyWork).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: "Grow awareness",
        conversationId: null,
      }),
    );
  });

  it("rejects a strategy proposal from an unverified user without creating a job", async () => {
    getAuthUser.mockResolvedValue({
      dbUser: {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@x.com",
        emailVerifiedAt: null,
      },
    });
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "strategy",
          summary: "Q3 plan",
          data: { name: "Q3 plan", seed: "Grow awareness" },
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("rejects a calendar proposal missing a strategyId without creating a job", async () => {
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "calendar",
          summary: "July calendar",
          data: {},
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("kicks off calendar generation as a job when the strategy is structured", async () => {
    getStrategyById.mockResolvedValue({
      id: STRATEGY_ID,
      brandId: BRAND_ID,
      structured: {
        campaignName: "Q3 plan",
        objective: "Grow awareness",
        targetAudience: "Everyone",
        keyMessage: "Buy now",
        channels: [{ name: "Instagram", rationale: "reach" }],
        contentMix: [{ type: "reel", count: 3 }],
        timeline: [{ phase: "launch", dateRange: "wk1", focus: "awareness" }],
        themes: [{ title: "Launch", description: "kickoff" }],
        postingSchedule: [{ channel: "Instagram", cadence: "daily" }],
      },
    });
    createGenerationJob.mockResolvedValue({ id: "job-2" });
    executeGenerationJob.mockImplementation(
      async (_id: string, work: () => Promise<unknown>) => {
        await work();
      },
    );
    generateCalendarWork.mockResolvedValue({ resultId: "c1" });

    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "calendar",
          summary: "July calendar",
          data: { strategyId: STRATEGY_ID },
        },
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { resultId: string };
    expect(body.resultId).toBe("job-2");
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calendar",
        userId: "u1",
        brandId: BRAND_ID,
        input: { strategyId: STRATEGY_ID },
      }),
    );
    expect(generateCalendarWork).toHaveBeenCalled();
  });

  it("404s a calendar proposal whose strategy belongs to a different brand", async () => {
    getStrategyById.mockResolvedValue({
      id: STRATEGY_ID,
      brandId: "other-brand",
      structured: {},
    });
    const res = await POST(
      req({
        brandId: BRAND_ID,
        proposal: {
          kind: "calendar",
          summary: "July calendar",
          data: { strategyId: STRATEGY_ID },
        },
      }),
    );
    expect(res.status).toBe(404);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });
});
