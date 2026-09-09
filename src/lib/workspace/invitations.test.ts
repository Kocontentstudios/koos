import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  resendInvitation,
} from "./invitations";
import { generateInviteToken } from "./invite-token";

function createDeps() {
  return {
    getUserByEmail: vi.fn().mockResolvedValue(undefined),
    getMembership: vi.fn().mockResolvedValue(null),
    getPendingInvitationByEmail: vi.fn().mockResolvedValue(null),
    createWorkspaceInvitation: vi.fn().mockResolvedValue({ id: "inv1" }),
    filterWorkspaceBrandIds: vi
      .fn()
      .mockImplementation(async (_w: string, ids: string[]) => ids),
    sendInviteEmail: vi.fn().mockResolvedValue(undefined),
    buildAcceptUrl: (t: string) => `https://app/invite/${t}`,
  };
}

const input = {
  workspaceId: "w1",
  workspaceName: "KO Content Studio",
  inviterName: "Seyi Idowu",
  invitedById: "u1",
  email: "new@x.com",
  role: "contributor" as const,
  brandIds: [] as string[],
  inviter: {
    role: "owner" as const,
    brandScope: "all" as const,
    assignedBrandIds: [] as string[],
  },
};

describe("createInvitation", () => {
  let deps: ReturnType<typeof createDeps>;
  beforeEach(() => {
    deps = createDeps();
  });

  it("stores the hash, emails the RAW token", async () => {
    const result = await createInvitation(deps, input);
    expect(result.ok).toBe(true);
    const stored = deps.createWorkspaceInvitation.mock.calls[0][0];
    const mail = deps.sendInviteEmail.mock.calls[0][0];
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.email).toBe("new@x.com");
    expect(stored.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 6.9 * 24 * 60 * 60 * 1000,
    );
    expect(mail.to).toBe("new@x.com");
    expect(mail.acceptUrl).toContain("/invite/");
    expect(mail.acceptUrl).not.toContain(stored.tokenHash);
  });

  it("rejects an invalid email format", async () => {
    const result = await createInvitation(deps, { ...input, email: "nope" });
    expect(result).toEqual({
      ok: false,
      error: "Enter a valid email address.",
      status: 400,
    });
    expect(deps.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it("rejects an existing member", async () => {
    deps.getUserByEmail.mockResolvedValue({ id: "u9" });
    deps.getMembership.mockResolvedValue({ id: "m9", role: "contributor" });
    const result = await createInvitation(deps, input);
    expect(result).toEqual({
      ok: false,
      error: "This person is already a member of this workspace.",
      status: 400,
    });
  });

  it("rejects a still-pending duplicate invite", async () => {
    deps.getPendingInvitationByEmail.mockResolvedValue({ id: "inv0" });
    const result = await createInvitation(deps, input);
    expect(result).toEqual({
      ok: false,
      error:
        "This email has already been invited — use Resend from the Pending tab.",
      status: 400,
    });
  });

  it("a user with an account but no membership can be invited", async () => {
    deps.getUserByEmail.mockResolvedValue({ id: "u9" });
    deps.getMembership.mockResolvedValue(null);
    const result = await createInvitation(deps, input);
    expect(result.ok).toBe(true);
  });
});

function acceptDeps() {
  return {
    getInvitationByTokenHash: vi.fn(),
    addWorkspaceMember: vi.fn().mockResolvedValue(undefined),
    getInvitationBrandIds: vi.fn().mockResolvedValue([]),
    setMemberBrandAccess: vi.fn().mockResolvedValue(undefined),
    markInvitationAccepted: vi.fn().mockResolvedValue(undefined),
    notifyOwnerMemberJoined: vi.fn().mockResolvedValue(undefined),
  };
}

function inviteRow(overrides = {}) {
  return {
    id: "inv1",
    workspaceId: "w1",
    workspaceName: "KO Content Studio",
    email: "new@x.com",
    role: "contributor" as const,
    brandScope: "all" as const,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    tokenHash: "existing-hash",
    ...overrides,
  };
}

const joiner = {
  id: "u2",
  email: "new@x.com",
  firstName: "Ada",
  lastName: "Obi",
};

describe("acceptInvitation", () => {
  let deps: ReturnType<typeof acceptDeps>;
  beforeEach(() => {
    deps = acceptDeps();
  });

  it("creates the membership BEFORE burning the invite, then notifies", async () => {
    const { token } = generateInviteToken();
    deps.getInvitationByTokenHash.mockResolvedValue(inviteRow());
    const result = await acceptInvitation(deps, { token, user: joiner });
    expect(result).toEqual({
      ok: true,
      workspaceId: "w1",
      workspaceName: "KO Content Studio",
    });
    expect(deps.addWorkspaceMember).toHaveBeenCalledWith(
      "w1",
      "u2",
      "contributor",
      "all",
    );
    // Membership first: a crash between the two calls must leave the invite
    // still acceptable, never a burned invite with no membership.
    expect(deps.addWorkspaceMember.mock.invocationCallOrder[0]).toBeLessThan(
      deps.markInvitationAccepted.mock.invocationCallOrder[0],
    );
    expect(deps.notifyOwnerMemberJoined).toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(null);
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired invite", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(deps.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("rejects an already-used invite", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ acceptedAt: new Date() }),
    );
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("binds the token to the invited email (case-insensitive)", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ email: "NEW@x.com" }),
    );
    const ok = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(ok.ok).toBe(true);

    deps.getInvitationByTokenHash.mockResolvedValue(inviteRow());
    const bad = await acceptInvitation(deps, {
      token: "x",
      user: { ...joiner, email: "other@x.com" },
    });
    expect(bad).toEqual({ ok: false, reason: "email-mismatch" });
  });

  it("binds case-insensitively when the USER email is uppercase", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(inviteRow());
    const result = await acceptInvitation(deps, {
      token: "x",
      user: { ...joiner, email: "NEW@X.COM" },
    });
    expect(result.ok).toBe(true);
  });

  it("still succeeds when the joined notification throws", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(inviteRow());
    deps.notifyOwnerMemberJoined.mockRejectedValue(new Error("smtp down"));
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result.ok).toBe(true);
  });
});

