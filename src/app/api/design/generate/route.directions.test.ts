import { beforeEach, describe, expect, it, vi } from "vitest";

/* The KO path runs behind FEATURE_KO_IMAGERY (round 8); its tests run with
   the flag on. */
process.env.FEATURE_KO_IMAGERY = "1";

/* The FEAT-033 request fields. Kept apart from route.test.ts so that file,
   which pins the behaviour every existing caller relies on, stays exactly as
   it was. */

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const createGenerationJob = vi.fn();
const getDesignGenerationById = vi.fn();
const resolveDesignProviders = vi.fn();
const resolveDesignContext = vi.fn();
const generateDesignWork = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  createGenerationJob: (data: unknown) => createGenerationJob(data),
  getDesignGenerationById: (id: string) => getDesignGenerationById(id),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: () => null,
}));
vi.mock("@/lib/ai/image", () => ({
  resolveDesignProviders: () => resolveDesignProviders(),
}));
vi.mock("@/lib/design/context", () => ({
  resolveDesignContext: (args: unknown) => resolveDesignContext(args),
  DesignContextError: class DesignContextError extends Error {},
}));
vi.mock("@/lib/design/quota", () => ({
  checkDesignQuota: async () => ({ ok: true }),
  quotaExceeded: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/storage", () => ({
  isStorageConfigured: () => true,
  getObjectBytes: vi.fn(),
  ObjectTooLargeError: class extends Error {},
  STORAGE_PREFIXES: { designImages: "design-images" },
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  executeGenerationJob: (
    _id: string,
    work: (runtime: unknown) => Promise<unknown>,
  ) => work({}),
}));
vi.mock("@/lib/jobs/run-design-generation", () => ({
  generateDesignWork: (...args: unknown[]) => generateDesignWork(...args),
}));
vi.mock("@/lib/analytics/session-id", () => ({
  getAnalyticsSessionId: () => Promise.resolve("s1"),
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import { IMAGE_NOT_USABLE_PREFIX } from "@/lib/uploads/design-image-limits";
import { POST } from "./route";

const BRAND_ID = "aaaaaaaa-1111-4111-8111-11111111111b";
const OTHER_BRAND = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const OWN_KEY = `design-images/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.jpg`;

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://x/api/design/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: BRAND_ID, ...body }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({
    ok: true,
    brand: { id: BRAND_ID, workspaceId: "w1" },
  });
  resolveDesignProviders.mockReturnValue([{ id: "bedrock-stability" }]);
  resolveDesignContext.mockResolvedValue({ brand: { id: BRAND_ID } });
  createGenerationJob.mockResolvedValue({ id: "job-1" });
  getDesignGenerationById.mockResolvedValue({
    id: GENERATION,
    brandId: BRAND_ID,
    rationale: {
      title: "Morning bake",
      reasons: ["a", "b"],
      set: "s1",
      slot: 0,
    },
  });
  generateDesignWork.mockResolvedValue({ result: {} });
});

