import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getActiveWorkspace = vi.fn();
const getActiveBrandForMember = vi.fn();
const updateBrand = vi.fn();
const createBrand = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: (workspaceId: string, userId: string) =>
    getActiveBrandForMember(workspaceId, userId),
  updateBrand: (id: string, data: unknown) => updateBrand(id, data),
  createBrand: (data: unknown) => createBrand(data),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveBrandProfile } from "./actions";

const validInput = {
  name: "Acme",
  overview: "We help people do the thing they love every single day.",
  businessType: "SaaS / Digital Product",
  stage: "Early (0–50 customers)",
};

describe("saveBrandProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "ws-1" },
      role: "owner",
    });
  });

  it("updates the existing brand even when onboarding is completed", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    const res = await saveBrandProfile(validInput);

    expect(updateBrand).toHaveBeenCalledWith(
      "existing-brand",
      expect.objectContaining({ name: "Acme" }),
    );
    expect(createBrand).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, brandId: "existing-brand" });
  });

  it("persists cleared optional fields as null on edit, not undefined", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    // targetAudience and tone are omitted entirely (cleared by the user).
    const res = await saveBrandProfile(validInput);

    expect(updateBrand).toHaveBeenCalledWith(
      "existing-brand",
      expect.objectContaining({ tone: null, targetAudience: null }),
    );
    expect(res).toEqual({ ok: true, brandId: "existing-brand" });
  });

  it("creates a new brand when the user has none", async () => {
    getActiveBrandForMember.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand" });

    const res = await saveBrandProfile(validInput);

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        workspaceId: "ws-1",
        name: "Acme",
      }),
    );
    expect(updateBrand).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, brandId: "new-brand" });
  });
});