describe("resendInvitation", () => {
  /* The rotation lands before the send so the emailed link is live on arrival.
     If the send then fails, the invitee's existing link must not be collateral
     damage — they would be left with a dead token and no replacement mail. */
  it("puts the previous token back when the send fails", async () => {
    const row = inviteRow();
    const rotate = vi.fn().mockResolvedValue(undefined);
    const deps = {
      getInvitationById: vi.fn().mockResolvedValue(row),
      rotateInvitationToken: rotate,
      sendInviteEmail: vi.fn().mockRejectedValue(new Error("smtp down")),
      buildAcceptUrl: (t: string) => `https://app/invite/${t}`,
    };
    await expect(
      resendInvitation(deps, {
        invitationId: "inv1",
        workspaceId: "w1",
        workspaceName: "KO Content Studio",
        inviterName: "Seyi",
      }),
    ).rejects.toThrow("smtp down");

    expect(rotate).toHaveBeenCalledTimes(2);
    expect(rotate.mock.calls[0][1]).not.toBe("existing-hash");
    const [, restoredHash, restoredExpiry] = rotate.mock.calls[1];
    expect(restoredHash).toBe("existing-hash");
    expect(restoredExpiry).toBe(row.expiresAt);
  });

  it("rotates the token and re-emails the RAW token", async () => {
    const deps = {
      getInvitationById: vi.fn().mockResolvedValue(inviteRow()),
      rotateInvitationToken: vi.fn().mockResolvedValue(undefined),
      sendInviteEmail: vi.fn().mockResolvedValue(undefined),
      buildAcceptUrl: (t: string) => `https://app/invite/${t}`,
    };
    const result = await resendInvitation(deps, {
      invitationId: "inv1",
      workspaceId: "w1",
      workspaceName: "KO Content Studio",
      inviterName: "Seyi Idowu",
    });
    expect(result.ok).toBe(true);
    const [id, newHash, expiresAt] = deps.rotateInvitationToken.mock.calls[0];
    expect(id).toBe("inv1");
    expect(newHash).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(deps.sendInviteEmail.mock.calls[0][0].acceptUrl).not.toContain(
      newHash,
    );
  });

  it("refuses an invite belonging to another workspace", async () => {
    const deps = {
      getInvitationById: vi
        .fn()
        .mockResolvedValue(inviteRow({ workspaceId: "OTHER" })),
      rotateInvitationToken: vi.fn(),
      sendInviteEmail: vi.fn(),
      buildAcceptUrl: (t: string) => t,
    };
    const result = await resendInvitation(deps, {
      invitationId: "inv1",
      workspaceId: "w1",
      workspaceName: "KO Content Studio",
      inviterName: "Seyi",
    });
    expect(result.ok).toBe(false);
    expect(deps.rotateInvitationToken).not.toHaveBeenCalled();
  });

  it("refuses an already-accepted invite", async () => {
    const deps = {
      getInvitationById: vi
        .fn()
        .mockResolvedValue(inviteRow({ acceptedAt: new Date() })),
      rotateInvitationToken: vi.fn(),
      sendInviteEmail: vi.fn(),
      buildAcceptUrl: (t: string) => t,
    };
    const result = await resendInvitation(deps, {
      invitationId: "inv1",
      workspaceId: "w1",
      workspaceName: "KO Content Studio",
      inviterName: "Seyi",
    });
    expect(result.ok).toBe(false);
    expect(deps.rotateInvitationToken).not.toHaveBeenCalled();
    expect(deps.sendInviteEmail).not.toHaveBeenCalled();
  });
});

