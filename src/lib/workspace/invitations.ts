import {
  type BrandScope,
  evaluateInvite,
  ROLE_LABELS,
  resolveBrandScope,
  type WorkspaceRole,
} from "@/lib/auth/workspace-access";
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
  roleLabel: string;
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
    role: WorkspaceRole;
    brandScope: BrandScope;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
    brandIds: string[];
  }): Promise<{ id: string }>;
  /** Narrows the requested brand ids to ones that really are in this
      workspace, so a forged id can never become an assignment. */
  filterWorkspaceBrandIds(
    workspaceId: string,
    brandIds: string[],
  ): Promise<string[]>;
  sendInviteEmail(args: InviteEmailArgs): Promise<void>;
  buildAcceptUrl(token: string): string;
}

export type CreateInviteResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string; status: 400 | 403 };

export async function createInvitation(
  deps: CreateInviteDeps,
  input: {
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
    invitedById: string;
    email: string;
    role: WorkspaceRole;
    brandIds: string[];
    inviter: {
      role: WorkspaceRole;
      brandScope: BrandScope;
      assignedBrandIds: string[];
    };
  },
): Promise<CreateInviteResult> {
  const email = input.email.trim();
  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid email address.", status: 400 };
  }

  /* Every id is confirmed to belong to this workspace BEFORE the permission
     check, so "is this brand mine to share?" is decided on real rows. An id
     from another workspace drops out here and then fails the subset rule. */
  const brandIds = await deps.filterWorkspaceBrandIds(
    input.workspaceId,
    input.brandIds,
  );

  const permitted = evaluateInvite({
    actorRole: input.inviter.role,
    actorBrandScope: input.inviter.brandScope,
    actorAssignedBrandIds: input.inviter.assignedBrandIds,
    invitedRole: input.role,
    brandIds,
  });
  if (!permitted.ok) {
    return { ok: false, error: permitted.error, status: permitted.status };
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
        status: 400,
      };
    }
  }

  if (await deps.getPendingInvitationByEmail(input.workspaceId, email)) {
    return {
      ok: false,
      error:
        "This email has already been invited — use Resend from the Pending tab.",
      status: 400,
    };
  }

  const brandScope = resolveBrandScope(
    input.role,
    brandIds.length > 0 ? "assigned" : null,
  );
  const { token, tokenHash } = generateInviteToken();
  const invitation = await deps.createWorkspaceInvitation({
    workspaceId: input.workspaceId,
    email,
    role: input.role,
    brandScope,
    tokenHash,
    invitedById: input.invitedById,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    brandIds: brandScope === "assigned" ? brandIds : [],
  });
  await deps.sendInviteEmail({
    to: email,
    acceptUrl: deps.buildAcceptUrl(token),
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    roleLabel: ROLE_LABELS[input.role],
  });
  return { ok: true, invitationId: invitation.id };
}

interface InvitationRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  brandScope: BrandScope;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface AcceptInviteDeps {
  getInvitationByTokenHash(hash: string): Promise<InvitationRow | null>;
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    brandScope: BrandScope,
  ): Promise<void>;
  getInvitationBrandIds(invitationId: string): Promise<string[]>;
  setMemberBrandAccess(
    workspaceId: string,
    userId: string,
    brandIds: string[],
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
  | {
      ok: false;
      reason: "invalid" | "expired" | "email-mismatch" | "no-brands";
    };

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

  /* Re-read the grants BEFORE joining anyone. workspace_invitation_brands
     cascades from brands, so every granted brand may have been deleted since
     the invite was sent; joining then produces a member who reaches nothing
     and is told nothing. Refuse instead, leaving the invite intact so it can
     be re-issued against a live brand. */
  const brandIds =
    invite.brandScope === "assigned"
      ? await deps.getInvitationBrandIds(invite.id)
      : [];
  if (invite.brandScope === "assigned" && brandIds.length === 0) {
    return { ok: false, reason: "no-brands" };
  }

  // Membership BEFORE burning the invite: a crash in between leaves a
  // re-acceptable invite (addWorkspaceMember is idempotent), never a burned
  // invite without a membership.
  await deps.addWorkspaceMember(
    invite.workspaceId,
    input.user.id,
    invite.role,
    invite.brandScope,
  );
  /* Assignments before the burn too, for the same reason: a scoped member
     with no assignments can reach nothing, so a crash here must leave the
     invite replayable rather than stranding them. */
  if (invite.brandScope === "assigned") {
    await deps.setMemberBrandAccess(
      invite.workspaceId,
      input.user.id,
      brandIds,
    );
  }
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
    roleLabel: ROLE_LABELS[invite.role],
  });
  return { ok: true };
}
