import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
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
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    generateObject.mockResolvedValue({ object: { suggestion: "A crisp line." } });
  });

  it("returns 401 when unauthenticated", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(req({ field: "overview", currentValue: "", context }));
    expect(res.status).toBe(401);
  });

  it("returns a suggestion for a valid field", async () => {
    const res = await POST(req({ field: "overview", currentValue: "", context }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "A crisp line." });
  });

  it("rejects an unknown field with 400", async () => {
    const res = await POST(req({ field: "hacker", currentValue: "", context }));
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
