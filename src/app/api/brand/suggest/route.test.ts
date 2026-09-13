import { beforeEach, describe, expect, it, vi } from "vitest";

/* The limiter is DB-backed and its window is an hour, so an unmocked call
   writes to the real rate_limits table and the file trips itself: run the
   suite a few times inside an hour and these start 429-ing. CI never sees it
   because it has no DATABASE_URL and the limiter fails open there
   (KOOS-BUG-024). */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
}));

const guardWorkspaceRoute = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/workspace-guard", () => ({
  guardWorkspaceRoute: (c?: unknown) => guardWorkspaceRoute(c),
}));
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({}) }));

import { POST } from "./route";

const context = {
  name: "KO",
  overview: "",
  businessType: "",
  stage: "",
  targetAudience: "",
  offer: "",
  tone: "",
  values: "",
  differentiators: "",
  primaryGoal: "",
};

function req(body: unknown) {
  return new Request("http://x/api/brand/suggest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("brand suggest route", () => {
  beforeEach(() => {
    checkRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
    vi.clearAllMocks();
    guardWorkspaceRoute.mockResolvedValue({
      ctx: { dbUser: { id: "u1" }, workspace: { id: "w1" }, role: "owner" },
    });
    generateObject.mockResolvedValue({
      object: { suggestion: "A crisp line." },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    guardWorkspaceRoute.mockResolvedValue({
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    });
    const res = await POST(
      req({ field: "overview", currentValue: "", context }),
    );
    expect(res.status).toBe(401);
  });

  it("returns a suggestion for a valid field", async () => {
    const res = await POST(
      req({ field: "overview", currentValue: "", context }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "A crisp line." });
  });

  it("rejects an unknown field with 400", async () => {
    const res = await POST(req({ field: "hacker", currentValue: "", context }));
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects a prototype-chain key (constructor) with 400", async () => {
    const res = await POST(
      req({ field: "constructor", currentValue: "", context }),
    );
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects an oversized currentValue with 400", async () => {
    const res = await POST(
      req({ field: "overview", currentValue: "x".repeat(2001), context }),
    );
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects an oversized context field with 400", async () => {
    const res = await POST(
      req({
        field: "overview",
        currentValue: "",
        context: { ...context, name: "x".repeat(2001) },
      }),
    );
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects a non-string currentValue with 400 (not a thrown 500)", async () => {
    const res = await POST(
      req({ field: "overview", currentValue: 7, context }),
    );
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("tolerates missing context keys by defaulting them to empty strings", async () => {
    const res = await POST(
      req({ field: "overview", currentValue: "", context: { name: "KO" } }),
    );
    expect(res.status).toBe(200);
  });
});
