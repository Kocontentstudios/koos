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
    });
    expect(deps.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it("rejects an existing member", async () => {
    deps.getUserByEmail.mockResolvedValue({ id: "u9" });
    deps.getMembership.mockResolvedValue({ id: "m9", role: "member" });
    const result = await createInvitation(deps, input);
    expect(result).toEqual({
      ok: false,
      error: "This person is already a member of this workspace.",
    });
  });

  it("rejects a still-pending duplicate invite", async () => {
    deps.getPendingInvitationByEmail.mockResolvedValue({ id: "inv0" });
    const result = await createInvitation(deps, input);
    expect(result).toEqual({
      ok: false,
      error: "This email has already been invited.",
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
    role: "member" as const,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
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
    expect(deps.addWorkspaceMember).toHaveBeenCalledWith("w1", "u2", "member");
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
