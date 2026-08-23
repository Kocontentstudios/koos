import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@/lib/auth/workspace-access";
import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";
import { chooseActiveWorkspace } from "./active-workspace";

function m(id: string, role: WorkspaceRole): WorkspaceMembership {
  return {
    workspaceId: id,
    role,
    brandScope: "all",
    workspace: { id, name: `ws-${id}`, logoUrl: null, ownerId: "u0" },
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
