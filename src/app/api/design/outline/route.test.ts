import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* POST /api/design/outline (KOOS-AI-002, rubric Addendum A, O1 and O7).
   The planner is doubled: these pin the route's gates and what it hands
   back, not what an outline says. */

const getAuthUser = vi.fn();
const requireVerifiedEmail = vi.fn();
const checkRateLimit = vi.fn();
const checkBrandAccess = vi.fn();
const resolveDesignContext = vi.fn();
const buildMemoryBlock = vi.fn();
const planOutline = vi.fn();
const checkDesignQuota = vi.fn();
const createGenerationJob = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (dbUser: unknown) => requireVerifiedEmail(dbUser),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("@/lib/ai/memory", () => ({
  buildMemoryBlock: (brandId: string) => buildMemoryBlock(brandId),
}));
vi.mock("@/lib/design/sequence/outline-plan", () => ({
  planOutline: (input: unknown) => planOutline(input),
}));
/* Any quota read fails the test: the outline makes no design (O1). */
vi.mock("@/lib/design/quota", () => ({
  checkDesignQuota: (...args: unknown[]) => checkDesignQuota(...args),
}));

import type {
  OutlinePoint,
  PlannedOutline,
} from "@/lib/design/sequence/contract";
import { OUTLINE_RATE_LIMIT } from "@/lib/design/sequence/contract";
import { POST } from "./route";

const BRAND_ID = "aaaaaaaa-1111-4111-8111-11111111111b";
const BRIEF_ID = "bbbbbbbb-2222-4222-8222-22222222222c";
const BRIEF_TEXT = "Almond croissants at Crumb & Co., ₦2,500 each";

function post(body: unknown) {
  return POST(
    new Request("http://x/api/design/outline", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const ask = (over: Record<string, unknown> = {}) =>
  post({ brandId: BRAND_ID, briefId: BRIEF_ID, ...over });

function contextOf(designType: string | null, slides: number | null = null) {
  resolveDesignContext.mockResolvedValue({
    brand: { id: BRAND_ID },
    designType,
    slides,
    briefText: BRIEF_TEXT,
  });
}

function point(i: number, n: number, over: Partial<OutlinePoint> = {}) {
  return {
    id: `p${i + 1}`,
    role: i === 0 ? "hook" : i === n - 1 ? "cta" : "body",
    title: `Point ${i + 1}`,
    point: `The point of frame ${i + 1}.`,
    source: "brief",
    facts: [],
    weak: null,
    ...over,
  } as OutlinePoint;
}

function outlineOf(n: number, points?: OutlinePoint[]): PlannedOutline {
  const all = points ?? Array.from({ length: n }, (_, i) => point(i, n));
  return {
    kind: "carousel",
    frameCount: all.length,
    points: all,
    offering: "almond croissants",
    facts: ["₦2,500 each"],
  };
}

type Spy = { mock: { calls: unknown[][] }; mockRestore: () => void };
let info: Spy;
let error: Spy;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  requireVerifiedEmail.mockReturnValue(null);
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  checkBrandAccess.mockResolvedValue({
    ok: true,
    brand: { id: BRAND_ID, workspaceId: "w1" },
  });
  buildMemoryBlock.mockResolvedValue("likes warm colours");
  contextOf("Instagram carousel", 4);
  planOutline.mockImplementation(async (input: { frameCount: number }) => ({
    outline: outlineOf(input.frameCount),
    modelCalls: 1,
    ms: 1200,
  }));
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.FEATURE_MULTI_FRAME = "";
  info.mockRestore();
  error.mockRestore();
});

describe("design outline route, gates", () => {
  it("is a 404 with the flag off, before auth or any read (O7)", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    const res = await ask();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not signed in", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await ask();
    expect(res.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses an unverified email before the rate limit", async () => {
    requireVerifiedEmail.mockReturnValue(new Response(null, { status: 403 }));
    expect((await ask()).status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("is rate-limited per user at 30 an hour, before any read", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const res = await ask();
    expect(res.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "design-outline:u1",
      limit: OUTLINE_RATE_LIMIT.limit,
      windowSeconds: OUTLINE_RATE_LIMIT.windowSeconds,
    });
    expect(OUTLINE_RATE_LIMIT).toEqual({ limit: 30, windowSeconds: 3600 });
    expect(checkBrandAccess).not.toHaveBeenCalled();
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON, or not an object", async () => {
    for (const body of ["{not json", "null", "7"]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request body" });
    }
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses each malformed field with generate's own message", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ brandId: "nope" }, "Missing or invalid brandId"],
      [{ briefId: "nope" }, "Invalid briefId"],
      [{ calendarItemId: "nope" }, "Invalid calendarItemId"],
      [{ attachments: "nope" }, "Invalid attachments"],
      [
        {
          attachments: Array.from({ length: 11 }, () => ({
            type: "asset",
            id: BRIEF_ID,
          })),
        },
        "Attach at most 10 items.",
      ],
      [
        { freeform: "x".repeat(1001) },
        "Prompt must be 1000 characters or fewer",
      ],
      [{ aspectRatio: "7:3" }, "Invalid aspectRatio"],
      [{ frames: 0 }, "Invalid frames"],
      [{ frames: 2.5 }, "Invalid frames"],
      [{ frames: "5" }, "Invalid frames"],
    ];
    for (const [over, message] of cases) {
      const res = await ask(over);
      expect(res.status, message).toBe(400);
      expect(await res.json()).toEqual({ error: message });
    }
    expect(checkBrandAccess).not.toHaveBeenCalled();
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses another brand's caller with the access check's own status", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const res = await ask();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      BRAND_ID,
      "manage_content",
    );
    expect(resolveDesignContext).not.toHaveBeenCalled();
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("is a 404 when the brief cannot be resolved", async () => {
    const { DesignContextError } = await import("@/lib/design/context");
    resolveDesignContext.mockRejectedValue(
      new DesignContextError("Brief not found"),
    );
    const res = await ask();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Brief not found" });
    expect(planOutline).not.toHaveBeenCalled();
  });

  it("refuses a brief that is not a carousel or presentation", async () => {
    contextOf("Instagram post", 4);
    const res = await ask();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Only a carousel or presentation has an outline.",
    });
    expect(planOutline).not.toHaveBeenCalled();
  });
});

