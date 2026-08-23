import { describe, expect, it } from "vitest";
import {
  type BrandScope,
  CAPABILITIES,
  type Capability,
  can,
  capabilitiesFor,
  evaluateBrandAccess,
  evaluateInvite,
  evaluateMemberRemoval,
  evaluateRoleChange,
  isBrandScope,
  isWorkspaceRole,
  ROLE_RANK,
  resolveBrandScope,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "./workspace-access";

/**
 * The whole grant table, written out. This is the permission matrix of the
 * product: any change to GRANTS that isn't mirrored here fails the build,
 * which is the point — grants must never drift silently.
 */
const MATRIX: Record<WorkspaceRole, Capability[]> = {
  owner: [
    "manage_content",
    "create_brand",
    "delete_brand",
    "approve_deliverables",
    "manage_team",
    "invite_contributor",
    "manage_brand_access",
    "manage_settings",
    "delete_workspace",
    "transfer_ownership",
    "view_billing",
    "manage_billing",
  ],
  admin: [
    "manage_content",
    "create_brand",
    "delete_brand",
    "approve_deliverables",
    "manage_team",
    "invite_contributor",
    "manage_brand_access",
    "manage_settings",
  ],
  brand_manager: [
    "manage_content",
    "approve_deliverables",
    "invite_contributor",
  ],
  contributor: ["manage_content"],
};

describe("capability matrix", () => {
  for (const role of WORKSPACE_ROLES) {
    for (const capability of CAPABILITIES) {
      const expected = MATRIX[role].includes(capability);
      it(`${role} ${expected ? "has" : "lacks"} ${capability}`, () => {
        expect(can(role, capability)).toBe(expected);
      });
    }
  }

  it("covers every capability in the union", () => {
    expect(CAPABILITIES).toHaveLength(12);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("capabilitiesFor returns the same answers as can()", () => {
    for (const role of WORKSPACE_ROLES) {
      const caps = capabilitiesFor(role);
      for (const capability of CAPABILITIES) {
        expect(caps[capability]).toBe(can(role, capability));
      }
    }
  });

  it("only the owner holds the placeholder capabilities", () => {
    for (const capability of [
      "transfer_ownership",
      "view_billing",
      "manage_billing",
    ] as const) {
      expect(can("owner", capability)).toBe(true);
      expect(can("admin", capability)).toBe(false);
      expect(can("brand_manager", capability)).toBe(false);
      expect(can("contributor", capability)).toBe(false);
    }
  });

  it("privilege is monotonic: a lower rank grants a superset", () => {
    const ordered = [...WORKSPACE_ROLES].sort(
      (a, b) => ROLE_RANK[a] - ROLE_RANK[b],
    );
    for (let i = 0; i < ordered.length - 1; i++) {
      const higher = ordered[i];
      const lower = ordered[i + 1];
      for (const capability of CAPABILITIES) {
        if (can(lower, capability)) {
          expect(
            can(higher, capability),
            `${higher} should hold everything ${lower} does (${capability})`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("role ordering", () => {
  // Postgres sorts an enum by declaration order and the member lists order by
  // this column, so the declaration must run most-privileged first.
  it("WORKSPACE_ROLES is declared in descending privilege", () => {
    const ranks = WORKSPACE_ROLES.map((r) => ROLE_RANK[r]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(WORKSPACE_ROLES[0]).toBe("owner");
  });

  it("ranks are unique", () => {
    const ranks = WORKSPACE_ROLES.map((r) => ROLE_RANK[r]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("guards", () => {
  it("isWorkspaceRole rejects the retired 'member' value", () => {
    expect(isWorkspaceRole("member")).toBe(false);
    expect(isWorkspaceRole("contributor")).toBe(true);
    expect(isWorkspaceRole(null)).toBe(false);
  });

  it("isBrandScope", () => {
    expect(isBrandScope("all")).toBe(true);
    expect(isBrandScope("assigned")).toBe(true);
    expect(isBrandScope("some")).toBe(false);
  });
});

describe("resolveBrandScope", () => {
  it("forces privileged roles to workspace-wide", () => {
    expect(resolveBrandScope("owner", "assigned")).toBe("all");
    expect(resolveBrandScope("admin", "assigned")).toBe("all");
  });

  it("forces brand managers to assigned", () => {
    expect(resolveBrandScope("brand_manager", "all")).toBe("assigned");
    expect(resolveBrandScope("brand_manager", null)).toBe("assigned");
  });

  it("lets contributors be either, defaulting to workspace-wide", () => {
    expect(resolveBrandScope("contributor", null)).toBe("all");
    expect(resolveBrandScope("contributor", "assigned")).toBe("assigned");
  });
});

describe("evaluateBrandAccess", () => {
  const base = {
    capability: "manage_content" as Capability,
    brandId: "brand-1",
    assignedBrandIds: [] as string[],
  };

  it("non-member gets 404 (no existence leak)", () => {
    expect(evaluateBrandAccess({ ...base, membership: null })).toEqual({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
  });

  it("checks membership before capability", () => {
    // A missing membership must never surface a 403, which would confirm the
    // brand exists.
    const decision = evaluateBrandAccess({
      ...base,
      capability: "delete_workspace",
      membership: null,
    });
    expect(decision).toMatchObject({ status: 404 });
  });

  it("member without the capability gets 403", () => {
    expect(
      evaluateBrandAccess({
        ...base,
        capability: "approve_deliverables",
        membership: { role: "contributor", brandScope: "all" },
      }),
    ).toEqual({
      ok: false,
      status: 403,
      error: "You don't have permission to do that in this workspace.",
    });
  });

  it("scope 'all' reaches any brand regardless of assignments", () => {
    for (const role of WORKSPACE_ROLES) {
      if (role === "brand_manager") continue; // structurally always 'assigned'
      expect(
        evaluateBrandAccess({
          ...base,
          membership: { role, brandScope: "all" },
        }),
      ).toEqual({ ok: true });
    }
  });

  /* The regression that motivated brand_scope: under the retired default-open
     rule an empty assignment list meant EVERY brand, so deleting a brand
     manager's last assignment silently promoted them workspace-wide. */
  it("scope 'assigned' with NO assignments reaches nothing", () => {
    expect(
      evaluateBrandAccess({
        ...base,
        assignedBrandIds: [],
        membership: { role: "brand_manager", brandScope: "assigned" },
      }),
    ).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("scope 'assigned' reaches only the assigned brands", () => {
    const membership = {
      role: "brand_manager" as WorkspaceRole,
      brandScope: "assigned" as BrandScope,
    };
    expect(
      evaluateBrandAccess({
        ...base,
        membership,
        assignedBrandIds: ["brand-1", "brand-2"],
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateBrandAccess({
        ...base,
        membership,
        brandId: "brand-9",
        assignedBrandIds: ["brand-1", "brand-2"],
      }),
    ).toMatchObject({ status: 404 });
  });

  it("a scoped contributor is restricted the same way", () => {
    expect(
      evaluateBrandAccess({
        ...base,
        membership: { role: "contributor", brandScope: "assigned" },
        assignedBrandIds: ["brand-other"],
      }),
    ).toMatchObject({ status: 404 });
  });

  it("out-of-scope reads as 404, not 403", () => {
    const decision = evaluateBrandAccess({
      ...base,
      membership: { role: "brand_manager", brandScope: "assigned" },
      assignedBrandIds: ["brand-other"],
    });
    expect(decision).toMatchObject({ status: 404 });
  });
});

const OWNER_ID = "owner-user";
const ACTOR = "actor-user";
const TARGET = "target-user";

describe("evaluateRoleChange", () => {
  const base = {
    actorUserId: ACTOR,
    targetUserId: TARGET,
    workspaceOwnerId: OWNER_ID,
  };

  it("owner may set any non-owner role", () => {
    for (const next of ["admin", "brand_manager", "contributor"] as const) {
      expect(
        evaluateRoleChange({
          ...base,
          actorRole: "owner",
          targetCurrentRole: "contributor",
          targetNextRole: next,
        }),
      ).toEqual({ ok: true });
    }
  });

  it("nobody may grant ownership", () => {
    expect(
      evaluateRoleChange({
        ...base,
        actorRole: "owner",
        targetCurrentRole: "admin",
        targetNextRole: "owner",
      }),
    ).toMatchObject({ status: 403, error: "Ownership can't be granted." });
  });

  it("the workspace owner's membership is immovable", () => {
    expect(
      evaluateRoleChange({
        ...base,
        targetUserId: OWNER_ID,
        actorRole: "owner",
        actorUserId: "someone-else",
        targetCurrentRole: "owner",
        targetNextRole: "admin",
      }),
    ).toMatchObject({
      status: 403,
      error: "The workspace owner can't be changed or removed.",
    });
  });

  it("an admin may not touch another admin", () => {
    expect(
      evaluateRoleChange({
        ...base,
        actorRole: "admin",
        targetCurrentRole: "admin",
        targetNextRole: "contributor",
      }),
    ).toMatchObject({
      status: 403,
      error: "You can't manage a member at or above your own role.",
    });
  });

  it("an admin may not mint another admin", () => {
    expect(
      evaluateRoleChange({
        ...base,
        actorRole: "admin",
        targetCurrentRole: "contributor",
        targetNextRole: "admin",
      }),
    ).toMatchObject({
      status: 403,
      error: "You can't grant a role at or above your own.",
    });
  });

  it("an admin may manage brand managers and contributors", () => {
    for (const current of ["brand_manager", "contributor"] as const) {
      for (const next of ["brand_manager", "contributor"] as const) {
        expect(
          evaluateRoleChange({
            ...base,
            actorRole: "admin",
            targetCurrentRole: current,
            targetNextRole: next,
          }),
        ).toEqual({ ok: true });
      }
    }
  });

  it("roles without manage_team are refused outright", () => {
    for (const actorRole of ["brand_manager", "contributor"] as const) {
      expect(
        evaluateRoleChange({
          ...base,
          actorRole,
          targetCurrentRole: "contributor",
          targetNextRole: "brand_manager",
        }),
      ).toMatchObject({
        status: 403,
        error: "You need workspace admin access to manage the team.",
      });
    }
  });

  it("nobody may change their own membership", () => {
    expect(
      evaluateRoleChange({
        ...base,
        targetUserId: ACTOR,
        actorRole: "admin",
        targetCurrentRole: "admin",
        targetNextRole: "contributor",
      }),
    ).toMatchObject({ status: 400 });
  });

  it("full actor x target matrix: an action is allowed only when both ranks are strictly below the actor", () => {
    for (const actorRole of WORKSPACE_ROLES) {
      for (const targetCurrentRole of WORKSPACE_ROLES) {
        for (const targetNextRole of WORKSPACE_ROLES) {
          const expected =
            can(actorRole, "manage_team") &&
            targetNextRole !== "owner" &&
            ROLE_RANK[targetCurrentRole] > ROLE_RANK[actorRole] &&
            ROLE_RANK[targetNextRole] > ROLE_RANK[actorRole];
          expect(
            evaluateRoleChange({
              ...base,
              actorRole,
              targetCurrentRole,
              targetNextRole,
            }).ok,
            `${actorRole} moving ${targetCurrentRole} -> ${targetNextRole}`,
          ).toBe(expected);
        }
      }
    }
  });
});

describe("evaluateMemberRemoval", () => {
  const base = {
    actorUserId: ACTOR,
    targetUserId: TARGET,
    workspaceOwnerId: OWNER_ID,
  };

  it("the owner can remove anyone else", () => {
    for (const targetRole of [
      "admin",
      "brand_manager",
      "contributor",
    ] as const) {
      expect(
        evaluateMemberRemoval({ ...base, actorRole: "owner", targetRole }),
      ).toEqual({ ok: true });
    }
  });

  it("the workspace owner can never be removed", () => {
    expect(
      evaluateMemberRemoval({
        ...base,
        targetUserId: OWNER_ID,
        actorRole: "owner",
        actorUserId: "another",
        targetRole: "owner",
      }),
    ).toMatchObject({ status: 403 });
  });

  it("an admin cannot remove a peer admin", () => {
    expect(
      evaluateMemberRemoval({
        ...base,
        actorRole: "admin",
        targetRole: "admin",
      }),
    ).toMatchObject({ status: 403 });
  });

  it("a brand manager cannot remove anyone", () => {
    expect(
      evaluateMemberRemoval({
        ...base,
        actorRole: "brand_manager",
        targetRole: "contributor",
      }),
    ).toMatchObject({ status: 403 });
  });
});

describe("evaluateInvite", () => {
  const unscoped = {
    actorBrandScope: "all" as BrandScope,
    actorAssignedBrandIds: [] as string[],
  };

  it("an owner may invite any non-owner role", () => {
    for (const invitedRole of [
      "admin",
      "brand_manager",
      "contributor",
    ] as const) {
      const brandIds = invitedRole === "brand_manager" ? ["brand-1"] : [];
      expect(
        evaluateInvite({
          ...unscoped,
          actorRole: "owner",
          invitedRole,
          brandIds,
        }),
      ).toEqual({ ok: true });
    }
  });

  it("nobody may invite an owner", () => {
    expect(
      evaluateInvite({
        ...unscoped,
        actorRole: "owner",
        invitedRole: "owner",
        brandIds: [],
      }),
    ).toMatchObject({ status: 403, error: "Ownership can't be granted." });
  });

  it("an admin may not invite another admin", () => {
    expect(
      evaluateInvite({
        ...unscoped,
        actorRole: "admin",
        invitedRole: "admin",
        brandIds: [],
      }),
    ).toMatchObject({
      status: 403,
      error: "You can't invite someone at or above your own role.",
    });
  });

  it("a brand manager may invite only contributors", () => {
    expect(
      evaluateInvite({
        actorRole: "brand_manager",
        actorBrandScope: "assigned",
        actorAssignedBrandIds: ["brand-1"],
        invitedRole: "admin",
        brandIds: ["brand-1"],
      }),
    ).toMatchObject({
      status: 403,
      error: "You can only invite contributors.",
    });

    expect(
      evaluateInvite({
        actorRole: "brand_manager",
        actorBrandScope: "assigned",
        actorAssignedBrandIds: ["brand-1"],
        invitedRole: "brand_manager",
        brandIds: ["brand-1"],
      }),
    ).toMatchObject({ status: 403 });
  });

  it("a brand manager may not share a brand they don't hold", () => {
    expect(
      evaluateInvite({
        actorRole: "brand_manager",
        actorBrandScope: "assigned",
        actorAssignedBrandIds: ["brand-1"],
        invitedRole: "contributor",
        brandIds: ["brand-1", "brand-2"],
      }),
    ).toMatchObject({
      status: 403,
      error: "You can only share brands you're assigned to.",
    });
  });

  it("a brand manager may invite a contributor to their own brands", () => {
    expect(
      evaluateInvite({
        actorRole: "brand_manager",
        actorBrandScope: "assigned",
        actorAssignedBrandIds: ["brand-1", "brand-2"],
        invitedRole: "contributor",
        brandIds: ["brand-2"],
      }),
    ).toEqual({ ok: true });
  });

  it("a brand-manager invite must name at least one brand", () => {
    expect(
      evaluateInvite({
        ...unscoped,
        actorRole: "owner",
        invitedRole: "brand_manager",
        brandIds: [],
      }),
    ).toMatchObject({
      status: 400,
      error: "Choose at least one brand for this person.",
    });
  });

  it("a contributor may not invite anyone", () => {
    expect(
      evaluateInvite({
        ...unscoped,
        actorRole: "contributor",
        invitedRole: "contributor",
        brandIds: [],
      }),
    ).toMatchObject({
      status: 403,
      error: "You need workspace admin access to invite people.",
    });
  });
});

describe("evaluateInvite — a scoped inviter cannot widen access", () => {
  /* Escalation: a brand manager holds only brand-1, but a contributor invited
     with no brands would be workspace-WIDE, reaching brands the inviter
     cannot. A scoped inviter must always produce a scoped invitee. */
  it("refuses an unscoped invite from a brand-scoped inviter", () => {
    expect(
      evaluateInvite({
        actorRole: "brand_manager",
        actorBrandScope: "assigned",
        actorAssignedBrandIds: ["brand-1"],
        invitedRole: "contributor",
        brandIds: [],
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("a workspace-wide inviter may still invite a workspace-wide contributor", () => {
    expect(
      evaluateInvite({
        actorRole: "admin",
        actorBrandScope: "all",
        actorAssignedBrandIds: [],
        invitedRole: "contributor",
        brandIds: [],
      }),
    ).toEqual({ ok: true });
  });

  it("a scoped inviter's invitee is limited to the inviter's own brands", () => {
    const decision = evaluateInvite({
      actorRole: "brand_manager",
      actorBrandScope: "assigned",
      actorAssignedBrandIds: ["brand-1", "brand-2"],
      invitedRole: "contributor",
      brandIds: ["brand-1"],
    });
    expect(decision).toEqual({ ok: true });
  });
});

describe("evaluateBrandAccess — no 403 oracle for hidden brands", () => {
  /* Regression: with the capability check first, a caller who was BOTH out of
     scope and short of the capability got 403, which confirms the brand exists
     inside their workspace. Out of scope must be indistinguishable from
     absent, whatever capability was asked for. */
  it("out of scope AND lacking the capability still reads as 404", () => {
    expect(
      evaluateBrandAccess({
        membership: { role: "contributor", brandScope: "assigned" },
        capability: "approve_deliverables",
        brandId: "hidden-brand",
        assignedBrandIds: ["my-brand"],
      }),
    ).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("in scope but lacking the capability is a 403, as before", () => {
    expect(
      evaluateBrandAccess({
        membership: { role: "contributor", brandScope: "assigned" },
        capability: "approve_deliverables",
        brandId: "my-brand",
        assignedBrandIds: ["my-brand"],
      }),
    ).toMatchObject({ status: 403 });
  });

  it("every capability yields 404 when out of scope", () => {
    for (const capability of CAPABILITIES) {
      expect(
        evaluateBrandAccess({
          membership: { role: "owner", brandScope: "assigned" },
          capability,
          brandId: "hidden",
          assignedBrandIds: [],
        }),
        `capability ${capability} must not leak existence`,
      ).toMatchObject({ status: 404 });
    }
  });
});
