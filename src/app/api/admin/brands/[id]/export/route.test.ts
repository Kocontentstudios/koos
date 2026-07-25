import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getBrandForAdmin = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getBrandForAdmin: (id: string) => getBrandForAdmin(id),
}));

import { GET } from "./route";

const VALID_ID = "11111111-1111-1111-1111-111111111111";

const brand = {
  id: VALID_ID,
  name: "Acme Rockets",
  onboardingStatus: "complete",
  completionPercentage: 100,
  overview: "A brand that launches things.",
  businessType: "ecommerce",
  stage: "growth",
  targetAudience: "Space enthusiasts",
  offer: "Rocket kits",
  tone: "playful",
  primaryGoal: "awareness",
  values: "curiosity, safety",
  wordsLove: "blast off",
  wordsAvoid: "boring",
  logoUrl: "https://cdn.test.example.com/logos/acme.png",
  hasLogo: true,
  brandStyle: "modern",
  primaryColor: "#111111",
  secondaryColor: "#222222",
  additionalColors: ["#333333"],
  competitors: "SpaceX",
  competitorStrengths: "Reusable rockets",
  differentiators: "Kid-friendly",
  platforms: ["instagram", "tiktok"],
  primaryPlatform: "instagram",
  postingFrequency: "daily",
  additionalNotes: "None",
  helpfulLinks: "https://acme.example.com",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-02-01T00:00:00.000Z"),
};

function req() {
  return new Request(`http://x/api/admin/brands/${VALID_ID}/export`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("admin brand export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
    getBrandForAdmin.mockResolvedValue({
      brand,
      ownerEmail: "owner@example.com",
      workspaceName: "Acme Workspace",
    });
  });

  it("returns 403 for a non-admin caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "customer" } });
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(403);
    expect(getBrandForAdmin).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-uuid id", async () => {
    const res = await GET(req(), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getBrandForAdmin).not.toHaveBeenCalled();
  });

  it("returns 404 when the brand is missing", async () => {
    getBrandForAdmin.mockResolvedValue(null);
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(404);
  });

  it("returns the export payload for an admin and a real brand", async () => {
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");

    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment; filename=");
    expect(disposition).toContain("acme-rockets");

    const body = await res.json();
    expect(body.owner).toBe("owner@example.com");
    expect(body.workspace).toBe("Acme Workspace");
    expect(Object.keys(body.sections)).toEqual([
      "basics",
      "audience",
      "personality",
      "visual",
      "competitors",
      "platforms",
      "additional",
    ]);
  });
});
