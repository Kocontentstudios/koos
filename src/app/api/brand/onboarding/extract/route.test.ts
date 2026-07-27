import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...args: unknown[]) => checkBrandAccess(...args),
}));
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({}) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/brand/onboarding/extract", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST onboarding extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: BRAND_ID } });
    generateObject.mockResolvedValue({
      object: { fields: { tone: "warm" }, summary: "Captured tone" },
    });
  });

  it("returns a brand_fields proposal from a transcript", async () => {
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "We're friendly and warm." }),
    );
    const body = await res.json();
    expect(body.proposal.kind).toBe("brand_fields");
    expect(body.proposal.data.fields.tone).toBe("warm");
  });

  it("returns 401 when unauthenticated", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "We're friendly and warm." }),
    );
    expect(res.status).toBe(401);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects an invalid body with 400", async () => {
    const res = await POST(req({ brandId: "not-a-uuid", transcript: "hi" }));
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects an oversized transcript with 400", async () => {
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "x".repeat(8001) }),
    );
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("propagates checkBrandAccess denial status", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "We're friendly and warm." }),
    );
    expect(res.status).toBe(404);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("strips empty-string fields from the extracted proposal", async () => {
    generateObject.mockResolvedValue({
      object: {
        fields: { tone: "warm", overview: "" },
        summary: "Captured tone",
      },
    });
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "We're friendly and warm." }),
    );
    const body = await res.json();
    expect(body.proposal.data.fields.overview).toBeUndefined();
  });

  it("returns a clean 500 when generateObject throws", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const res = await POST(
      req({ brandId: BRAND_ID, transcript: "We're friendly and warm." }),
    );
    expect(res.status).toBe(500);
  });
});
