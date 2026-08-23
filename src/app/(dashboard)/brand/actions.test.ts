import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getActiveWorkspace = vi.fn();
const getActiveBrandForMember = vi.fn();
const checkBrandAccess = vi.fn();
const updateBrand = vi.fn();
const createBrand = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: (workspaceId: string, userId: string) =>
    getActiveBrandForMember(workspaceId, userId),
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
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
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b" } });
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

describe("saveBrandProfile — capability gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b" } });
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "ws-1" },
      role: "contributor",
    });
  });

  it("refuses to create a brand for a role without create_brand", async () => {
    getActiveBrandForMember.mockResolvedValue(null);
    const res = await saveBrandProfile(validInput);
    expect(res).toEqual({
      ok: false,
      error: "You need workspace admin access to add a brand.",
    });
    expect(createBrand).not.toHaveBeenCalled();
  });

  /* The edit path used to trust the scoped read alone. It must authorize the
     write, so a member narrowed out of this brand cannot still edit it. */
  it("refuses to edit a brand the guard rejects", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await saveBrandProfile(validInput);
    expect(res).toEqual({ ok: false, error: "Brand not found" });
    expect(updateBrand).not.toHaveBeenCalled();
  });
});
