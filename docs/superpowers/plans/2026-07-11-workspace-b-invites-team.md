# Workspace & Team — Plan B: Invitations + Team page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner can invite teammates by email; invitees accept via a single-use link (sign-in/sign-up aware) and become Members; the Team page shows members and pending invites with Resend/Remove.

**Architecture:** Token module mirrors `reset-token.ts` (raw token emailed, SHA-256 hash stored, 7-day TTL). Business rules live in a dependency-injected service (`src/lib/workspace/invitations.ts`) unit-tested like `password-reset.ts`. Thin API routes under `/api/workspace` wire the service to the guard from Plan A. A public `/invite/[token]` page handles acceptance; login/signup gain a validated `next` redirect param to route invitees back after auth.

**Tech Stack:** Next.js 15 App Router (server components + route handlers + server actions), Drizzle, Vitest, existing `sendMail`/`BuiltEmail` email stack, existing UI kit (`src/components/ui`).

**Spec:** `docs/superpowers/specs/2026-07-11-workspace-team-design.md` (sections 3, 5, 6). **Prerequisite: Plan A (`2026-07-11-workspace-a-foundation.md`) is fully merged** — this plan consumes `checkBrandAccess`, `getActiveWorkspace`, `can`, `getMembership`, and the workspace tables.

## Global Constraints

- **Always `corepack pnpm`**, never bare `pnpm`, never npm.
- Branch `feat/workspace`; commit at the end of every task.
- Invite tokens: raw token ONLY in the email link; DB stores the SHA-256 hex hash. TTL exactly 7 days. One email address per invite.
- All copy uses the prototype vocabulary: Workspace, Team, Members, Owner/Member, Invite Team, Pending.
- UI colors: adaptive tokens only (`var(--…)` / existing utility classes) — never hardcoded light-mode hexes or `text-white` on themed surfaces.
- API error shape everywhere: `{ error: string }` with correct status (400 validation, 401 unauthenticated, 403 capability, 404 not found, 429 throttled).
- Verification: `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`.

---

### Task 1: Invite token module (TDD)

**Files:**
- Create: `src/lib/workspace/invite-token.ts`
- Test: `src/lib/workspace/invite-token.test.ts`

**Interfaces:**
- Produces:

```ts
export const INVITE_TTL_MS: number; // 7 days
export function hashInviteToken(token: string): string; // sha256 hex
export function generateInviteToken(): { token: string; tokenHash: string };
```

- [ ] **Step 1: Write the failing test**

`src/lib/workspace/invite-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
} from "./invite-token";

describe("invite tokens", () => {
  it("TTL is exactly 7 days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("generates a url-safe token whose sha256 hash matches", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("two tokens never collide", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run src/lib/workspace/invite-token.test.ts`
Expected: FAIL — cannot resolve `./invite-token`.

- [ ] **Step 3: Implement**

`src/lib/workspace/invite-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw token goes in the emailed link; only its hash is stored. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run src/lib/workspace/invite-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/invite-token.ts src/lib/workspace/invite-token.test.ts
git commit -m "feat(workspace): single-use invite tokens (sha256-at-rest, 7-day TTL)"
```

---

### Task 2: Invitation DB queries

**Files:**
- Modify: `src/lib/db/queries/workspaces.ts` (append; created in Plan A Task 3)

**Interfaces:**
- Produces (re-exported via `@/lib/db/queries` through the existing `export * from "./workspaces"`):

```ts
export async function getWorkspaceMembers(workspaceId: string): Promise<Array<{
  membershipId: string; role: WorkspaceRole; joinedAt: Date;
  user: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null };
}>>;
export async function getPendingInvitations(workspaceId: string): Promise<Array<typeof workspaceInvitations.$inferSelect>>;
export async function getPendingInvitationByEmail(workspaceId: string, email: string): Promise<{ id: string } | null>;
export async function createWorkspaceInvitation(input: { workspaceId: string; email: string; tokenHash: string; invitedById: string; expiresAt: Date }): Promise<{ id: string }>;
export async function getInvitationById(id: string): Promise<typeof workspaceInvitations.$inferSelect | null>;
export async function getInvitationByTokenHash(tokenHash: string): Promise<(typeof workspaceInvitations.$inferSelect & { workspaceName: string }) | null>;
export async function rotateInvitationToken(id: string, tokenHash: string, expiresAt: Date): Promise<void>;
export async function deleteInvitation(id: string): Promise<void>;
export async function markInvitationAccepted(id: string): Promise<void>;
export async function addWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>; // idempotent
export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>; // also clears member_brand_access rows
```

- [ ] **Step 1: Append the functions**

Add to `src/lib/db/queries/workspaces.ts` (extend the schema import with `users`, `workspaceInvitations`; drizzle import with `isNull`):