describe("design outline route, the outline", () => {
  it("plans the brief's own count and returns exactly that many points (O1)", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    const { outline } = (await res.json()) as { outline: PlannedOutline };
    expect(outline.frameCount).toBe(4);
    expect(outline.points.map((p) => p.role)).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect(planOutline).toHaveBeenCalledWith({
      context: expect.objectContaining({ designType: "Instagram carousel" }),
      kind: "carousel",
      frameCount: 4,
      memorySummary: "likes warm colours",
    });
    expect(resolveDesignContext).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      briefId: BRIEF_ID,
      calendarItemId: undefined,
      attachments: [],
      freeform: undefined,
      aspectRatio: null,
    });
  });

  it("takes the request's count over the brief's, clamped to FRAME_BOUNDS", async () => {
    await ask({ frames: 7 });
    expect(planOutline.mock.calls[0][0].frameCount).toBe(7);
    await ask({ frames: 40 });
    expect(planOutline.mock.calls[1][0].frameCount).toBe(10);
    await ask({ frames: 1 });
    expect(planOutline.mock.calls[2][0].frameCount).toBe(2);
  });

  it("falls back to the format's default, and plans a presentation by its own bounds", async () => {
    contextOf("Instagram carousel", null);
    await ask();
    expect(planOutline.mock.calls[0][0]).toMatchObject({
      kind: "carousel",
      frameCount: 5,
    });
    contextOf("Pitch deck", 30);
    await ask();
    expect(planOutline.mock.calls[1][0]).toMatchObject({
      kind: "presentation",
      frameCount: 12,
    });
  });

  it("spends no quota and starts no job (O1)", async () => {
    await ask();
    expect(checkDesignQuota).not.toHaveBeenCalled();
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("returns the weak flags the planner's code set, and counts them in one trace line", async () => {
    planOutline.mockResolvedValue({
      outline: outlineOf(4, [
        point(0, 4),
        point(1, 4, {
          weak: { kind: "filler", reason: "Only says when it happens." },
        }),
        point(2, 4, {
          source: "profile",
          weak: {
            kind: "overlap",
            reason: "Says the same as point 2.",
            overlapsWith: "p2",
          },
        }),
        point(3, 4),
      ]),
      modelCalls: 1,
      ms: 900,
    });
    const { outline } = (await (await ask()).json()) as {
      outline: PlannedOutline;
    };
    expect(outline.points[2].weak).toEqual({
      kind: "overlap",
      reason: "Says the same as point 2.",
      overlapsWith: "p2",
    });
    const lines = info.mock.calls.filter(
      (c) => c[0] === "design.outline.planned",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({
      kind: "carousel",
      frames: 4,
      weak: { overlap: 1, filler: 1, profileFill: 0 },
      modelCalls: 1,
      ms: 900,
    });
    expect(JSON.stringify(lines[0])).not.toContain("croissant");
  });

  it("is a 502 with a retryable message when the planner throws", async () => {
    planOutline.mockRejectedValue(new Error("model timed out"));
    const res = await ask();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/couldn't plan an outline/);
    expect(error).toHaveBeenCalledWith(
      "design.outline.failed",
      expect.objectContaining({ error: "model timed out" }),
    );
  });

  it("never hands the editor an outline that breaks its shape", async () => {
    const broken: PlannedOutline[] = [
      outlineOf(3),
      outlineOf(4, [
        point(0, 4, { role: "body" }),
        ...[1, 2, 3].map((i) => point(i, 4)),
      ]),
      outlineOf(4, [
        point(0, 4),
        point(1, 4, { id: "p9" }),
        point(2, 4),
        point(3, 4),
      ]),
      outlineOf(4, [
        point(0, 4),
        point(1, 4, { source: "user" }),
        point(2, 4),
        point(3, 4),
      ]),
    ];
    for (const outline of broken) {
      planOutline.mockResolvedValueOnce({ outline, modelCalls: 1, ms: 1 });
      const res = await ask();
      expect(res.status).toBe(502);
    }
  });

  it("states frameCount as the points it holds", async () => {
    planOutline.mockResolvedValue({
      outline: { ...outlineOf(4), frameCount: 9 },
      modelCalls: 1,
      ms: 1,
    });
    const { outline } = (await (await ask()).json()) as {
      outline: PlannedOutline;
    };
    expect(outline.frameCount).toBe(4);
  });
});
