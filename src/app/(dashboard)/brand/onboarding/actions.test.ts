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
    bodyFontUrl: "",
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

  /* ── KOOS-FEAT-020 ───────────────────────────────────────────────────── */

  /* The two slots have to reach two COLUMNS. The step component's own tests
     only prove it hands the right shape to onSave; this is the half that
     writes it, and dropping either field here loses the upload silently. */
  it("persists the heading and body faces to their own columns", async () => {
    await saveVisualIdentity(
      "b1",
      input({
        brandFontUrl: "https://cdn/fonts/u1/heading.ttf",
        bodyFontUrl: "https://cdn/fonts/u1/body.ttf",
      }),
    );
    expect(updateBrand).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        brandFontUrl: "https://cdn/fonts/u1/heading.ttf",
        bodyFontUrl: "https://cdn/fonts/u1/body.ttf",
      }),
    );
  });

  /* Empty means "not uploaded", and null is what the column holds for that —
     never the empty string, which would render as a font URL of "". */
  it("writes null, not an empty string, for a slot left empty", async () => {
    await saveVisualIdentity(
      "b1",
      input({ brandFontUrl: "https://cdn/fonts/u1/heading.ttf" }),
    );
    const patch = updateBrand.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.bodyFontUrl).toBeNull();
    expect(patch.brandFontUrl).toBe("https://cdn/fonts/u1/heading.ttf");
  });

  it("keeps the slots independent when only the body is uploaded", async () => {
    await saveVisualIdentity(
      "b1",
      input({ bodyFontUrl: "https://cdn/fonts/u1/body.ttf" }),
    );
    const patch = updateBrand.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.brandFontUrl).toBeNull();
    expect(patch.bodyFontUrl).toBe("https://cdn/fonts/u1/body.ttf");
  });
});