```ts
// ── Members ──────────────────────────────────────────────────────────

export async function getWorkspaceMembers(workspaceId: string) {
  return db
    .select({
      membershipId: workspaceMembers.id,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
      user: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.role, workspaceMembers.createdAt);
}

/** Idempotent: accepting an invite twice (or racing) is a no-op. */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .onConflictDoNothing();
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  await db
    .delete(memberBrandAccess)
    .where(
      and(
        eq(memberBrandAccess.workspaceId, workspaceId),
        eq(memberBrandAccess.userId, userId),
      ),
    );
  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
}

// ── Invitations ──────────────────────────────────────────────────────

export async function getPendingInvitations(workspaceId: string) {
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .orderBy(desc(workspaceInvitations.createdAt));
}

/** citext column ⇒ equality is case-insensitive at the DB level. */
export async function getPendingInvitationByEmail(
  workspaceId: string,
  email: string,
) {
  const [row] = await db
    .select({ id: workspaceInvitations.id })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  email: string;
  tokenHash: string;
  invitedById: string;
  expiresAt: Date;
}) {
  const [row] = await db
    .insert(workspaceInvitations)
    .values(input)
    .returning({ id: workspaceInvitations.id });
  return row;
}

export async function getInvitationById(id: string) {
  const [row] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, id))
    .limit(1);
  return row ?? null;
}

export async function getInvitationByTokenHash(tokenHash: string) {
  const [row] = await db
    .select({
      invitation: workspaceInvitations,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1);
  return row ? { ...row.invitation, workspaceName: row.workspaceName } : null;
}

export async function rotateInvitationToken(
  id: string,
  tokenHash: string,
  expiresAt: Date,
) {
  await db
    .update(workspaceInvitations)
    .set({ tokenHash, expiresAt })
    .where(eq(workspaceInvitations.id, id));
}

export async function deleteInvitation(id: string) {
  await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, id));
}

export async function markInvitationAccepted(id: string) {
  await db
    .update(workspaceInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvitations.id, id));
}
```

- [ ] **Step 2: Typecheck + lint, commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint`
Expected: exit 0.

```bash
git add src/lib/db/queries/workspaces.ts
git commit -m "feat(db): workspace member + invitation queries"
```

---

### Task 3: Invitation service — business rules (DI, TDD)

**Files:**
- Create: `src/lib/workspace/invitations.ts`
- Test: `src/lib/workspace/invitations.test.ts`

**Interfaces:**
- Consumes: `generateInviteToken`, `hashInviteToken`, `INVITE_TTL_MS` (Task 1); `isValidEmail` from `@/lib/validation/email`.
- Produces (Tasks 5–6 wire these to routes/pages):

```ts
export type CreateInviteResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string }; // user-facing field message
export async function createInvitation(deps: CreateInviteDeps, input: {
  workspaceId: string; workspaceName: string; inviterName: string;
  invitedById: string; email: string;
}): Promise<CreateInviteResult>;

export type AcceptInviteResult =
  | { ok: true; workspaceId: string; workspaceName: string }
  | { ok: false; reason: "invalid" | "expired" | "email-mismatch" };
export async function acceptInvitation(deps: AcceptInviteDeps, input: {
  token: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}): Promise<AcceptInviteResult>;

export async function resendInvitation(deps: ResendInviteDeps, input: {
  invitationId: string; workspaceId: string; workspaceName: string; inviterName: string;
}): Promise<{ ok: boolean }>;
```

- [ ] **Step 1: Write the failing test**

`src/lib/workspace/invitations.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInviteToken } from "./invite-token";
import {
  acceptInvitation,
  createInvitation,
  resendInvitation,
} from "./invitations";

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
    expect(
      deps.addWorkspaceMember.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.markInvitationAccepted.mock.invocationCallOrder[0]);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run src/lib/workspace/invitations.test.ts`
Expected: FAIL — cannot resolve `./invitations`.

- [ ] **Step 3: Implement the service**

`src/lib/workspace/invitations.ts`:

```ts
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
  getInvitationById(id: string): Promise<InvitationRow | null>;
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
```

Note: `getInvitationById` from Task 2 returns a row WITHOUT `workspaceName`; the service's `InvitationRow` requires it only for accept. To keep one row type, have the route wiring for resend pass `getInvitationById` wrapped to add `workspaceName: ""` (unused by resend) — or loosen the resend dep's row type to `Omit<InvitationRow, "workspaceName">`. Prefer the latter: declare `getInvitationById(id): Promise<Omit<InvitationRow, "workspaceName"> | null>` in `ResendInviteDeps`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run src/lib/workspace/invitations.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/invitations.ts src/lib/workspace/invitations.test.ts
git commit -m "feat(workspace): invitation business rules (create/accept/resend, DI-tested)"
```

---

### Task 4: Email templates + notify wrapper

**Files:**
- Modify: `src/lib/email-templates.ts` (append two templates)
- Modify: `src/lib/email-templates.test.ts` (append tests)
- Create: `src/lib/notify/workspace.ts`

**Interfaces:**
- Consumes: `shell`, `escapeHtml`, `BuiltEmail` (module-private helpers in email-templates.ts — the new templates live in the same file so they can use them); `sendMail` from `@/lib/email`; `appUrl` from `@/lib/design/notify`.
- Produces:

