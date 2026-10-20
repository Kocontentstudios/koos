import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getActiveBrandForMember = vi.fn();
const createBrand = vi.fn();

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: (w: string, u: string) =>
    getActiveBrandForMember(w, u),
  createBrand: (data: unknown) => createBrand(data),
}));

import { WORKSPACE_PENDING_ERROR } from "@/lib/auth/workspace-approval";
import { ensureQuickRequestBrand } from "./actions";

describe("ensureQuickRequestBrand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveBrandForMember.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand" });
  });

  function signedInAs(role: string) {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "w1", accessStatus: "approved" },
      role,
    });
  }

  it("creates the draft brand for a role that may create brands", async () => {
    signedInAs("owner");
    const res = await ensureQuickRequestBrand("Acme");
    expect(res).toEqual({ ok: true, brandId: "new-brand" });
  });

  /* Regression: this server action created brands with no capability check.
     A contributor could seed a draft here, then upgrade it to a completed
     brand through saveBrandProfile's `existing` branch — routing around
     create_brand, the /brand/create page guard, and the save guard alike. */
  it("refuses to create a brand for a contributor", async () => {
    signedInAs("contributor");
    const res = await ensureQuickRequestBrand("Acme");
    expect(res).toEqual({
      ok: false,
      error: "You need workspace admin access to add a brand.",
    });
    expect(createBrand).not.toHaveBeenCalled();
  });

  it("refuses for a brand manager too", async () => {
    signedInAs("brand_manager");
    const res = await ensureQuickRequestBrand("Acme");
    expect(res).toMatchObject({ ok: false });
    expect(createBrand).not.toHaveBeenCalled();
  });

  it("still reuses an existing brand without needing the capability", async () => {
    signedInAs("contributor");
    getActiveBrandForMember.mockResolvedValue({ id: "existing" });
    const res = await ensureQuickRequestBrand("Acme");
    expect(res).toEqual({ ok: true, brandId: "existing" });
  });
});

describe("ensureQuickRequestBrand behind the access gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a pending workspace without creating a brand", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1", role: "user" },
      workspace: { id: "w1", accessStatus: "pending" },
      role: "owner",
    });
    const res = await ensureQuickRequestBrand("Acme");
    expect(res).toEqual({ ok: false, error: WORKSPACE_PENDING_ERROR });
    expect(createBrand).not.toHaveBeenCalled();
  });
});
