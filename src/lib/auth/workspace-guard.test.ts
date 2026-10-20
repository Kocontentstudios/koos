import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));

import { WORKSPACE_PENDING_CODE } from "./workspace-approval";
import { guardWorkspaceRoute } from "./workspace-guard";

function resolved(
  accessStatus: "pending" | "approved",
  userRole = "user",
  role = "owner",
) {
  return {
    dbUser: { id: "u1", role: userRole },
    workspace: { id: "w1", accessStatus },
    role,
  };
}

describe("guardWorkspaceRoute and the access gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s a signed-out caller before looking at approval", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    const out = await guardWorkspaceRoute();
    expect("response" in out && out.response.status).toBe(401);
  });

  it("403s a pending workspace with the workspace_pending code", async () => {
    getActiveWorkspace.mockResolvedValue(resolved("pending"));
    const out = await guardWorkspaceRoute();
    if (!("response" in out)) throw new Error("expected a denial");
    expect(out.response.status).toBe(403);
    expect((await out.response.json()).code).toBe(WORKSPACE_PENDING_CODE);
  });

  /* The gate must win over the capability check: an owner of a pending
     workspace holds every capability, so checking capability first would
     wave them through. */
  it("blocks a pending owner even for a capability they hold", async () => {
    getActiveWorkspace.mockResolvedValue(resolved("pending"));
    const out = await guardWorkspaceRoute("manage_team");
    if (!("response" in out)) throw new Error("expected a denial");
    expect((await out.response.json()).code).toBe(WORKSPACE_PENDING_CODE);
  });

  it("lets an approved workspace through", async () => {
    getActiveWorkspace.mockResolvedValue(resolved("approved"));
    const out = await guardWorkspaceRoute("manage_team");
    expect("ctx" in out).toBe(true);
  });

  it("lets staff through a pending workspace", async () => {
    getActiveWorkspace.mockResolvedValue(resolved("pending", "admin"));
    const out = await guardWorkspaceRoute();
    expect("ctx" in out).toBe(true);
  });

  it("still applies the capability check once approved", async () => {
    getActiveWorkspace.mockResolvedValue(
      resolved("approved", "user", "contributor"),
    );
    const out = await guardWorkspaceRoute("manage_team");
    if (!("response" in out)) throw new Error("expected a denial");
    expect(out.response.status).toBe(403);
    expect((await out.response.json()).code).toBeUndefined();
  });
});