describe("design generate route, image choice", () => {
  it("passes an upload of this brand through to the directions path", async () => {
    const res = await post({ image: { source: "upload", key: OWN_KEY } });
    expect(res.status).toBe(202);
    expect(generateDesignWork).toHaveBeenCalledWith(
      expect.objectContaining({
        directions: {
          image: { source: "upload", key: OWN_KEY },
          regenerateOf: null,
        },
      }),
      expect.anything(),
    );
    expect(createGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          image: { source: "upload", key: OWN_KEY },
        }),
      }),
    );
  });

  it("passes the KO imagery choice through", async () => {
    expect((await post({ image: { source: "ko" } })).status).toBe(202);
    expect(generateDesignWork.mock.calls[0][0].directions.image).toEqual({
      source: "ko",
    });
  });

  /* Oluwaseyi's ruling, round 8: KO imagery is behind FEATURE_KO_IMAGERY,
     default off. */
  it("refuses KO imagery with the flag off, before any job", async () => {
    process.env.FEATURE_KO_IMAGERY = "";
    try {
      const res = await post({ image: { source: "ko" } });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "ko_imagery_disabled" });
      expect(createGenerationJob).not.toHaveBeenCalled();
      expect(generateDesignWork).not.toHaveBeenCalled();
    } finally {
      process.env.FEATURE_KO_IMAGERY = "1";
    }
  });

  it("passes a no-photo, text-led choice through without an image model", async () => {
    expect((await post({ image: { source: "none" } })).status).toBe(202);
    expect(generateDesignWork.mock.calls[0][0].directions.image).toEqual({
      source: "none",
    });
  });

  it("sends no directions request when the caller sends no image", async () => {
    await post({});
    expect(generateDesignWork.mock.calls[0][0]).not.toHaveProperty(
      "directions",
    );
  });

  it.each([
    ["a string", "ko"],
    ["an unknown source", { source: "stock" }],
    ["an upload without a key", { source: "upload" }],
    ["a numeric key", { source: "upload", key: 7 }],
  ])("rejects %s", async (_label, image) => {
    expect((await post({ image })).status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another brand's upload",
      `design-images/${OTHER_BRAND}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
    ],
    [
      "a key outside design-images",
      `logos/${BRAND_ID}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
    ],
    ["a traversal", `design-images/${BRAND_ID}/../${OTHER_BRAND}/x.png`],
    [
      "a nested path",
      `design-images/${BRAND_ID}/a/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
    ],
    [
      "an uppercase brand id",
      `design-images/${BRAND_ID.toUpperCase()}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
    ],
  ])("refuses %s before any job exists", async (_label, key) => {
    const res = await post({ image: { source: "upload", key } });
    expect(res.status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  /* Round-1 regression: the refusal said "This image was not uploaded for
     this brand.", which the UI does not recognise as an unusable image, so
     the user got a generic error instead of the choose-another-image state. */
  it("refuses a foreign key in the loader's words, which the UI recognises", async () => {
    const res = await post({
      image: {
        source: "upload",
        key: `design-images/${OTHER_BRAND}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
      },
    });
    const { error } = await res.json();
    expect(error.startsWith(IMAGE_NOT_USABLE_PREFIX)).toBe(true);
    expect(error).toContain("not uploaded for this brand");
  });

  /* Postgres matches an uppercase UUID to the row, so the request string can
     differ from the stored id. A key minted for the request's spelling is not
     one this app ever wrote. */
  it("checks the key against the brand row, not the request string", async () => {
    const shouted = BRAND_ID.toUpperCase();
    const res = await post({
      brandId: shouted,
      image: {
        source: "upload",
        key: `design-images/${shouted}/2b1e0c8e-0b6a-4b0e-9a37-3a3c1f0a7d11.png`,
      },
    });
    expect(res.status).toBe(400);
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("needs no image model for an upload", async () => {
    resolveDesignProviders.mockReturnValue([]);
    expect(
      (await post({ image: { source: "upload", key: OWN_KEY } })).status,
    ).toBe(202);
    expect((await post({ image: { source: "ko" } })).status).toBe(503);
  });
});

describe("design generate route, regenerateOf", () => {
  it("passes a direction of this brand through", async () => {
    const res = await post({
      image: { source: "ko" },
      regenerateOf: GENERATION,
    });
    expect(res.status).toBe(202);
    expect(generateDesignWork.mock.calls[0][0].directions).toEqual({
      image: { source: "ko" },
      regenerateOf: GENERATION,
    });
  });

  it("requires an image choice", async () => {
    expect((await post({ regenerateOf: GENERATION })).status).toBe(400);
    expect(getDesignGenerationById).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    expect(
      (await post({ image: { source: "ko" }, regenerateOf: "nope" })).status,
    ).toBe(400);
  });

  it.each([
    ["a variant row", null],
    ["a rationale without a set", { title: "Old", reasons: ["a", "b"] }],
  ])("refuses to regenerate %s", async (_label, rationale) => {
    getDesignGenerationById.mockResolvedValueOnce({
      id: GENERATION,
      brandId: BRAND_ID,
      rationale,
    });
    const res = await post({
      image: { source: "ko" },
      regenerateOf: GENERATION,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Only a design direction can be regenerated.",
    );
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it("answers another brand's design exactly as a missing one", async () => {
    getDesignGenerationById.mockResolvedValueOnce({
      id: GENERATION,
      brandId: OTHER_BRAND,
    });
    const foreign = await post({
      image: { source: "ko" },
      regenerateOf: GENERATION,
    });
    getDesignGenerationById.mockResolvedValueOnce(null);
    const missing = await post({
      image: { source: "ko" },
      regenerateOf: GENERATION,
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(createGenerationJob).not.toHaveBeenCalled();
  });
});
