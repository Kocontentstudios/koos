import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* KOOS-AI-002: a carousel or presentation brief with an image choice is
   built as a set of frames when FEATURE_MULTI_FRAME is on. Kept apart from
   route.test.ts and route.directions.test.ts so those, which pin what every
   existing caller relies on, stay exactly as they were. */

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const createGenerationJob = vi.fn();
const resolveDesignContext = vi.fn();
const generateDesignWork = vi.fn();
const executeGenerationJob = vi.fn();
const checkDesignQuota = vi.fn();
const countDesignGenerationsForWorkspace = vi.fn();
const countReservedDesignUnitsForWorkspace = vi.fn();
const sweepAbandonedDesignSets = vi.fn();
const frameCountNotice = vi.fn();
const validateApprovedOutline = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
  getDesignGenerationById: vi.fn(),
  countDesignGenerationsForWorkspace: (workspaceId: string, since: Date) =>
    countDesignGenerationsForWorkspace(workspaceId, since),
  countReservedDesignUnitsForWorkspace: (workspaceId: string, since: Date) =>
    countReservedDesignUnitsForWorkspace(workspaceId, since),
}));
vi.mock("@/lib/jobs/run-design-sequence", () => ({
  sweepAbandonedDesignSets: (workspaceId: string) =>
    sweepAbandonedDesignSets(workspaceId),
  frameCountNotice: (kind: string, frames: number, asked: number | null) =>
    frameCountNotice(kind, frames, asked),
}));
vi.mock("@/lib/design/sequence/outline-validate", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/design/sequence/outline-validate")
  >()),
  validateApprovedOutline: (raw: unknown, ctx: unknown) =>
    validateApprovedOutline(raw, ctx),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: () => null,
}));
vi.mock("@/lib/ai/image", () => ({
  resolveDesignProviders: () => [{ id: "bedrock-stability" }],
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("@/lib/design/quota", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/design/quota")>();
  return {
    ...real,
    checkDesignQuota: (...args: Parameters<typeof real.checkDesignQuota>) => {
      checkDesignQuota(...args);
      return real.checkDesignQuota(...args);
    },
  };
});
vi.mock("@/lib/storage", () => ({
  isStorageConfigured: () => true,
  getObjectBytes: vi.fn(),
  ObjectTooLargeError: class extends Error {},
  STORAGE_PREFIXES: { designImages: "design-images" },
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  executeGenerationJob: (
    id: string,
    work: (runtime: unknown) => Promise<unknown>,
    options?: unknown,
  ) => {
    executeGenerationJob(id, options);
    return work({});
  },
}));
vi.mock("@/lib/jobs/run-design-generation", () => ({
  generateDesignWork: (...args: unknown[]) => generateDesignWork(...args),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: () => Promise.resolve("s1"),
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import { SEQUENCE_SLICE_BUDGET_MS } from "@/lib/jobs/stale";
import { POST } from "./route";

const BRAND_ID = "aaaaaaaa-1111-4111-8111-11111111111b";
const OWN_KEY = `design-images/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.jpg`;
const UPLOAD = { source: "upload", key: OWN_KEY };

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://x/api/design/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, ...body }),
    }),
  );
}

function contextOf(designType: string | null, slides: number | null = null) {
  resolveDesignContext.mockResolvedValue({
    brand: { id: BRAND_ID },
    designType,
    slides,
    briefText: "Croissant week at Crumb & Co.",
    brandSummary: { name: "Crumb & Co.", offer: "A Lekki bakery." },
  });
}

const jobInput = () => createGenerationJob.mock.calls[0][0].input;
const workArgs = () => generateDesignWork.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FEATURE_MULTI_FRAME = "1";
  delete process.env.DESIGN_GENERATION_MONTHLY_QUOTA;
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({
    ok: true,
    brand: { id: BRAND_ID, workspaceId: "w1" },
  });
  countDesignGenerationsForWorkspace.mockResolvedValue(0);
  countReservedDesignUnitsForWorkspace.mockResolvedValue(0);
  sweepAbandonedDesignSets.mockResolvedValue(0);
  frameCountNotice.mockImplementation(
    (kind: string, frames: number, asked: number | null) =>
      asked === frames ? null : `${kind}:${frames}:${asked}`,
  );
  createGenerationJob.mockResolvedValue({ id: "job-1" });
  generateDesignWork.mockResolvedValue({ result: {} });
  contextOf("Instagram carousel", 4);
  validateApprovedOutline.mockImplementation(
    (raw: { kind: string; points: unknown[] }) => ({
      ok: true,
      outline: { kind: raw.kind, points: raw.points },
    }),
  );
});

