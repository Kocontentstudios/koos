import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getActiveBrandForMember = vi.fn();
const createBrand = vi.fn();
const updateBrand = vi.fn();
const checkBrandAccess = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: (w: string, u: string) =>
    getActiveBrandForMember(w, u),
  createBrand: (data: unknown) => createBrand(data),
  updateBrand: (id: string, patch: unknown) => updateBrand(id, patch),
  checkBrandAccess: (u: string, b: string, p: string) =>
    checkBrandAccess(u, b, p),
}));

import { PLACEHOLDER_BRAND_NAME } from "@/lib/brand-profile";
import { saveVisualIdentity, startConversationalOnboarding } from "./actions";

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

describe("saveVisualIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "w1" },
      role: "owner",
    });
    checkBrandAccess.mockResolvedValue({ ok: true });
    updateBrand.mockResolvedValue({ id: "b1", name: "Acme" });
  });

  const input = (over: Record<string, unknown> = {}) => ({
    logoUrl: "",
    primaryColor: "",
    secondaryColor: "",
    brandStyle: "",
    brandFont: "",
    brandFontUrl: "",
    additionalColors: [],
    ...over,
  });

  it("writes the additional colours the user picked", async () => {
    await saveVisualIdentity("b1", input({ additionalColors: ["#22C55E"] }));
    expect(updateBrand).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ additionalColors: ["#22C55E"] }),
    );
  });

  /* parseAdditionalColors is the sanitiser for the text[] column: it caps the
     list, drops blanks and dedupes, and deliberately never hex-validates so a
     colour NAME the conversation captured survives. */
  it("sanitises the list through parseAdditionalColors", async () => {
    await saveVisualIdentity(
      "b1",
      input({
        additionalColors: ["#22C55E", "  ", "#22c55e", "forest green", "gold"],
      }),
    );
    expect(updateBrand).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        additionalColors: ["#22C55E", "forest green", "gold"],
      }),
    );
  });
});