describe("createInvitation — role and brand scoping", () => {
  let deps: ReturnType<typeof createDeps>;
  beforeEach(() => {
    deps = createDeps();
  });

  const brandManagerInviter = {
    role: "brand_manager" as const,
    brandScope: "assigned" as const,
    assignedBrandIds: ["b1", "b2"],
  };

  it("stores the invited role and derives assigned scope from the brands", async () => {
    const result = await createInvitation(deps, {
      ...input,
      role: "brand_manager",
      brandIds: ["b1"],
    });
    expect(result.ok).toBe(true);
    const stored = deps.createWorkspaceInvitation.mock.calls[0][0];
    expect(stored.role).toBe("brand_manager");
    expect(stored.brandScope).toBe("assigned");
    expect(stored.brandIds).toEqual(["b1"]);
  });

  it("an unscoped contributor invite carries no brands", async () => {
    await createInvitation(deps, { ...input, role: "contributor" });
    const stored = deps.createWorkspaceInvitation.mock.calls[0][0];
    expect(stored.brandScope).toBe("all");
    expect(stored.brandIds).toEqual([]);
  });

  it("the invite email names the role", async () => {
    await createInvitation(deps, { ...input, role: "admin" });
    expect(deps.sendInviteEmail.mock.calls[0][0].roleLabel).toBe(
      "Workspace Admin",
    );
  });

  it("a brand manager cannot invite an admin", async () => {
    const result = await createInvitation(deps, {
      ...input,
      role: "admin",
      brandIds: ["b1"],
      inviter: brandManagerInviter,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(deps.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it("a brand manager cannot share a brand they don't hold", async () => {
    const result = await createInvitation(deps, {
      ...input,
      role: "contributor",
      brandIds: ["b9"],
      inviter: brandManagerInviter,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(deps.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  /* A brand id from another workspace is dropped before the permission check,
     so it can never be smuggled into an assignment. */
  it("drops brand ids that don't belong to the workspace", async () => {
    deps.filterWorkspaceBrandIds.mockResolvedValue([]);
    const result = await createInvitation(deps, {
      ...input,
      role: "brand_manager",
      brandIds: ["from-another-workspace"],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(deps.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it("a brand manager may invite a contributor to their own brand", async () => {
    const result = await createInvitation(deps, {
      ...input,
      role: "contributor",
      brandIds: ["b2"],
      inviter: brandManagerInviter,
    });
    expect(result.ok).toBe(true);
    const stored = deps.createWorkspaceInvitation.mock.calls[0][0];
    expect(stored.brandScope).toBe("assigned");
    expect(stored.brandIds).toEqual(["b2"]);
  });
});

describe("acceptInvitation — scope handover", () => {
  let deps: ReturnType<typeof acceptDeps>;
  beforeEach(() => {
    deps = acceptDeps();
  });

  it("copies the invitation's brands onto the new membership", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ role: "brand_manager", brandScope: "assigned" }),
    );
    deps.getInvitationBrandIds.mockResolvedValue(["b1", "b2"]);
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result.ok).toBe(true);
    expect(deps.addWorkspaceMember).toHaveBeenCalledWith(
      "w1",
      "u2",
      "brand_manager",
      "assigned",
    );
    expect(deps.setMemberBrandAccess).toHaveBeenCalledWith("w1", "u2", [
      "b1",
      "b2",
    ]);
    // Assignments must land before the invite is burned, or a crash strands a
    // scoped member with access to nothing and no replayable invite.
    expect(deps.setMemberBrandAccess.mock.invocationCallOrder[0]).toBeLessThan(
      deps.markInvitationAccepted.mock.invocationCallOrder[0],
    );
  });

  it("an unscoped invite writes no assignments", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(inviteRow());
    await acceptInvitation(deps, { token: "x", user: joiner });
    expect(deps.setMemberBrandAccess).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation — grants that vanished", () => {
  let deps: ReturnType<typeof acceptDeps>;
  beforeEach(() => {
    deps = acceptDeps();
  });

  /* workspace_invitation_brands cascades from brands, so every granted brand
     may have been deleted since the invite was sent. Joining anyway produces
     a member who reaches nothing and is told nothing. */
  it("refuses rather than joining a scoped member with no brands left", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ role: "brand_manager", brandScope: "assigned" }),
    );
    deps.getInvitationBrandIds.mockResolvedValue([]);
    const result = await acceptInvitation(deps, { token: "x", user: joiner });
    expect(result).toEqual({ ok: false, reason: "no-brands" });
    expect(deps.addWorkspaceMember).not.toHaveBeenCalled();
    // The invitation stays intact so it can be re-issued against a live brand.
    expect(deps.markInvitationAccepted).not.toHaveBeenCalled();
  });

  it("checks the grants before creating the membership", async () => {
    deps.getInvitationByTokenHash.mockResolvedValue(
      inviteRow({ role: "brand_manager", brandScope: "assigned" }),
    );
    deps.getInvitationBrandIds.mockResolvedValue(["b1"]);
    await acceptInvitation(deps, { token: "x", user: joiner });
    expect(deps.getInvitationBrandIds.mock.invocationCallOrder[0]).toBeLessThan(
      deps.addWorkspaceMember.mock.invocationCallOrder[0],
    );
  });
});