```ts
// email-templates.ts
export interface WorkspaceInviteEmailInput {
  inviterName: string; workspaceName: string; acceptUrl: string; expiresInDays: number;
}
export function workspaceInviteEmail(i: WorkspaceInviteEmailInput): BuiltEmail;
export interface MemberJoinedEmailInput {
  memberName: string; memberEmail: string; workspaceName: string; teamUrl: string;
}
export function memberJoinedEmail(i: MemberJoinedEmailInput): BuiltEmail;
// notify/workspace.ts — both NEVER throw (log-and-continue like notify/account)
export async function sendWorkspaceInviteEmail(args: { to: string; input: WorkspaceInviteEmailInput }): Promise<void>;
export async function sendMemberJoinedEmail(args: { to: string; input: MemberJoinedEmailInput }): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/email-templates.test.ts`:

```ts
import { memberJoinedEmail, workspaceInviteEmail } from "./email-templates";

describe("workspaceInviteEmail", () => {
  const built = workspaceInviteEmail({
    inviterName: "Seyi <Owner>",
    workspaceName: "KO Content Studio",
    acceptUrl: "https://app/invite/RAWTOKEN",
    expiresInDays: 7,
  });

  it("subject names the inviter and workspace", () => {
    expect(built.subject).toBe(
      "Seyi <Owner> invited you to join KO Content Studio on KO OS",
    );
  });

  it("html carries the accept link, expiry note, and escapes names", () => {
    expect(built.html).toContain("https://app/invite/RAWTOKEN");
    expect(built.html).toContain("7 days");
    expect(built.html).toContain("Seyi &lt;Owner&gt;");
    expect(built.html).not.toContain("Seyi <Owner>");
  });
});

describe("memberJoinedEmail", () => {
  const built = memberJoinedEmail({
    memberName: "Ada Obi",
    memberEmail: "ada@x.com",
    workspaceName: "KO Content Studio",
    teamUrl: "https://app/team",
  });

  it("tells the owner who joined and links the Team page", () => {
    expect(built.subject).toBe("Ada Obi joined KO Content Studio");
    expect(built.html).toContain("ada@x.com");
    expect(built.html).toContain("https://app/team");
  });
});
```

