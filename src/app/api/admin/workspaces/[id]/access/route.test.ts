import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getWorkspaceAccess = vi.fn();
const setWorkspaceAccess = vi.fn();
const getWorkspaceOwner = vi.fn();
const sendWorkspaceApprovedEmail = vi.fn();
const captureServerEvent = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getWorkspaceAccess: (id: string) => getWorkspaceAccess(id),
  setWorkspaceAccess: (id: string, s: string, by: string) =>
    setWorkspaceAccess(id, s, by),
  getWorkspaceOwner: (id: string) => getWorkspaceOwner(id),
}));
vi.mock("@/lib/notify/workspace", () => ({
  sendWorkspaceApprovedEmail: (a: unknown) => sendWorkspaceApprovedEmail(a),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: (e: unknown) => captureServerEvent(e),
}));
vi.mock("@/lib/app-url", () => ({ appUrl: (p: string) => `https://app${p}` }));

import { POST } from "./route";

const WS = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const params = (id = WS) => ({ params: Promise.resolve({ id }) });

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/admin/workspaces/[id]/access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "admin-1", role: "admin" } });
    getWorkspaceAccess.mockResolvedValue({
      id: WS,
      name: "Killa Skincare",
      accessStatus: "pending",
    });
    setWorkspaceAccess.mockResolvedValue({
      id: WS,
      name: "Killa Skincare",
      accessStatus: "approved",
    });
    getWorkspaceOwner.mockResolvedValue({
      id: "owner-1",
      email: "ada@killa.com",
      firstName: "Ada",
    });
    sendWorkspaceApprovedEmail.mockResolvedValue(undefined);
  });

  it("approves, records the deciding admin and emails the owner", async () => {
    const res = await POST(req({ status: "approved" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: { id: WS, accessStatus: "approved" },
      changed: true,
      emailSent: true,
    });
    expect(setWorkspaceAccess).toHaveBeenCalledWith(WS, "approved", "admin-1");
    expect(sendWorkspaceApprovedEmail).toHaveBeenCalledWith({
      to: "ada@killa.com",
      input: {
        firstName: "Ada",
        workspaceName: "Killa Skincare",
        dashboardUrl: "https://app/dashboard",
      },
    });
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "owner-1",
      event: "workspace_access_changed",
      properties: { workspaceId: WS, status: "approved", decidedBy: "admin-1" },
    });
  });

  /* The approval is committed before the email goes out. A 500 here would
     read as "approval failed" and the retry would no-op, so the admin would
     never learn the client was not told. */
  it("reports a failed email without failing the approval", async () => {
    sendWorkspaceApprovedEmail.mockRejectedValue(new Error("SMTP down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ status: "approved" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: true, emailSent: false });
    spy.mockRestore();
  });

  it("sends no second email when the workspace was already approved", async () => {
    setWorkspaceAccess.mockResolvedValue(null);
    const res = await POST(req({ status: "approved" }), params());
    expect(await res.json()).toEqual({
      workspace: { id: WS, accessStatus: "approved" },
      changed: false,
      emailSent: false,
    });
    expect(sendWorkspaceApprovedEmail).not.toHaveBeenCalled();
    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("revokes without emailing anyone", async () => {
    setWorkspaceAccess.mockResolvedValue({
      id: WS,
      name: "Killa Skincare",
      accessStatus: "pending",
    });
    const res = await POST(req({ status: "pending" }), params());
    expect(await res.json()).toMatchObject({
      workspace: { accessStatus: "pending" },
      changed: true,
      emailSent: false,
    });
    expect(sendWorkspaceApprovedEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a designer", { id: "d1", role: "designer" }],
    ["a client", { id: "u1", role: "user" }],
    ["a signed-out caller", null],
  ])("forbids %s", async (_label, dbUser) => {
    getAuthUser.mockResolvedValue({ dbUser });
    const res = await POST(req({ status: "approved" }), params());
    expect(res.status).toBe(403);
    expect(setWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("rejects a status that is not a real one", async () => {
    const res = await POST(req({ status: "revoked" }), params());
    expect(res.status).toBe(400);
    expect(setWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(req("not json"), params());
    expect(res.status).toBe(400);
  });

  it("404s a malformed id without touching the database", async () => {
    const res = await POST(req({ status: "approved" }), params("1 OR 1=1"));
    expect(res.status).toBe(404);
    expect(getWorkspaceAccess).not.toHaveBeenCalled();
  });

  /* An orphaned workspace (owner row deleted) still gets approved and traced;
     there is just nobody to email. */
  it("approves a workspace with no owner without emailing", async () => {
    getWorkspaceOwner.mockResolvedValue(null);
    const res = await POST(req({ status: "approved" }), params());
    expect(await res.json()).toMatchObject({ changed: true, emailSent: false });
    expect(sendWorkspaceApprovedEmail).not.toHaveBeenCalled();
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "admin-1" }),
    );
  });

  it("404s a workspace that does not exist", async () => {
    getWorkspaceAccess.mockResolvedValue(null);
    const res = await POST(req({ status: "approved" }), params());
    expect(res.status).toBe(404);
    expect(setWorkspaceAccess).not.toHaveBeenCalled();
  });
});