afterEach(() => {
  process.env.FEATURE_MULTI_FRAME = "";
});

describe("design generate route, sets of frames", () => {
  it("builds a set with the brief's slide count, on a resumable slice", async () => {
    const res = await post({ image: UPLOAD, freeform: "Croissant week" });
    expect(res.status).toBe(202);
    expect(jobInput()).toEqual({
      briefId: null,
      calendarItemId: null,
      attachments: [],
      image: UPLOAD,
      regenerateOf: null,
      sequence: { frames: 4, asked: 4 },
      freeform: "Croissant week",
      aspectRatio: null,
    });
    expect(workArgs()).toMatchObject({
      directions: { image: UPLOAD, regenerateOf: null },
      sequence: {
        frames: 4,
        contextRequest: { freeform: "Croissant week", attachments: [] },
      },
    });
    expect(executeGenerationJob).toHaveBeenCalledWith("job-1", {
      softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS,
    });
  });

  it("takes the request's frame count over the brief's", async () => {
    await post({ image: UPLOAD, frames: 7 });
    expect(jobInput().sequence).toEqual({ frames: 7, asked: 7 });
  });

  it("clamps the count to what one job delivers", async () => {
    await post({ image: UPLOAD, frames: 40 });
    expect(jobInput().sequence).toEqual({ frames: 10, asked: 40 });
    vi.clearAllMocks();
    createGenerationJob.mockResolvedValue({ id: "job-2" });
    await post({ image: UPLOAD, frames: 1 });
    expect(jobInput().sequence).toEqual({ frames: 2, asked: 1 });
  });

  it("falls back to the format's default count when nothing gives one", async () => {
    contextOf("Instagram carousel", null);
    await post({ image: UPLOAD });
    expect(jobInput().sequence).toEqual({ frames: 5, asked: null });
  });

  it("builds a presentation as a set too", async () => {
    contextOf("Pitch deck", 30);
    await post({ image: { source: "none" } });
    expect(jobInput().sequence).toEqual({ frames: 12, asked: 30 });
  });

  it("refuses a frame count that is not a whole positive number", async () => {
    for (const frames of [0, -3, 2.5, "7", 1000]) {
      const res = await post({ image: UPLOAD, frames });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid frames" });
    }
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("checks quota for every frame before the job, naming the shortfall", async () => {
    process.env.DESIGN_GENERATION_MONTHLY_QUOTA = "10";
    countDesignGenerationsForWorkspace.mockResolvedValue(6);
    const res = await post({ image: UPLOAD, frames: 7 });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(
      /^This carousel needs 7 designs; this workspace has 4 left this month\./,
    );
    expect(body).toMatchObject({ used: 6, limit: 10, requested: 7 });
    expect(checkDesignQuota).toHaveBeenLastCalledWith(
      "w1",
      expect.any(Date),
      7,
    );
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("counts the frames a set still in flight is owed, so two sets cannot share the last units", async () => {
    process.env.DESIGN_GENERATION_MONTHLY_QUOTA = "10";
    countDesignGenerationsForWorkspace.mockResolvedValue(3);
    countReservedDesignUnitsForWorkspace.mockResolvedValue(4);
    const res = await post({ image: UPLOAD, frames: 7 });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ used: 7, requested: 7 });
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("settles the workspace's abandoned sets before any quota check", async () => {
    const order: string[] = [];
    sweepAbandonedDesignSets.mockImplementation(async () => {
      order.push("sweep");
      return 0;
    });
    checkDesignQuota.mockImplementation(() => order.push("quota"));
    await post({ image: UPLOAD, frames: 4 });
    expect(sweepAbandonedDesignSets).toHaveBeenCalledWith("w1");
    expect(order[0]).toBe("sweep");
    expect(order.slice(1)).toEqual(["quota", "quota"]);
  });

  it("tells the client the size of the set, and why when it was clamped", async () => {
    const clamped = await post({ image: UPLOAD, frames: 40 });
    expect(await clamped.json()).toEqual({
      jobId: "job-1",
      frames: 10,
      notice: "carousel:10:40",
    });
    const asked = await post({ image: UPLOAD, frames: 6 });
    expect(await asked.json()).toEqual({
      jobId: "job-1",
      frames: 6,
      notice: null,
    });
  });

  it("lets a set through when the workspace can pay for every frame", async () => {
    process.env.DESIGN_GENERATION_MONTHLY_QUOTA = "10";
    countDesignGenerationsForWorkspace.mockResolvedValue(3);
    const res = await post({ image: UPLOAD, frames: 7 });
    expect(res.status).toBe(202);
  });
});

describe("design generate route, what stays a single design", () => {
  it("ignores frames and builds no set with the flag off", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    const res = await post({ image: UPLOAD, frames: "not a number" });
    expect(res.status).toBe(202);
    expect(jobInput()).not.toHaveProperty("sequence");
    expect(jobInput()).not.toHaveProperty("freeform");
    expect(workArgs()).not.toHaveProperty("sequence");
    expect(executeGenerationJob).toHaveBeenCalledWith("job-1", undefined);
    expect(checkDesignQuota).toHaveBeenCalledTimes(1);
    expect(checkDesignQuota).toHaveBeenCalledWith("w1");
    expect(sweepAbandonedDesignSets).not.toHaveBeenCalled();
    expect(countReservedDesignUnitsForWorkspace).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ jobId: "job-1" });
  });

  it("builds no set for a single-image format", async () => {
    contextOf("Instagram post", 4);
    await post({ image: UPLOAD, frames: 4 });
    expect(jobInput()).not.toHaveProperty("sequence");
    expect(workArgs()).not.toHaveProperty("sequence");
    expect(checkDesignQuota).toHaveBeenCalledTimes(1);
  });

  it("builds no set without an image choice", async () => {
    process.env.FEATURE_KO_IMAGERY = "1";
    try {
      await post({ frames: 4 });
      expect(jobInput()).not.toHaveProperty("sequence");
      expect(workArgs()).not.toHaveProperty("sequence");
    } finally {
      process.env.FEATURE_KO_IMAGERY = "";
    }
  });
});

function outline(n: number, source = "brief") {
  return {
    kind: "carousel",
    points: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      role: i === 0 ? "hook" : i === n - 1 ? "cta" : "body",
      title: `Point ${i + 1}`,
      point: `What frame ${i + 1} says.`,
      source,
    })),
  };
}

