import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const createGenerationJob = vi.fn();
const getDesignGenerationById = vi.fn();
const getDesignSet = vi.fn();
const resolveDesignContext = vi.fn();
const regenerateFrameWork = vi.fn();
const checkDesignQuota = vi.fn();
const resolveDesignProviders = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (user: { verified?: boolean }) =>
    user.verified === false ? new Response(null, { status: 403 }) : null,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (input: unknown) => checkRateLimit(input),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
  getDesignGenerationById: (id: string) => getDesignGenerationById(id),
  getDesignSet: (brandId: string, id: string) => getDesignSet(brandId, id),
}));
vi.mock("@/lib/ai/image", () => ({
  resolveDesignProviders: () => resolveDesignProviders(),
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("@/lib/design/quota", () => ({
  checkDesignQuota: (...args: unknown[]) => checkDesignQuota(...args),
  quotaExceeded: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/storage", () => ({ isStorageConfigured: () => true }));
vi.mock("@/lib/jobs/run-design-sequence", () => ({
  contextRequestOf: (value: Record<string, unknown> | null) => ({
    briefId: value?.briefId ?? null,
    calendarItemId: null,
    attachments: [],
    freeform: value?.freeform ?? null,
    aspectRatio: null,
  }),
  regenerateFrameWork: (...args: unknown[]) => regenerateFrameWork(...args),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  executeGenerationJob: (
    _id: string,
    work: (runtime: unknown) => Promise<unknown>,
  ) => work({}),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: () => Promise.resolve("s1"),
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import { POST } from "./route";

const BRAND_ID = "aaaaaaaa-1111-4111-8111-11111111111b";
const FRAME_ID = "44444444-4444-4444-8444-444444444444";
const SET_ID = "55555555-5555-4555-8555-555555555555";

function frameRow(over: Record<string, unknown> = {}) {
  return {
    id: FRAME_ID,
    brandId: BRAND_ID,
    setId: SET_ID,
    frameIndex: 1,
    frameCount: 4,
    imageSource: "upload",
    rationale: { title: "The price", reasons: [], role: "body" },
    ...over,
  };
}

function post(body?: unknown, id = FRAME_ID) {
  return POST(
    new Request(`http://x/api/design/generations/${id}/regenerate-frame`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkRateLimit.mockResolvedValue({ ok: true });
  checkBrandAccess.mockResolvedValue({
    ok: true,
    brand: { id: BRAND_ID, workspaceId: "w1" },
  });
  getDesignGenerationById.mockResolvedValue(frameRow());
  getDesignSet.mockResolvedValue({
    id: SET_ID,
    brandId: BRAND_ID,
    request: { freeform: "Croissant week" },
  });
  resolveDesignProviders.mockReturnValue([{ id: "bedrock-stability" }]);
  resolveDesignContext.mockResolvedValue({ brand: { id: BRAND_ID } });
  checkDesignQuota.mockResolvedValue({ ok: true });
  createGenerationJob.mockResolvedValue({ id: "job-9" });
  regenerateFrameWork.mockResolvedValue({ result: {} });
});

afterEach(() => {
  process.env.FEATURE_MULTI_FRAME = "";
  process.env.FEATURE_KO_IMAGERY = "";
});

describe("POST /api/design/generations/[id]/regenerate-frame", () => {
  it("queues the frame with the user's edits as typed and returns 202", async () => {
    const res = await post({ edits: { headline: "  Only ₦600 a box " } });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-9" });
    expect(createGenerationJob).toHaveBeenCalledWith({
      kind: "design_render",
      userId: "u1",
      brandId: BRAND_ID,
      input: {
        regenerateFrame: FRAME_ID,
        edits: { headline: "Only ₦600 a box" },
      },
    });
    expect(regenerateFrameWork).toHaveBeenCalledWith(
      {
        context: { brand: { id: BRAND_ID } },
        userId: "u1",
        sessionId: "s1",
        generationId: FRAME_ID,
        edits: { headline: "Only ₦600 a box" },
      },
      expect.anything(),
    );
    expect(resolveDesignContext).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND_ID,
        freeform: "Croissant week",
      }),
    );
  });

  it("asks for a rewrite when no edits are sent, with or without a body", async () => {
    expect((await post()).status).toBe(202);
    expect((await post({})).status).toBe(202);
    expect((await post({ edits: {} })).status).toBe(202);
    for (const [args] of regenerateFrameWork.mock.calls) {
      expect(args.edits).toBeUndefined();
    }
  });

  it("charges one unit, checked before the job", async () => {
    checkDesignQuota.mockResolvedValue({ ok: false });
    const res = await post({});
    expect(res.status).toBe(429);
    expect(checkDesignQuota).toHaveBeenCalledWith("w1");
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("is not there with the flag off", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    const res = await post({});
    expect(res.status).toBe(404);
    expect(getAuthUser).not.toHaveBeenCalled();
  });

  it("needs a signed-in, verified user under the rate limit", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await post({})).status).toBe(401);
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1", verified: false } });
    expect((await post({})).status).toBe(403);
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkRateLimit.mockResolvedValue({ ok: false });
    expect((await post({})).status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "design-generate:u1",
      limit: 15,
      windowSeconds: 3600,
    });
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("answers 404 alike for a malformed, unknown or foreign id", async () => {
    expect((await post({}, "not-a-uuid")).status).toBe(404);
    getDesignGenerationById.mockResolvedValue(null);
    expect((await post({})).status).toBe(404);
    getDesignGenerationById.mockResolvedValue(frameRow());
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "No access",
    });
    const foreign = await post({});
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Design not found" });
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      BRAND_ID,
      "manage_content",
    );
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("refuses a design that is not a frame of a set", async () => {
    getDesignGenerationById.mockResolvedValue(
      frameRow({ setId: null, frameIndex: null, frameCount: null }),
    );
    const res = await post({});
    expect(res.status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("answers 404 when the set's plan is gone", async () => {
    getDesignSet.mockResolvedValue(null);
    expect((await post({})).status).toBe(404);
  });

  it("refuses a button on any frame but the last", async () => {
    const res = await post({ edits: { cta: "Order now" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Only the last frame carries a button.",
    });
    getDesignGenerationById.mockResolvedValue(
      frameRow({
        frameIndex: 3,
        rationale: { title: "Order", reasons: [], role: "cta" },
      }),
    );
    expect((await post({ edits: { cta: "Order now" } })).status).toBe(202);
  });

  it("refuses edits it cannot draw as typed", async () => {
    const bad = [
      "{not json",
      { edits: "Only ₦600" },
      { edits: { headline: 42 } },
      { edits: { title: "x" } },
      { edits: { headline: "   " } },
      { edits: { headline: "x".repeat(71) } },
      { edits: { subheadline: "x".repeat(141) } },
    ];
    for (const body of bad) {
      expect((await post(body)).status).toBe(400);
    }
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("allows an emptied subheadline: a frame may drop it", async () => {
    expect((await post({ edits: { subheadline: "" } })).status).toBe(202);
    expect(regenerateFrameWork.mock.calls[0][0].edits).toEqual({
      subheadline: "",
    });
  });

  it("refuses a KO frame while KO imagery is off", async () => {
    getDesignGenerationById.mockResolvedValue(frameRow({ imageSource: "ko" }));
    const res = await post({});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ko_imagery_disabled" });
    process.env.FEATURE_KO_IMAGERY = "1";
    resolveDesignProviders.mockReturnValue([]);
    expect((await post({})).status).toBe(503);
  });
});
