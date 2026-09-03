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

  /* KOS-V1-BUG-001: this path hardcoded completionPercentage: 100, so a brand
     that filled only the required Basics and skipped all six optional steps
     still reported a finished profile in the admin directory. */
  it("writes the weighted score, not a hardcoded 100, for a Basics-only save", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    await saveBrandProfile(validInput);

    expect(updateBrand.mock.calls[0][1]).toMatchObject({
      completionPercentage: 20,
      // The gate is unchanged: the form validates all four required fields
      // before submitting, and requireBrand keys off this, not the score.
      onboardingStatus: "completed",
    });
  });

  it("raises the score as optional sections are filled in", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    await saveBrandProfile({
      ...validInput,
      platforms: ["Instagram"],
      primaryPlatform: "Instagram",
      postingFrequency: "3x per week",
    });

    expect(updateBrand.mock.calls[0][1]).toMatchObject({
      completionPercentage: 35,
      onboardingStatus: "completed",
    });
  });

  it("scores a newly created brand the same way", async () => {
    getActiveBrandForMember.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand" });

    await saveBrandProfile(validInput);

    expect(createBrand.mock.calls[0][0]).toMatchObject({
      completionPercentage: 20,
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
    expect(res).toMatchObject({ ok: true, brandId: "existing-brand" });
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
    expect(res).toMatchObject({ ok: true, brandId: "existing-brand" });
  });

  it("persists a full additional-colour palette", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    await saveBrandProfile({
      ...validInput,
      primaryColor: "#0F172A",
      secondaryColor: "#F97316",
      additionalColors: ["#22C55E", "#EAB308", "#EC4899"],
    });

    expect(updateBrand.mock.calls[0][1]).toMatchObject({
      additionalColors: ["#22C55E", "#EAB308", "#EC4899"],
    });
  });

  it("rejects a fourth colour rather than silently truncating", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });

    const res = await saveBrandProfile({
      ...validInput,
      additionalColors: ["#1A1A1A", "#2A2A2A", "#3A3A3A", "#4A4A4A"],
    });

    expect(res.ok).toBe(false);
    expect(updateBrand).not.toHaveBeenCalled();
  });

  /* AC: a brand saved before this feature has no additional_colors value and
     must keep saving cleanly, writing null rather than an empty array.
     The wizard ALWAYS sends the array (brandToFormState maps a null column to
     []), so [] is the real legacy payload — asserting on an omitted field
     would have tested a shape the form never produces. */
  it("writes null, not {}, when a legacy brand is saved untouched", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    await saveBrandProfile({
      ...validInput,
      primaryColor: "#0F172A",
      secondaryColor: "#F97316",
      additionalColors: [],
    });

    expect(updateBrand.mock.calls[0][1]).toMatchObject({
      primaryColor: "#0F172A",
      additionalColors: null,
    });
  });

  it("writes null when the field is omitted entirely", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    await saveBrandProfile({ ...validInput, primaryColor: "#0F172A" });

    expect(updateBrand.mock.calls[0][1]).toMatchObject({
      additionalColors: null,
    });
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
    expect(res).toMatchObject({ ok: true, brandId: "new-brand" });
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

/* The snapshot card is rendered from the action's response rather than a
   re-fetch: the client's copy of the brand predates this write. */
describe("saveBrandProfile snapshot", () => {
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

  it("returns the row it just wrote, not the caller's input", async () => {
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({
      id: "existing-brand",
      name: "Acme",
      overview: "We help people",
      tone: "Bold & Direct",
      primaryColor: "#123456",
      additionalColors: ["#abcdef"],
    });

    const res = await saveBrandProfile(validInput);

    expect(res).toMatchObject({
      ok: true,
      snapshot: {
        name: "Acme",
        overview: "We help people",
        tone: "Bold & Direct",
        primaryColor: "#123456",
        additionalColors: ["#abcdef"],
      },
    });
  });

  it("normalises missing optional fields to null", async () => {
    getActiveBrandForMember.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand", name: "Acme" });

    const res = await saveBrandProfile(validInput);

    expect(res).toMatchObject({
      ok: true,
      snapshot: { name: "Acme", logoUrl: null, tone: null, stage: null },
    });
  });
});

/* saveBrandProfile is a server action taking unknown input, and was the last
   writer of this column still trusting its caller. Dropping isValidHex from the
   schema also dropped the incidental length bound it provided, so deleting the
   parseAdditionalColors call must turn this red. */
describe("saveBrandProfile additionalColors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b" } });
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "ws-1" },
      role: "owner",
    });
    getActiveBrandForMember.mockResolvedValue({
      id: "existing-brand",
      name: "Acme",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand", name: "Acme" });
  });

  const written = () =>
    updateBrand.mock.calls[0]?.[1] as { additionalColors: string[] | null };

  it("bounds and de-duplicates what reaches the column", async () => {
    await saveBrandProfile({
      ...validInput,
      additionalColors: ["#22C55E", "#22c55e", "x".repeat(200_000)],
    });
    const colors = written().additionalColors;
    expect(colors).toHaveLength(2);
    expect(colors?.[0]).toBe("#22C55E");
    expect(colors?.[1].length).toBeLessThanOrEqual(40);
  });

  it("writes null rather than an empty array when nothing survives", async () => {
    await saveBrandProfile({ ...validInput, additionalColors: ["", "  "] });
    expect(written().additionalColors).toBeNull();
  });

  it("keeps a colour name the chat captured", async () => {
    await saveBrandProfile({
      ...validInput,
      additionalColors: ["terracotta"],
    });
    expect(written().additionalColors).toEqual(["terracotta"]);
  });
});
