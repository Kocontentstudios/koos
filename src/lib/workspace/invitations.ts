import { isValidEmail } from "@/lib/validation/email";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
} from "./invite-token";

/* Dependency-injected business rules (same pattern as
   src/lib/auth/password-reset.ts): pure logic here, DB/SMTP wiring in the
   routes, unit tests against mocks. */

interface InviteEmailArgs {
  to: string;
  acceptUrl: string;
  workspaceName: string;
  inviterName: string;
}

export interface CreateInviteDeps {
  getUserByEmail(email: string): Promise<{ id: string } | undefined | null>;
  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string } | null>;
  getPendingInvitationByEmail(
    workspaceId: string,
    email: string,
  ): Promise<{ id: string } | null>;
  createWorkspaceInvitation(input: {
    workspaceId: string;
    email: string;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  sendInviteEmail(args: InviteEmailArgs): Promise<void>;
  buildAcceptUrl(token: string): string;
}

export type CreateInviteResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string };

export async function createInvitation(
  deps: CreateInviteDeps,
  input: {
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
    invitedById: string;
    email: string;
  },
): Promise<CreateInviteResult> {
  const email = input.email.trim();
  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const existingUser = await deps.getUserByEmail(email);
  if (existingUser) {
    const membership = await deps.getMembership(
      input.workspaceId,
      existingUser.id,
    );
    if (membership) {
      return {
        ok: false,
        error: "This person is already a member of this workspace.",
      };
    }
  }

  if (await deps.getPendingInvitationByEmail(input.workspaceId, email)) {
    return { ok: false, error: "This email has already been invited." };
  }

  const { token, tokenHash } = generateInviteToken();
  const invitation = await deps.createWorkspaceInvitation({
    workspaceId: input.workspaceId,
    email,
    tokenHash,
    invitedById: input.invitedById,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  await deps.sendInviteEmail({
    to: email,
    acceptUrl: deps.buildAcceptUrl(token),
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
  });
  return { ok: true, invitationId: invitation.id };
}

interface InvitationRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: "owner" | "member";
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface AcceptInviteDeps {
  getInvitationByTokenHash(hash: string): Promise<InvitationRow | null>;
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: "owner" | "member",
  ): Promise<void>;
  markInvitationAccepted(id: string): Promise<void>;
  notifyOwnerMemberJoined(args: {
    workspaceId: string;
    workspaceName: string;
    memberName: string;
    memberEmail: string;
  }): Promise<void>;
}

export type AcceptInviteResult =
  | { ok: true; workspaceId: string; workspaceName: string }
  | { ok: false; reason: "invalid" | "expired" | "email-mismatch" };

export async function acceptInvitation(
  deps: AcceptInviteDeps,
  input: {
    token: string;
    user: { id: string; email: string; firstName: string; lastName: string };
  },
): Promise<AcceptInviteResult> {
  const invite = await deps.getInvitationByTokenHash(
    hashInviteToken(input.token),
  );
  if (!invite || invite.acceptedAt) return { ok: false, reason: "invalid" };
  if (Date.now() >= invite.expiresAt.getTime()) {
    return { ok: false, reason: "expired" };
  }
  // The inbox is the authentication factor: the signed-in account must own
  // the invited address. citext in the DB; compare case-insensitively here.
  if (invite.email.toLowerCase() !== input.user.email.toLowerCase()) {
    return { ok: false, reason: "email-mismatch" };
  }

  // Membership BEFORE burning the invite: a crash in between leaves a
  // re-acceptable invite (addWorkspaceMember is idempotent), never a burned
  // invite without a membership.
  await deps.addWorkspaceMember(invite.workspaceId, input.user.id, invite.role);
  await deps.markInvitationAccepted(invite.id);

  try {
    await deps.notifyOwnerMemberJoined({
      workspaceId: invite.workspaceId,
      workspaceName: invite.workspaceName,
      memberName: `${input.user.firstName} ${input.user.lastName}`.trim(),
      memberEmail: input.user.email,
    });
  } catch (err) {
    console.error("member-joined notification failed", err);
  }

  return {
    ok: true,
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspaceName,
  };
}

export interface ResendInviteDeps {
  getInvitationById(
    id: string,
  ): Promise<Omit<InvitationRow, "workspaceName"> | null>;
  rotateInvitationToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  sendInviteEmail(args: InviteEmailArgs): Promise<void>;
  buildAcceptUrl(token: string): string;
}

export async function resendInvitation(
  deps: ResendInviteDeps,
  input: {
    invitationId: string;
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
  },
): Promise<{ ok: boolean }> {
  const invite = await deps.getInvitationById(input.invitationId);
  if (
    !invite ||
    invite.workspaceId !== input.workspaceId ||
    invite.acceptedAt
  ) {
    return { ok: false };
  }
  const { token, tokenHash } = generateInviteToken();
  await deps.rotateInvitationToken(
    invite.id,
    tokenHash,
    new Date(Date.now() + INVITE_TTL_MS),
  );
  await deps.sendInviteEmail({
    to: invite.email,
    acceptUrl: deps.buildAcceptUrl(token),
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
  });
  return { ok: true };
}
