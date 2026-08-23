import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getActiveBrandForMember = vi.fn();
const createBrand = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: (w: string, u: string) =>
    getActiveBrandForMember(w, u),
  createBrand: (data: unknown) => createBrand(data),
}));

import { PLACEHOLDER_BRAND_NAME } from "@/lib/brand-profile";
import { startConversationalOnboarding } from "./actions";

describe("startConversationalOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveBrandForMember.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand" });
  });

  function signedInAs(role: string) {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "w1" },
      role,
    });
  }

  it("mints a conversational draft brand for a brand-new user", async () => {
    signedInAs("owner");
    const res = await startConversationalOnboarding();
    expect(res).toEqual({ ok: true, brandId: "new-brand" });
    expect(createBrand).toHaveBeenCalledWith({
      userId: "u1",
      workspaceId: "w1",
      name: PLACEHOLDER_BRAND_NAME,
      onboardingType: "conversational",
      onboardingStatus: "draft",
      completionPercentage: 0,
    });
  });

  /* The type is what routes a returning user back to chat instead of the
     form, so it has to be written at creation — nothing later sets it. */
  it("tags the draft so requireBrand resumes chat, not the form", async () => {
    signedInAs("owner");
    await startConversationalOnboarding();
    expect(createBrand.mock.calls[0][0].onboardingType).toBe("conversational");
  });

  it("reuses an existing brand instead of creating a second one", async () => {
    signedInAs("owner");
    getActiveBrandForMember.mockResolvedValue({ id: "existing" });
    const res = await startConversationalOnboarding();
    expect(res).toEqual({ ok: true, brandId: "existing" });
    expect(createBrand).not.toHaveBeenCalled();
  });

  /* Same hole that was closed in ensureQuickRequestBrand: a server action is
     a reachable POST endpoint, so it needs create_brand just like the page. */
  it("refuses to create a brand for a contributor", async () => {
    signedInAs("contributor");
    const res = await startConversationalOnboarding();
    expect(res).toEqual({
      ok: false,
      error: "You need workspace admin access to add a brand.",
    });
    expect(createBrand).not.toHaveBeenCalled();
  });

  it("returns an error rather than a brandId when unauthenticated", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    const res = await startConversationalOnboarding();
    expect(res).toEqual({ ok: false, error: "Not authenticated" });
    expect(createBrand).not.toHaveBeenCalled();
  });
});
