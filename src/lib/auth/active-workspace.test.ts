import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@/lib/auth/workspace-access";
import type { WorkspaceAccessStatus } from "@/lib/auth/workspace-approval";
import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";
import { chooseActiveWorkspace } from "./active-workspace";

function m(
  id: string,
  role: WorkspaceRole,
  accessStatus: WorkspaceAccessStatus = "approved",
): WorkspaceMembership {
  return {
    workspaceId: id,
    role,
    brandScope: "all",
    workspace: {
      id,
      name: `ws-${id}`,
      logoUrl: null,
      ownerId: "u0",
      accessStatus,
    },
  };
}

describe("chooseActiveWorkspace", () => {
  it("honors a cookie that matches a membership", () => {
    const picked = chooseActiveWorkspace(
      [m("a", "owner"), m("b", "contributor")],
      "b",
    );
    expect(picked?.workspaceId).toBe("b");
  });

  it("falls back to the first owner membership on a stale cookie", () => {
    const picked = chooseActiveWorkspace(
      [m("a", "contributor"), m("b", "owner")],
      "gone",
    );
    expect(picked?.workspaceId).toBe("b");
  });

  it("falls back to the first membership when user owns nothing", () => {
    const picked = chooseActiveWorkspace(
      [m("a", "contributor"), m("b", "contributor")],
      undefined,
    );
    expect(picked?.workspaceId).toBe("a");
  });

  it("returns null for no memberships", () => {
    expect(chooseActiveWorkspace([], "x")).toBeNull();
  });
});

describe("chooseActiveWorkspace with the access gate", () => {
  /* The invited-teammate case: their own personal workspace is pending, the
     client workspace they joined is approved, and a new device has no cookie. */
  it("prefers an approved membership over a pending owned one", () => {
    const picked = chooseActiveWorkspace(
      [m("personal", "owner", "pending"), m("client", "contributor")],
      undefined,
    );
    expect(picked?.workspaceId).toBe("client");
  });

  it("prefers an approved owned workspace over an approved membership", () => {
    const picked = chooseActiveWorkspace(
      [m("client", "admin"), m("own", "owner"), m("p", "owner", "pending")],
      undefined,
    );
    expect(picked?.workspaceId).toBe("own");
  });

  it("still honors a cookie pointing at a pending workspace", () => {
    const picked = chooseActiveWorkspace(
      [m("personal", "owner", "pending"), m("client", "contributor")],
      "personal",
    );
    expect(picked?.workspaceId).toBe("personal");
  });

  it("lands a brand-new signup in their pending workspace", () => {
    const picked = chooseActiveWorkspace(
      [m("personal", "owner", "pending")],
      undefined,
    );
    expect(picked?.workspaceId).toBe("personal");
  });
});
