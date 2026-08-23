import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getMembership = vi.fn();
const removeWorkspaceMember = vi.fn();
const updateMembership = vi.fn();
const deletePendingInvitationsFrom = vi.fn();
const getAssignedBrandIds = vi.fn();
const getWorkspaceBrandIds = vi.fn();

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getMembership: (workspaceId: string, userId: string) =>
    getMembership(workspaceId, userId),
  removeWorkspaceMember: (workspaceId: string, userId: string) =>
    removeWorkspaceMember(workspaceId, userId),
  updateMembership: (w: string, u: string, d: unknown, b?: string[]) =>
    updateMembership(w, u, d, b),
  deletePendingInvitationsFrom: (w: string, u: string) =>
    deletePendingInvitationsFrom(w, u),
  getAssignedBrandIds: (w: string, u: string) => getAssignedBrandIds(w, u),
  getWorkspaceBrandIds: (w: string, ids: string[]) =>
    getWorkspaceBrandIds(w, ids),
}));

import { DELETE, PATCH } from "./route";

const WORKSPACE = { id: "w1", name: "Acme", logoUrl: null, ownerId: "owner-1" };

function params(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe("DELETE /api/workspace/members/[userId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the owner tries to remove their own membership", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "owner-1" },
      workspace: WORKSPACE,
      role: "owner",
    });
    const res = await DELETE(new Request("http://x"), params("owner-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "You can't remove yourself from your own workspace.",
    });
    expect(removeWorkspaceMember).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner member", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "member-1" },
      workspace: WORKSPACE,
      role: "contributor",
    });
    const res = await DELETE(new Request("http://x"), params("someone-else"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "You need workspace admin access to manage the team.",
    });
    expect(removeWorkspaceMember).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    const res = await DELETE(new Request("http://x"), params("u2"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("removes another member for the owner", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "owner-1" },
      workspace: WORKSPACE,
      role: "owner",
    });
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    removeWorkspaceMember.mockResolvedValue(undefined);
    const res = await DELETE(new Request("http://x"), params("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeWorkspaceMember).toHaveBeenCalledWith("w1", "u2");
  });
});

function patchReq(body: unknown) {
  return new Request("http://x/api/workspace/members/target-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function signedInAs(role: string, userId = "actor-1") {
  getActiveWorkspace.mockResolvedValue({
    dbUser: { id: userId },
    workspace: WORKSPACE,
    role,
  });
}

describe("PATCH /api/workspace/members/[userId] — escalation rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssignedBrandIds.mockResolvedValue([]);
    getWorkspaceBrandIds.mockImplementation(async (_w, ids: string[]) => ids);
  });

  it("an owner can promote a contributor to admin", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    const res = await PATCH(patchReq({ role: "admin" }), params("target-1"));
    expect(res.status).toBe(200);
    expect(updateMembership).toHaveBeenCalledWith(
      "w1",
      "target-1",
      { role: "admin", brandScope: "all" },
      [],
    );
  });

  it("an admin cannot mint another admin", async () => {
    signedInAs("admin");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    const res = await PATCH(patchReq({ role: "admin" }), params("target-1"));
    expect(res.status).toBe(403);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("an admin cannot demote a peer admin", async () => {
    signedInAs("admin");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "admin",
      brandScope: "all",
    });
    const res = await PATCH(
      patchReq({ role: "contributor" }),
      params("target-1"),
    );
    expect(res.status).toBe(403);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("the workspace owner's membership cannot be changed", async () => {
    signedInAs("owner", "someone-else");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "owner",
      brandScope: "all",
    });
    const res = await PATCH(patchReq({ role: "contributor" }), {
      params: Promise.resolve({ userId: "owner-1" }),
    });
    expect(res.status).toBe(403);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("ownership cannot be granted", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "admin",
      brandScope: "all",
    });
    const res = await PATCH(patchReq({ role: "owner" }), params("target-1"));
    expect(res.status).toBe(403);
  });

  it("a brand manager must keep at least one brand", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    const res = await PATCH(
      patchReq({ role: "brand_manager", brandIds: [] }),
      params("target-1"),
    );
    expect(res.status).toBe(400);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("promoting to admin clears any stale brand assignments", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "brand_manager",
      brandScope: "assigned",
    });
    const res = await PATCH(
      patchReq({ role: "admin", brandIds: ["b1"] }),
      params("target-1"),
    );
    expect(res.status).toBe(200);
    // Role, scope and assignments land in a single call, so a member is never
    // observable with the new role and the old brands.
    expect(updateMembership).toHaveBeenCalledWith(
      "w1",
      "target-1",
      { role: "admin", brandScope: "all" },
      [],
    );
  });

  /* Ids are filtered to the workspace first, so a foreign brand id can never
     become an assignment — it drops out and the empty result is refused. */
  it("rejects brand ids from another workspace", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    getWorkspaceBrandIds.mockResolvedValue([]);
    const res = await PATCH(
      patchReq({ role: "brand_manager", brandIds: ["foreign"] }),
      params("target-1"),
    );
    expect(res.status).toBe(400);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("a brand manager cannot use the member API at all", async () => {
    signedInAs("brand_manager");
    const res = await PATCH(
      patchReq({ role: "contributor" }),
      params("target-1"),
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/workspace/members/[userId] — authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an admin cannot remove a peer admin", async () => {
    signedInAs("admin");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "admin",
      brandScope: "all",
    });
    const res = await DELETE(new Request("http://x"), params("target-1"));
    expect(res.status).toBe(403);
    expect(removeWorkspaceMember).not.toHaveBeenCalled();
  });

  it("the workspace owner can never be removed", async () => {
    signedInAs("owner", "someone-else");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "owner",
      brandScope: "all",
    });
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ userId: "owner-1" }),
    });
    expect(res.status).toBe(403);
    expect(removeWorkspaceMember).not.toHaveBeenCalled();
  });

  it("an admin can remove a contributor", async () => {
    signedInAs("admin");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    const res = await DELETE(new Request("http://x"), params("target-1"));
    expect(res.status).toBe(200);
    expect(removeWorkspaceMember).toHaveBeenCalledWith("w1", "target-1");
  });
});

describe("PATCH — a shrinking member's own invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssignedBrandIds.mockResolvedValue([]);
    getWorkspaceBrandIds.mockImplementation(async (_w, ids: string[]) => ids);
  });

  /* An invitation carries the brands and role its sender held when they sent
     it. Demote the sender and those invitations would keep minting members
     into brands the sender no longer holds, for the rest of the 7-day TTL. */
  it("revokes the pending invitations of a demoted member", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "brand_manager",
      brandScope: "assigned",
    });
    const res = await PATCH(
      patchReq({ role: "contributor", brandScope: "all" }),
      params("target-1"),
    );
    expect(res.status).toBe(200);
    expect(deletePendingInvitationsFrom).toHaveBeenCalledWith("w1", "target-1");
  });

  it("leaves them alone when nothing actually changed", async () => {
    signedInAs("owner");
    getMembership.mockResolvedValue({
      id: "m1",
      role: "contributor",
      brandScope: "all",
    });
    const res = await PATCH(
      patchReq({ role: "contributor", brandScope: "all" }),
      params("target-1"),
    );
    expect(res.status).toBe(200);
    expect(deletePendingInvitationsFrom).not.toHaveBeenCalled();
  });
});