(If the existing test file imports templates with a single named-import list, extend that list instead of adding a second import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/email-templates.test.ts`
Expected: FAIL — `workspaceInviteEmail` is not exported.

- [ ] **Step 3: Implement the templates**

Append to `src/lib/email-templates.ts`:

```ts
export interface WorkspaceInviteEmailInput {
  inviterName: string;
  workspaceName: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function workspaceInviteEmail(
  i: WorkspaceInviteEmailInput,
): BuiltEmail {
  const subject = `${i.inviterName} invited you to join ${i.workspaceName} on KO OS`;
  const html = shell(
    `Join ${i.workspaceName} on KO OS`,
    `<p style="font-size:13px"><strong>${escapeHtml(
      i.inviterName,
    )}</strong> invited you to join the <strong>${escapeHtml(
      i.workspaceName,
    )}</strong> workspace as a member of their team.</p>
    <p style="margin:16px 0"><a href="${i.acceptUrl}" style="display:inline-block;background:#138bc8;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px">Accept invitation</a></p>
    <p style="font-size:12px;color:#6b7280">This invitation expires in ${i.expiresInDays} days. If you weren't expecting it, you can ignore this email.</p>`,
  );
  return { subject, html };
}

export interface MemberJoinedEmailInput {
  memberName: string;
  memberEmail: string;
  workspaceName: string;
  teamUrl: string;
}

export function memberJoinedEmail(i: MemberJoinedEmailInput): BuiltEmail {
  const subject = `${i.memberName} joined ${i.workspaceName}`;
  const html = shell(
    `${i.memberName} joined your workspace`,
    `<p style="font-size:13px"><strong>${escapeHtml(
      i.memberName,
    )}</strong> (${escapeHtml(
      i.memberEmail,
    )}) accepted your invitation to <strong>${escapeHtml(
      i.workspaceName,
    )}</strong>.</p>
    <p style="margin-top:16px"><a href="${i.teamUrl}" style="color:#138bc8">Open your Team page →</a></p>`,
  );
  return { subject, html };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm exec vitest run src/lib/email-templates.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Write the never-throw notify wrapper**

`src/lib/notify/workspace.ts` (mirror the try/catch-log style used by `src/lib/notify/account.ts` — read that file first and match its exact logging shape):

```ts
import { sendMail } from "@/lib/email";
import {
  type MemberJoinedEmailInput,
  memberJoinedEmail,
  type WorkspaceInviteEmailInput,
  workspaceInviteEmail,
} from "@/lib/email-templates";

/** Sends the invite email. THROWS on failure — the invite route surfaces
 * "email could not be sent" to the owner instead of silently succeeding. */
export async function sendWorkspaceInviteEmail(args: {
  to: string;
  input: WorkspaceInviteEmailInput;
}): Promise<void> {
  const built = workspaceInviteEmail(args.input);
  await sendMail({ to: args.to, subject: built.subject, html: built.html });
}

/** Best-effort owner notification — never throws. */
export async function sendMemberJoinedEmail(args: {
  to: string;
  input: MemberJoinedEmailInput;
}): Promise<void> {
  try {
    const built = memberJoinedEmail(args.input);
    await sendMail({ to: args.to, subject: built.subject, html: built.html });
  } catch (err) {
    console.error("member joined email failed", { to: args.to, err });
  }
}
```

(Deliberate asymmetry: an invite whose email never went out is a lie in the Pending list, so that one propagates errors; the joined notification is best-effort.)

- [ ] **Step 6: Typecheck + lint, commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint`
Expected: exit 0.

```bash
git add src/lib/email-templates.ts src/lib/email-templates.test.ts src/lib/notify/workspace.ts
git commit -m "feat(email): workspace invite + member-joined templates and senders"
```

---

### Task 5: Team API routes

**Files:**
- Create: `src/app/api/workspace/members/route.ts` (GET)
- Create: `src/app/api/workspace/members/[userId]/route.ts` (DELETE)
- Create: `src/app/api/workspace/invitations/route.ts` (POST)
- Create: `src/app/api/workspace/invitations/[id]/route.ts` (DELETE)
- Create: `src/app/api/workspace/invitations/[id]/resend/route.ts` (POST)

**Interfaces:**
- Consumes: `getActiveWorkspace` (Plan A Task 4), `can` (Plan A Task 2), Task 2 queries, Task 3 service, Task 4 senders, `checkRateLimit`/`tooManyRequests` from `@/lib/rate-limit`, `appUrl` from `@/lib/design/notify`, `getUserByEmail` from `@/lib/db/queries`, `getUserById` from `@/lib/db/queries`.
- Produces JSON consumed by the Team page (Task 7):
  - `GET /api/workspace/members` → `{ members: [...getWorkspaceMembers rows], invitations: [{ id, email, createdAt, expiresAt }] }`
  - `POST /api/workspace/invitations` body `{ email }` → 200 `{ ok: true }` | 400 `{ error }` (the three validation messages from Task 3)
  - `DELETE /api/workspace/members/[userId]` → `{ ok: true }`
  - `POST .../resend`, `DELETE .../[id]` → `{ ok: true }`

Shared guard shape at the top of every handler:

```ts
const { dbUser, workspace, role } = await getActiveWorkspace();
if (!dbUser) {
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
```

then for owner-only handlers:

```ts
if (!can(role, "manage_team")) {
  return Response.json(
    { error: "Only the workspace owner can manage the team." },
    { status: 403 },
  );
}
```

- [ ] **Step 1: `GET /api/workspace/members`**

`src/app/api/workspace/members/route.ts` — any member may view (read-only Team page):

```ts
import { getActiveWorkspace } from "@/lib/auth/workspace";
import {
  getPendingInvitations,
  getWorkspaceMembers,
} from "@/lib/db/queries";

export async function GET() {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getPendingInvitations(workspace.id),
  ]);
  return Response.json({
    members,
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  });
}
```

- [ ] **Step 2: `POST /api/workspace/invitations`**

`src/app/api/workspace/invitations/route.ts`:

```ts
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import {
  createWorkspaceInvitation,
  getMembership,
  getPendingInvitationByEmail,
  getUserByEmail,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createInvitation } from "@/lib/workspace/invitations";

export async function POST(req: Request) {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_team")) {
    return Response.json(
      { error: "Only the workspace owner can manage the team." },
      { status: 403 },
    );
  }

  const verdict = await checkRateLimit({
    key: `invite:${dbUser.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.email) {
    return Response.json({ error: "Enter an email address." }, { status: 400 });
  }

  try {
    const result = await createInvitation(
      {
        getUserByEmail,
        getMembership,
        getPendingInvitationByEmail,
        createWorkspaceInvitation,
        sendInviteEmail: (args) =>
          sendWorkspaceInviteEmail({
            to: args.to,
            input: {
              inviterName: args.inviterName,
              workspaceName: args.workspaceName,
              acceptUrl: args.acceptUrl,
              expiresInDays: 7,
            },
          }),
        buildAcceptUrl: (token) =>
          appUrl(`/invite/${encodeURIComponent(token)}`),
      },
      {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        inviterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        invitedById: dbUser.id,
        email: body.email,
      },
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("create invitation failed", err);
    return Response.json(
      { error: "Could not send the invitation. Please try again." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: `DELETE /api/workspace/members/[userId]`**

`src/app/api/workspace/members/[userId]/route.ts`:

```ts
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getMembership, removeWorkspaceMember } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_team")) {
    return Response.json(
      { error: "Only the workspace owner can manage the team." },
      { status: 403 },
    );
  }
  if (userId === dbUser.id) {
    return Response.json(
      { error: "You can't remove yourself from your own workspace." },
      { status: 400 },
    );
  }
  if (!(await getMembership(workspace.id, userId))) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  await removeWorkspaceMember(workspace.id, userId);
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Revoke + resend routes**

`src/app/api/workspace/invitations/[id]/route.ts`:

```ts
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { deleteInvitation, getInvitationById } from "@/lib/db/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_team")) {
    return Response.json(
      { error: "Only the workspace owner can manage the team." },
      { status: 403 },
    );
  }
  const invite = await getInvitationById(id);
  if (!invite || invite.workspaceId !== workspace.id) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }
  await deleteInvitation(id);
  return Response.json({ ok: true });
}
```

`src/app/api/workspace/invitations/[id]/resend/route.ts`:

```ts
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getInvitationById, rotateInvitationToken } from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendWorkspaceInviteEmail } from "@/lib/notify/workspace";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { resendInvitation } from "@/lib/workspace/invitations";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_team")) {
    return Response.json(
      { error: "Only the workspace owner can manage the team." },
      { status: 403 },
    );
  }

  const verdict = await checkRateLimit({
    key: `invite:${dbUser.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  try {
    const result = await resendInvitation(
      {
        getInvitationById,
        rotateInvitationToken,
        sendInviteEmail: (args) =>
          sendWorkspaceInviteEmail({
            to: args.to,
            input: {
              inviterName: args.inviterName,
              workspaceName: args.workspaceName,
              acceptUrl: args.acceptUrl,
              expiresInDays: 7,
            },
          }),
        buildAcceptUrl: (token) =>
          appUrl(`/invite/${encodeURIComponent(token)}`),
      },
      {
        invitationId: id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        inviterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
      },
    );
    if (!result.ok) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("resend invitation failed", err);
    return Response.json(
      { error: "Could not resend the invitation. Please try again." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add src/app/api/workspace
git commit -m "feat(api): team routes — members list/remove, invitations create/revoke/resend"
```

---

### Task 6: `/invite/[token]` page + `next` redirect support in auth

**Files:**
- Modify: `src/app/(auth)/actions.ts` (login + signup accept a validated `next`)
- Modify: `src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx` (forward `next`, prefill email)
- Create: `src/app/invite/[token]/page.tsx`
- Create: `src/app/invite/[token]/accept-form.tsx`
- Create: `src/app/invite/actions.ts`

**Interfaces:**
- Consumes: `acceptInvitation` (Task 3), `getInvitationByTokenHash`, `addWorkspaceMember`, `markInvitationAccepted`, `getUserById` (queries), `hashInviteToken` (Task 1), `getAuthUser`, `setActiveWorkspaceCookie` (Plan A Task 4), `sendMemberJoinedEmail` (Task 4), `appUrl`.
- Produces: public route `/invite/<raw-token>`; login/signup honor `?next=/internal/path`.

- [ ] **Step 1: Add `next` support to auth actions**

In `src/app/(auth)/actions.ts` add near the top:

```ts
/** Only same-app relative paths — never absolute/protocol-relative URLs. */
function safeNext(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
```

In `login()` change the final line `redirect("/dashboard")` to:

```ts
redirect(safeNext(formData.get("next")) ?? "/dashboard");
```

Do exactly the same for the final `redirect("/dashboard")` in `signup()`. (Google OAuth is deliberately untouched: a Google-authenticated invitee lands on the dashboard and clicks the emailed link again, now signed in — acceptable v1 behavior, documented in the spec's flow.)

- [ ] **Step 2: Forward `next` + prefill email in the auth pages**

Both `login/page.tsx` and `register/page.tsx` are client components. Add at the top of each component body:

```ts
import { useSearchParams } from "next/navigation";
// inside the component:
const searchParams = useSearchParams();
const next = searchParams.get("next") ?? "";
const invitedEmail = searchParams.get("email") ?? "";
```

Inside each `<form>` add a hidden field:

```tsx
{next ? <input type="hidden" name="next" value={next} /> : null}
```

In the register page's email `<input>` add `defaultValue={invitedEmail}`; same on the login page's email input.

**Build check:** `useSearchParams()` in a statically-prerendered client page requires a Suspense boundary. If `corepack pnpm build` (or `next dev` overlay) raises `useSearchParams() should be wrapped in a suspense boundary`, fix it by splitting: move the whole existing component into `login-form.tsx` / `register-form.tsx` (still `"use client"`) and make each `page.tsx` a server component:

```tsx
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

Also update the two register/login link hrefs INSIDE those forms ("Already have an account?" links) to preserve `next`/`email` params: `` href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} `` and the mirror on the login page.

- [ ] **Step 3: Accept server action**

`src/app/invite/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import {
  addWorkspaceMember,
  getInvitationByTokenHash,
  getWorkspaceOwner,
  markInvitationAccepted,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendMemberJoinedEmail } from "@/lib/notify/workspace";
import { acceptInvitation } from "@/lib/workspace/invitations";
import { hashInviteToken } from "@/lib/workspace/invite-token";

export async function acceptInviteAction(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) redirect("/invite/invalid");

  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const result = await acceptInvitation(
    {
      getInvitationByTokenHash: (hash) => getInvitationByTokenHash(hash),
      addWorkspaceMember,
      markInvitationAccepted,
      notifyOwnerMemberJoined: async (args) => {
        // Look up the workspace owner's email for the joined notification.
        const owner = await getWorkspaceOwner(args.workspaceId);
        if (!owner) return;
        await sendMemberJoinedEmail({
          to: owner.email,
          input: {
            memberName: args.memberName,
            memberEmail: args.memberEmail,
            workspaceName: args.workspaceName,
            teamUrl: appUrl("/team"),
          },
        });
      },
    },
    {
      token,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      },
    },
  );

  if (!result.ok) redirect(`/invite/${encodeURIComponent(token)}`); // page re-renders the error state
  await setActiveWorkspaceCookie(result.workspaceId);
  redirect("/dashboard");
}
```

This needs one more query — add to `src/lib/db/queries/workspaces.ts`:

```ts
/** The owner user of a workspace (for notifications). */
export async function getWorkspaceOwner(workspaceId: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName })
    .from(workspaces)
    .innerJoin(users, eq(workspaces.ownerId, users.id))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}
```

(the action above already imports it statically from `@/lib/db/queries`).

- [ ] **Step 4: The invite page**

`src/app/invite/[token]/page.tsx` (server component, public — no dashboard chrome):

```tsx
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/get-user";
import { getInvitationByTokenHash } from "@/lib/db/queries";
import { hashInviteToken } from "@/lib/workspace/invite-token";
import { AcceptForm } from "./accept-form";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-surface-1 p-8 text-center">
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInvitationByTokenHash(hashInviteToken(token));
  const { dbUser } = await getAuthUser();

  if (!invite || invite.acceptedAt) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation link isn't valid
        </h1>
        <p className="text-sm text-muted-foreground">
          It may have been used already or revoked. Ask the workspace owner to
          send a new one.
        </p>
      </Shell>
    );
  }

  if (Date.now() >= invite.expiresAt.getTime()) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation has expired
        </h1>
        <p className="text-sm text-muted-foreground">
          Invitations last 7 days. Ask the owner of {invite.workspaceName} to
          resend it.
        </p>
      </Shell>
    );
  }

  const nextParam = encodeURIComponent(`/invite/${token}`);

  if (!dbUser) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          Join {invite.workspaceName} on KO OS
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          You've been invited as {invite.email}. Sign in or create an account
          with that email to accept.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href={`/register?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Create account
          </Link>
          <Link
            href={`/login?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </Shell>
    );
  }

  if (dbUser.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation is for a different email
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          It was sent to {invite.email}, but you're signed in as {dbUser.email}.
          Sign in with the invited address to accept.
        </p>
        <Link
          href={`/login?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
        >
          Switch account
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="mb-2 text-lg font-semibold">
        Join {invite.workspaceName}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        You'll join as a Member and get access to all of this workspace's
        brands and content.
      </p>
      <AcceptForm token={token} workspaceName={invite.workspaceName} />
    </Shell>
  );
}
```

`src/app/invite/[token]/accept-form.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
import { acceptInviteAction } from "../actions";

export function AcceptForm({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) => startTransition(() => acceptInviteAction(fd))}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Joining…" : `Join ${workspaceName}`}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Verify the flows by hand**

Run `corepack pnpm dev`, then:

1. As user A (owner): `curl -X POST -b <A's cookie> localhost:3000/api/workspace/invitations -d '{"email":"b@test.local"}' -H 'content-type: application/json'` → `{ ok: true }`; grab the accept URL from the dev SMTP log output (or query `workspace_invitations` and note you must use the RAW token from the email/log, not the hash).
2. Open the accept URL logged for the invite while signed out → see sign-in/create-account card with prefilled email links.
3. Register as `b@test.local` via the "Create account" link → after signup land back on `/invite/<token>` → click Join → land on A's workspace dashboard.
4. Re-open the same URL → "isn't valid" (single-use).
5. Sign in as an unrelated user C and open a fresh invite's URL → "different email" card.

Expected: all five behave as described.

- [ ] **Step 6: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass. (The login/register page test files — `page.test.tsx` — may need the new Suspense wrapper reflected; if they render the page component directly, point them at `LoginForm`/`RegisterForm` instead.)

```bash
git add "src/app/(auth)" src/app/invite src/lib/db/queries/workspaces.ts
git commit -m "feat(workspace): invite acceptance page + next-param auth redirects"
```

---

### Task 7: Team page

**Files:**
- Create: `src/app/(dashboard)/team/page.tsx`
- Create: `src/app/(dashboard)/team/team-client.tsx`
- Modify: `src/lib/nav.ts` (nav item + page meta)

**Interfaces:**
- Consumes: `getActiveWorkspace`, `can`, `getWorkspaceMembers`, `getPendingInvitations`; Team API routes (Task 5) from the client component; UI kit: `Tabs/TabsList/TabsTrigger/TabsContent`, `Dialog…`, `Badge`, `Avatar…`, `Spinner` (check each component's props against its file in `src/components/ui/` before use and adapt — the JSX below assumes the shadcn-style APIs those files export).

- [ ] **Step 1: Navigation entries**

In `src/lib/nav.ts` add to `MAIN_NAV` after Design Tickets (import `Users` from lucide-react):

```ts
  { title: "Team", href: "/team", icon: Users },
```

and to `PAGE_META` (before the `/admin` entry so prefix matching can't shadow it):

```ts
  {
    match: "/team",
    meta: { title: "Team", subtitle: "People with access to this workspace" },
  },
```

- [ ] **Step 2: Server page**

`src/app/(dashboard)/team/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import {
  getPendingInvitations,
  getWorkspaceMembers,
} from "@/lib/db/queries";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");

  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getPendingInvitations(workspace.id),
  ]);

  return (
    <TeamClient
      workspaceName={workspace.name}
      currentUserId={dbUser.id}
      canManage={can(role, "manage_team")}
      members={members.map((m) => ({
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`.trim(),
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
      }))}
      invitations={invitations.map((i) => ({
        id: i.id,
        email: i.email,
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}
```

- [ ] **Step 3: Client component**

`src/app/(dashboard)/team/team-client.tsx` — tabs (All Members / Pending), member rows, and owner-only actions. Complete component:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "owner" | "member";
}
interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
}

async function api(path: string, init?: RequestInit): Promise<string | null> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "Something went wrong. Please try again.";
}

function initialsOf(name: string, email: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length) return parts.map((p) => p[0]).slice(0, 2).join("");
  return email.slice(0, 2).toUpperCase();
}

function PersonRow({
  name,
  email,
  right,
}: {
  name: string;
  email: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e8a0b0] to-[#7c5cff] text-sm font-semibold text-white">
        {initialsOf(name, email)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name || email}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
      {right}
    </div>
  );
}

export function TeamClient({
  workspaceName,
  currentUserId,
  canManage,
  members,
  invitations,
}: {
  workspaceName: string;
  currentUserId: string;
  canManage: boolean;
  members: Member[];
  invitations: PendingInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function run(call: () => Promise<string | null>, after?: () => void) {
    setRowError(null);
    startTransition(async () => {
      const error = await call();
      if (error) setRowError(error);
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    startTransition(async () => {
      const error = await api("/api/workspace/invitations", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (error) setInviteError(error);
      else {
        setInviteOpen(false);
        setInviteEmail("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"}
          {invitations.length > 0 && ` · ${invitations.length} pending`}
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Invite Team
          </button>
        )}
      </div>

      {rowError && (
        <p className="text-sm text-[var(--status-error-fg)]">{rowError}</p>
      )}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">All Members</TabsTrigger>
          <TabsTrigger value="pending">
            Pending{invitations.length > 0 ? ` (${invitations.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-2">
          {members.map((m) => (
            <PersonRow
              key={m.userId}
              name={m.name}
              email={m.email}
              right={
                <div className="flex items-center gap-2">
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                    {m.role === "owner" ? "Owner" : "Member"}
                  </Badge>
                  {canManage && m.userId !== currentUserId && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setRemoveTarget(m)}
                      className="text-xs font-medium text-[var(--status-error-fg)] hover:underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  )}
                </div>
              }
            />
          ))}
        </TabsContent>

        <TabsContent value="pending" className="space-y-2">
          {invitations.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          )}
          {invitations.map((i) => (
            <PersonRow
              key={i.id}
              name=""
              email={i.email}
              right={
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Pending</Badge>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            api(`/api/workspace/invitations/${i.id}/resend`, {
                              method: "POST",
                            }),
                          )
                        }
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
                      >
                        Resend
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            api(`/api/workspace/invitations/${i.id}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                        className="text-xs font-medium text-[var(--status-error-fg)] hover:underline disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              }
            />
          ))}
        </TabsContent>
      </Tabs>

      {/* Invite Team modal — email only, per the prototype */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team</DialogTitle>
            <DialogDescription>
              They'll get an email invitation to join {workspaceName} as a
              Member.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-3">
            <Input
              type="email"
              required
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            {inviteError && (
              <p className="text-sm text-[var(--status-error-fg)]">
                {inviteError}
              </p>
            )}
            <DialogFooter>
              <button
                type="submit"
                disabled={pending}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {pending ? <Spinner /> : null}
                Send invitation
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove member confirmation */}
      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
            <DialogDescription>
              They immediately lose access to all workspace data — brands,
              campaigns, calendars, and design tickets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRemoveTarget(null)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!removeTarget) return;
                run(
                  () =>
                    api(`/api/workspace/members/${removeTarget.userId}`, {
                      method: "DELETE",
                    }),
                  () => setRemoveTarget(null),
                );
              }}
              className="rounded-lg bg-[var(--status-error-fg)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Remove Member
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

(The destructive button uses `text-white` on the error-colored button background — that is a solid action button, not a themed surface, so it's exempt from the adaptive-token rule; if `--status-error-fg` is too light in light mode for white text, use the existing destructive button variant from `src/components/ui/button.tsx` instead.)

- [ ] **Step 4: Drive it**

Run `corepack pnpm dev`:

1. As owner: `/team` shows you with the Owner badge, Invite Team button.
2. Invite an email → appears under Pending; the three validation states show field errors (try `nope`, an existing member's email, and the same email twice).
3. Resend → toast/no error; Revoke → row disappears.
4. As the member from Task 6's flow: `/team` renders read-only — no Invite/Remove/Resend buttons anywhere.

Expected: all four hold.

- [ ] **Step 5: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add "src/app/(dashboard)/team" src/lib/nav.ts
git commit -m "feat(team): team page with invite/resend/remove and read-only member view"
```

---

### Task 8: Workspace-scope the ticket pages and lists

*Added after Plan A's final review: the API layer already grants teammates ticket access via `checkBrandAccess`, but the dashboard PAGES still filter by `ticket.userId` — a teammate could download a ticket's deliverables through the API yet get `notFound()` on the ticket page and see an empty ticket list. Fix the inconsistency before the Team feature makes it visible.*

**Files:**
- Modify: `src/lib/db/queries/workspaces.ts` (one new query)
- Modify: `src/app/(dashboard)/design-request/page.tsx` (list)
- Modify: `src/app/(dashboard)/design-request/[id]/page.tsx` (detail, line ~40)
- Modify: `src/app/(dashboard)/calendar/page.tsx` (line ~70) and `src/app/(dashboard)/dashboard/page.tsx` (line ~57) — both call `getDesignTicketsByUser`

**Interfaces:**
- Consumes: `checkBrandAccess`, `getBrandsForMember` (Plan A), `requireBrand()` returning `{ dbUser, workspace, role, brand }`.
- Produces: `getDesignTicketsForMember(workspaceId: string, userId: string)` — same row shape as `getDesignTicketsByUser`.

- [ ] **Step 1: Add the workspace-scoped ticket query**

Append to `src/lib/db/queries/workspaces.ts` (extend imports with `designTickets` from schema):

```ts
/** Tickets across every brand this member can see (honors member_brand_access). */
export async function getDesignTicketsForMember(
  workspaceId: string,
  userId: string,
) {
  const visibleBrands = await getBrandsForMember(workspaceId, userId);
  if (visibleBrands.length === 0) return [];
  return db
    .select()
    .from(designTickets)
    .where(
      inArray(
        designTickets.brandId,
        visibleBrands.map((b) => b.id),
      ),
    )
    .orderBy(desc(designTickets.createdAt));
}
```

Before writing, read `getDesignTicketsByUser` in `src/lib/db/queries/index.ts` — if it returns a joined/mapped shape rather than raw rows, mirror that shape exactly so the pages' rendering code is untouched.

- [ ] **Step 2: Swap the three list call sites**

In `design-request/page.tsx`, `calendar/page.tsx`, `dashboard/page.tsx`: these already call `requireBrand()`; replace `getDesignTicketsByUser(dbUser.id)` with `getDesignTicketsForMember(workspace.id, dbUser.id)` (destructure `workspace` from the existing `requireBrand()` result).

- [ ] **Step 3: Fix the detail-page check**

In `design-request/[id]/page.tsx`, replace the `ticket.userId !== dbUser.id` guard with:

```ts
const access = await checkBrandAccess(dbUser.id, ticket.brandId, "manage_content");
if (!access.ok) notFound();
```

keeping any existing designer/admin allowances exactly as they are.

- [ ] **Step 4: Gate and commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

Run: `grep -rn "getDesignTicketsByUser" src/app` — expected: no hits.

```bash
git add src/lib/db/queries/workspaces.ts "src/app/(dashboard)"
git commit -m "refactor(tickets): workspace-scope ticket pages and lists"
```

---

### Task 9: Plan-level verification

- [ ] **Step 1: Full gate**

Run: `corepack pnpm test && corepack pnpm lint && corepack pnpm exec tsc --noEmit && corepack pnpm build`
Expected: all pass (build also proves the Suspense/useSearchParams handling).

- [ ] **Step 2: End-to-end invite lifecycle**

With `corepack pnpm dev`, run the whole story once: invite → email link (from logs) → register → auto-join → owner receives member-joined email → member sees owner's brand content → owner removes member → member's next request falls back to their personal workspace.

Expected: every step matches the spec's flows; the removed member is NOT stuck (lands in their own workspace).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(workspace): invite flow verification fixes" # only if needed
```

Plan C (`2026-07-11-workspace-c-switcher-settings.md`) adds the Workspace Card/Switcher, Settings page, and dashboard team cards.