describe("design generate route, an approved outline (O4)", () => {
  it("validates the outline against the brief's kind, brief, profile and brand name, never the client's sources", async () => {
    const sent = outline(4, "user");
    const res = await post({ image: UPLOAD, approvedOutline: sent });
    expect(res.status).toBe(202);
    expect(validateApprovedOutline).toHaveBeenCalledWith(sent, {
      kind: "carousel",
      briefText: "Croissant week at Crumb & Co.",
      profileStatements: ["A Lekki bakery."],
      brandName: "Crumb & Co.",
    });
  });

  it("puts the validated outline, not the raw one, on the job and the work", async () => {
    const validated = {
      ...outline(4),
      points: outline(4).points.map((p) => ({ ...p, title: p.title.trim() })),
    };
    validateApprovedOutline.mockReturnValue({ ok: true, outline: validated });
    await post({
      image: UPLOAD,
      approvedOutline: { ...outline(4, "user"), extra: "stripped" },
    });
    expect(jobInput().sequence).toEqual({
      frames: 4,
      asked: 4,
      approvedOutline: validated,
    });
    expect(workArgs().sequence).toMatchObject({
      frames: 4,
      approvedOutline: validated,
    });
  });

  it("sizes the set by the approved points, over a frames field and the brief's count", async () => {
    contextOf("Instagram carousel", 8);
    const res = await post({
      image: UPLOAD,
      frames: 9,
      approvedOutline: outline(6),
    });
    expect(res.status).toBe(202);
    expect(jobInput().sequence).toMatchObject({ frames: 6, asked: 6 });
    expect(await res.json()).toEqual({
      jobId: "job-1",
      frames: 6,
      notice: null,
    });
  });

  it("refuses an invalid outline with its problems, before quota or any job", async () => {
    const problems = [
      { point: 0, rule: "hook-first", detail: "point 1 is body" },
      { point: 2, rule: "markup", detail: "point 3 holds <" },
    ];
    validateApprovedOutline.mockReturnValue({ ok: false, problems });
    const res = await post({ image: UPLOAD, approvedOutline: outline(4) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid outline", problems });
    expect(checkDesignQuota).toHaveBeenCalledTimes(1);
    expect(createGenerationJob).not.toHaveBeenCalled();
    expect(generateDesignWork).not.toHaveBeenCalled();
  });

  it("checks quota for the approved count, and names it in the shortfall", async () => {
    process.env.DESIGN_GENERATION_MONTHLY_QUOTA = "10";
    countDesignGenerationsForWorkspace.mockResolvedValue(6);
    const res = await post({
      image: UPLOAD,
      frames: 3,
      approvedOutline: outline(7),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(
      /^This carousel needs 7 designs; this workspace has 4 left this month\./,
    );
    expect(body).toMatchObject({ requested: 7 });
    expect(checkDesignQuota).toHaveBeenLastCalledWith(
      "w1",
      expect.any(Date),
      7,
    );
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("lets a deleted point lower the bill: five approved of a planned six spend five", async () => {
    process.env.DESIGN_GENERATION_MONTHLY_QUOTA = "10";
    countDesignGenerationsForWorkspace.mockResolvedValue(5);
    const res = await post({ image: UPLOAD, approvedOutline: outline(5) });
    expect(res.status).toBe(202);
    expect(checkDesignQuota).toHaveBeenLastCalledWith(
      "w1",
      expect.any(Date),
      5,
    );
  });

  it("refuses an unauthenticated caller before reading the outline", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await post({ image: UPLOAD, approvedOutline: outline(4) });
    expect(res.status).toBe(401);
    expect(validateApprovedOutline).not.toHaveBeenCalled();
  });

  it("refuses another brand's caller before reading the outline", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await post({ image: UPLOAD, approvedOutline: outline(4) });
    expect(res.status).toBe(404);
    expect(validateApprovedOutline).not.toHaveBeenCalled();
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("ignores the outline with the flag off, as any unknown field (O7, H6)", async () => {
    process.env.FEATURE_MULTI_FRAME = "";
    const res = await post({ image: UPLOAD, approvedOutline: { junk: true } });
    expect(res.status).toBe(202);
    expect(validateApprovedOutline).not.toHaveBeenCalled();
    expect(jobInput()).not.toHaveProperty("sequence");
    expect(workArgs()).not.toHaveProperty("sequence");
  });

  it("ignores the outline for a single-image format", async () => {
    contextOf("Instagram post", 4);
    const single = await post({ image: UPLOAD, approvedOutline: outline(4) });
    expect(single.status).toBe(202);
    expect(jobInput()).not.toHaveProperty("sequence");
    expect(validateApprovedOutline).not.toHaveBeenCalled();
  });

  it("plans without an outline when none is sent, exactly as before", async () => {
    await post({ image: UPLOAD, frames: 4 });
    expect(validateApprovedOutline).not.toHaveBeenCalled();
    expect(jobInput().sequence).toEqual({ frames: 4, asked: 4 });
    expect(workArgs().sequence).not.toHaveProperty("approvedOutline");
  });
});
