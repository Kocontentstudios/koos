import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getMembership = vi.fn();
const removeWorkspaceMember = vi.fn();

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getMembership: (workspaceId: string, userId: string) =>
    getMembership(workspaceId, userId),
  removeWorkspaceMember: (workspaceId: string, userId: string) =>
    removeWorkspaceMember(workspaceId, userId),
}));

import { DELETE } from "./route";

const WORKSPACE = { id: "w1", name: "Acme", logoUrl: null };

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
      role: "member",
    });
    const res = await DELETE(new Request("http://x"), params("someone-else"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the workspace owner can manage the team.",
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
    getMembership.mockResolvedValue({ id: "m1", role: "member" });
    removeWorkspaceMember.mockResolvedValue(undefined);
    const res = await DELETE(new Request("http://x"), params("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeWorkspaceMember).toHaveBeenCalledWith("w1", "u2");
  });
});
