import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getAuthUser = vi.fn();
const setActiveWorkspaceCookie = vi.fn();
const getWorkspacesForUser = vi.fn();
const updateWorkspace = vi.fn();
const deleteWorkspaceOwnedBy = vi.fn();
const getMembership = vi.fn();

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
  setActiveWorkspaceCookie: (id: string) => setActiveWorkspaceCookie(id),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getAuthUser: () => getAuthUser(),
}));
vi.mock("@/lib/db/queries", () => ({
  getWorkspacesForUser: (userId: string) => getWorkspacesForUser(userId),
  updateWorkspace: (id: string, patch: unknown) => updateWorkspace(id, patch),
  deleteWorkspaceOwnedBy: (workspaceId: string, ownerId: string) =>
    deleteWorkspaceOwnedBy(workspaceId, ownerId),
  getMembership: (workspaceId: string, userId: string) =>
    getMembership(workspaceId, userId),
}));

import { DELETE, GET, PATCH } from "./route";
import { POST as SWITCH } from "./switch/route";

const WORKSPACE = { id: "w1", name: "Acme", logoUrl: null };
const OWNER = { dbUser: { id: "u1" }, workspace: WORKSPACE, role: "owner" };
const MEMBER = { dbUser: { id: "u2" }, workspace: WORKSPACE, role: "member" };
const SIGNED_OUT = { dbUser: null, workspace: null, role: null };

function patchReq(body: unknown) {
  return new Request("http://x/api/workspace", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("GET/PATCH/DELETE /api/workspace validation matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspacesForUser.mockResolvedValue([
      { workspaceId: "w1", role: "owner" },
      { workspaceId: "w2", role: "member" },
    ]);
  });

  it("GET returns 401 when signed out", async () => {
    getActiveWorkspace.mockResolvedValue(SIGNED_OUT);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("GET returns the active workspace and role for a member", async () => {
    getActiveWorkspace.mockResolvedValue(MEMBER);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: { id: "w1", name: "Acme", logoUrl: null },
      role: "member",
    });
  });

  it("PATCH returns 403 for a non-owner member", async () => {
    getActiveWorkspace.mockResolvedValue(MEMBER);
    const res = await PATCH(patchReq({ name: "New name" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the workspace owner can change settings.",
    });
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("PATCH returns 401 when signed out", async () => {
    getActiveWorkspace.mockResolvedValue(SIGNED_OUT);
    const res = await PATCH(patchReq({ name: "New name" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("PATCH rejects a name outside 1-80 chars for the owner", async () => {
    getActiveWorkspace.mockResolvedValue(OWNER);
    const res = await PATCH(patchReq({ name: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Workspace name must be 1–80 characters.",
    });
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("PATCH updates the name for the owner", async () => {
    getActiveWorkspace.mockResolvedValue(OWNER);
    updateWorkspace.mockResolvedValue(undefined);
    const res = await PATCH(patchReq({ name: "New name" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateWorkspace).toHaveBeenCalledWith("w1", { name: "New name" });
  });

  it("DELETE returns 403 for a non-owner member", async () => {
    getActiveWorkspace.mockResolvedValue(MEMBER);
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the workspace owner can delete a workspace.",
    });
    expect(deleteWorkspaceOwnedBy).not.toHaveBeenCalled();
  });

  it("DELETE returns 401 when signed out", async () => {
    getActiveWorkspace.mockResolvedValue(SIGNED_OUT);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("DELETE returns 400 when it's the owner's only workspace, before deleting", async () => {
    getActiveWorkspace.mockResolvedValue(OWNER);
    getWorkspacesForUser.mockResolvedValue([
      { workspaceId: "w1", role: "owner" },
    ]);
    const res = await DELETE();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "You can't delete your only workspace.",
    });
    expect(deleteWorkspaceOwnedBy).not.toHaveBeenCalled();
  });

  it("DELETE deletes and points the cookie at a surviving workspace for the owner", async () => {
    getActiveWorkspace.mockResolvedValue(OWNER);
    deleteWorkspaceOwnedBy.mockResolvedValue(true);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteWorkspaceOwnedBy).toHaveBeenCalledWith("w1", "u1");
    expect(setActiveWorkspaceCookie).toHaveBeenCalledWith("w2");
  });

  it("POST /switch validates membership before setting the cookie", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getMembership.mockResolvedValue(null);
    const req = new Request("http://x/api/workspace/switch", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "w404" }),
    });
    const res = await SWITCH(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Workspace not found" });
    expect(setActiveWorkspaceCookie).not.toHaveBeenCalled();
  });

  it("POST /switch returns 401 when signed out", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const req = new Request("http://x/api/workspace/switch", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "w2" }),
    });
    const res = await SWITCH(req);
    expect(res.status).toBe(401);
  });
});
