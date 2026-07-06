# Batch 5b: Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete forgot-password → email link → reset-password flow: single-use, 1-hour tokens stored as SHA-256 hashes, no email enumeration, all sessions invalidated on success.

**Architecture:** New `password_reset_tokens` table (migration 0006, hand-written SQL per repo convention). Token security mirrors the sessions table: the raw token lives only in the emailed link; the DB stores its SHA-256 hex hash. Core logic lives in a dependency-injected `src/lib/auth/password-reset.ts` (testable like `ensure-conversation.ts`); thin server actions in `(auth)/actions.ts` wrap it; two new pages under the `(auth)` route group reuse the login page's card layout.

**Tech Stack:** Drizzle + hand-written SQL migration via `scripts/migrate.mjs`; `@node-rs/argon2` via existing `hashPassword`; node `crypto` for tokens; vitest + RTL.

## Global Constraints

- Before EVERY commit: full `npx vitest run` green, `npx tsc --noEmit -p tsconfig.json` clean, `npx biome check <touched files>` clean.
- NO new dependencies. `pnpm-lock.yaml` untouched.
- Migrations: hand-write `drizzle/0006_password_reset_tokens.sql` (drizzle/meta is gitignored — never `db:push`, never `drizzle-kit generate`). Apply locally with `node scripts/migrate.mjs`.
- No email enumeration: `requestPasswordReset` returns the same success message whether or not the email exists.
- Token: 32 random bytes base64url in the link; SHA-256 hex hash in the DB; 60-minute expiry; single-use (`used_at`); one active token per user (new request deletes older ones).
- On successful reset: update `passwordHash`, mark token used, `invalidateUserSessions(userId)` (exists in `src/lib/auth/session.ts`).
- Password rule matches signup: minimum 6 characters.
- Emails use the never-throw wrapper pattern; the request action still reports generic success if the send fails (no enumeration side channel via error states).

---

### Task 1: Token table — schema, migration 0006, queries

**Files:**
- Modify: `src/lib/db/schema.ts` (after the `sessions` table)
- Create: `drizzle/0006_password_reset_tokens.sql`
- Modify: `src/lib/db/queries/index.ts`

**Interfaces:**
- Produces:
  - `passwordResetTokens` drizzle table.
  - `createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date })` — deletes the user's existing tokens, inserts, returns the row.
  - `getPasswordResetTokenByHash(tokenHash: string)` — row or undefined.
  - `markPasswordResetTokenUsed(id: string)` — sets `usedAt: new Date()`.
  - `updateUserPassword(userId: string, passwordHash: string)` — updates `passwordHash` + `updatedAt`.

- [ ] **Step 1: Schema.** In `src/lib/db/schema.ts`, after `sessions`:

```ts
// Single-use password-reset tokens. Stores only the SHA-256 hash of the raw
// token emailed to the user (same never-store-the-secret rule as sessions).
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Migration.** Create `drizzle/0006_password_reset_tokens.sql` (match 0004's style; `--> statement-breakpoint` between statements):

```sql
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" ("user_id");
```

- [ ] **Step 3: Apply locally** — `node scripts/migrate.mjs`. Expected: applies 0006, ledger row added. Verify: `psql`-free check via a one-off `node -e` drizzle query is unnecessary — the migrate script errors loudly on failure.

- [ ] **Step 4: Queries.** In `src/lib/db/queries/index.ts` (new section after the sessions/user helpers; import `passwordResetTokens` in the schema import list):

```ts
// ── Password reset ──────────────────────────────────────────────────

export async function createPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return db.transaction(async (tx) => {
    // One active token per user: a new request supersedes older links.
    await tx
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, input.userId));
    const [row] = await tx.insert(passwordResetTokens).values(input).returning();
    return row;
  });
}

export async function getPasswordResetTokenByHash(tokenHash: string) {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function markPasswordResetTokenUsed(id: string) {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

export async function updateUserPassword(userId: string, passwordHash: string) {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
```

No unit tests for these (repo convention: DB query helpers are exercised via mocked consumers). The deliverable check for this task is the migration applying cleanly + tsc.

- [ ] **Step 5: Full gate** — `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, biome on the two TS files.

- [ ] **Step 6: Commit** — `git add drizzle/0006_password_reset_tokens.sql src/lib/db/schema.ts src/lib/db/queries/index.ts && git commit -m "feat(auth): password_reset_tokens table, migration 0006, queries"`

---

### Task 2: Token helper + reset email template/wrapper

**Files:**
- Create: `src/lib/auth/reset-token.ts`
- Create: `src/lib/auth/reset-token.test.ts`
- Modify: `src/lib/email-templates.ts`
- Modify: `src/lib/email-templates.test.ts`
- Modify: `src/lib/notify/account.ts`

**Interfaces:**
- Produces:
  - `generateResetToken(): { token: string; tokenHash: string }` — 32 random bytes base64url + its SHA-256 hex.
  - `hashResetToken(token: string): string` — SHA-256 hex (for lookup on the consume side).
  - `RESET_TOKEN_TTL_MS = 60 * 60 * 1000` (exported const).
  - `passwordResetEmail(i: { firstName: string; resetUrl: string }): BuiltEmail`.
  - `sendPasswordResetEmail(args: { to: string; input: PasswordResetEmailInput }): Promise<void>` in `src/lib/notify/account.ts` — never throws.

- [ ] **Step 1: Failing tests.** `src/lib/auth/reset-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateResetToken, hashResetToken } from "./reset-token";

describe("reset token", () => {
  it("hash matches its own token deterministically", () => {
    const { token, tokenHash } = generateResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokens are unique and URL-safe", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });
});
```

And in `email-templates.test.ts`:

```ts
describe("passwordResetEmail", () => {
  it("links the reset URL and warns about expiry", () => {
    const { subject, html } = passwordResetEmail({
      firstName: "Sam",
      resetUrl: "https://app/reset-password?token=abc",
    });
    expect(subject).toContain("Reset");
    expect(html).toContain("https://app/reset-password?token=abc");
    expect(html).toContain("Sam");
    expect(html.toLowerCase()).toContain("hour");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** `src/lib/auth/reset-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw token goes in the emailed link; only its hash is stored. */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}
```

`email-templates.ts` — append:

```ts
export interface PasswordResetEmailInput {
  firstName: string;
  resetUrl: string;
}

export function passwordResetEmail(i: PasswordResetEmailInput): BuiltEmail {
  const html = shell(
    "Reset your KO OS password",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, we received a request to reset your password. This link is valid for 1 hour and can be used once:</p>
    <p style="margin-top:16px"><a href="${i.resetUrl}" style="color:#138bc8">Reset your password →</a></p>
    <p style="font-size:12px;color:#6b7280;margin-top:16px">If you didn't request this, you can safely ignore this email — your password is unchanged.</p>`,
  );
  return { subject: "Reset your KO OS password", html };
}
```

`src/lib/notify/account.ts` — append (same never-throw shape as its siblings):

```ts
/** Send the password-reset link. Never throws. */
export async function sendPasswordResetEmail(args: {
  to: string;
  input: PasswordResetEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = passwordResetEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("password reset email failed", { to: args.to, err });
  }
}
```

(extend the existing import from `@/lib/email-templates` with `passwordResetEmail`, `type PasswordResetEmailInput`.)

- [ ] **Step 4: Full gate** — `npx vitest run`, tsc, biome on the five touched files.

- [ ] **Step 5: Commit** — `git commit -m "feat(auth): reset-token helper + password-reset email"`

---

### Task 3: Core flow logic (DI) + server actions

**Files:**
- Create: `src/lib/auth/password-reset.ts`
- Create: `src/lib/auth/password-reset.test.ts`
- Modify: `src/app/(auth)/actions.ts`

**Interfaces:**
- Consumes: Task 1 queries, Task 2 helpers/wrapper, `hashPassword` from `@/lib/auth/password`, `invalidateUserSessions` from `@/lib/auth/session`, `appUrl` from `@/lib/design/notify`, `isValidEmail` from `@/lib/validation/email`.
- Produces (`src/lib/auth/password-reset.ts` — deps injected like `ensure-conversation.ts`):

```ts
export interface RequestResetDeps {
  getUserByEmail: (email: string) => Promise<{ id: string; firstName: string; email: string } | undefined>;
  createPasswordResetToken: (input: { userId: string; tokenHash: string; expiresAt: Date }) => Promise<unknown>;
  sendPasswordResetEmail: (args: { to: string; input: { firstName: string; resetUrl: string } }) => Promise<void>;
}
export async function requestReset(deps: RequestResetDeps, email: string): Promise<void>;

export interface PerformResetDeps {
  getPasswordResetTokenByHash: (hash: string) => Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | undefined>;
  updateUserPassword: (userId: string, passwordHash: string) => Promise<void>;
  markPasswordResetTokenUsed: (id: string) => Promise<void>;
  invalidateUserSessions: (userId: string) => Promise<void>;
  hashPassword: (plain: string) => Promise<string>;
}
export type ResetResult = { ok: true } | { ok: false; error: string };
export async function performReset(deps: PerformResetDeps, input: { token: string; password: string }): Promise<ResetResult>;
```

- Server actions in `(auth)/actions.ts`: `requestPasswordReset(formData)` → always `{ success: string }` (or `{ error }` only for a blank/invalid-shape email — that's client input, not enumeration); `resetPassword(formData)` → `{ error: string }` on failure, `redirect("/login?reset=1")` on success.

- [ ] **Step 1: Failing tests** (`password-reset.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateResetToken } from "./reset-token";
import { performReset, requestReset } from "./password-reset";

function requestDeps() {
  return {
    getUserByEmail: vi.fn(),
    createPasswordResetToken: vi.fn().mockResolvedValue({}),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  };
}

describe("requestReset", () => {
  it("creates a token and emails a link containing the RAW token", async () => {
    const deps = requestDeps();
    deps.getUserByEmail.mockResolvedValue({
      id: "u1",
      firstName: "Sam",
      email: "sam@x.com",
    });
    await requestReset(deps, "sam@x.com");
    const stored = deps.createPasswordResetToken.mock.calls[0][0];
    const emailed = deps.sendPasswordResetEmail.mock.calls[0][0];
    expect(stored.userId).toBe("u1");
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(emailed.to).toBe("sam@x.com");
    // The link must carry the raw token, never the hash.
    expect(emailed.input.resetUrl).toContain("/reset-password?token=");
    expect(emailed.input.resetUrl).not.toContain(stored.tokenHash);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does nothing (silently) for an unknown email", async () => {
    const deps = requestDeps();
    deps.getUserByEmail.mockResolvedValue(undefined);
    await requestReset(deps, "ghost@x.com");
    expect(deps.createPasswordResetToken).not.toHaveBeenCalled();
    expect(deps.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

function performDeps() {
  return {
    getPasswordResetTokenByHash: vi.fn(),
    updateUserPassword: vi.fn().mockResolvedValue(undefined),
    markPasswordResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
    hashPassword: vi.fn().mockResolvedValue("argon-hash"),
  };
}

function validRow(overrides = {}) {
  return {
    id: "prt1",
    userId: "u1",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  };
}

describe("performReset", () => {
  let deps: ReturnType<typeof performDeps>;
  beforeEach(() => {
    deps = performDeps();
  });

  it("updates the password, burns the token, kills sessions", async () => {
    const { token } = generateResetToken();
    deps.getPasswordResetTokenByHash.mockResolvedValue(validRow());
    const result = await performReset(deps, { token, password: "newpass1" });
    expect(result).toEqual({ ok: true });
    expect(deps.updateUserPassword).toHaveBeenCalledWith("u1", "argon-hash");
    expect(deps.markPasswordResetTokenUsed).toHaveBeenCalledWith("prt1");
    expect(deps.invalidateUserSessions).toHaveBeenCalledWith("u1");
  });

  it("rejects an unknown token", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(undefined);
    const result = await performReset(deps, { token: "zzz", password: "newpass1" });
    expect(result.ok).toBe(false);
    expect(deps.updateUserPassword).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(
      validRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const result = await performReset(deps, { token: "t", password: "newpass1" });
    expect(result.ok).toBe(false);
  });

  it("rejects an already-used token (single-use)", async () => {
    deps.getPasswordResetTokenByHash.mockResolvedValue(
      validRow({ usedAt: new Date() }),
    );
    const result = await performReset(deps, { token: "t", password: "newpass1" });
    expect(result.ok).toBe(false);
  });

  it("rejects a short password before touching the DB", async () => {
    const result = await performReset(deps, { token: "t", password: "abc" });
    expect(result.ok).toBe(false);
    expect(deps.getPasswordResetTokenByHash).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/lib/auth/password-reset.ts`:**

```ts
import { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } from "./reset-token";

export interface RequestResetDeps {
  getUserByEmail: (
    email: string,
  ) => Promise<{ id: string; firstName: string; email: string } | undefined>;
  createPasswordResetToken: (input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<unknown>;
  sendPasswordResetEmail: (args: {
    to: string;
    input: { firstName: string; resetUrl: string };
  }) => Promise<void>;
  buildResetUrl: (token: string) => string;
}

/** Issue a reset token and email the link. Silently no-ops for unknown
 * emails so the caller can always report generic success (no enumeration). */
export async function requestReset(
  deps: RequestResetDeps,
  email: string,
): Promise<void> {
  const user = await deps.getUserByEmail(email);
  if (!user) return;
  const { token, tokenHash } = generateResetToken();
  await deps.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  await deps.sendPasswordResetEmail({
    to: user.email,
    input: { firstName: user.firstName, resetUrl: deps.buildResetUrl(token) },
  });
}

export interface PerformResetDeps {
  getPasswordResetTokenByHash: (hash: string) => Promise<
    | { id: string; userId: string; expiresAt: Date; usedAt: Date | null }
    | undefined
  >;
  updateUserPassword: (userId: string, passwordHash: string) => Promise<void>;
  markPasswordResetTokenUsed: (id: string) => Promise<void>;
  invalidateUserSessions: (userId: string) => Promise<void>;
  hashPassword: (plain: string) => Promise<string>;
}

export type ResetResult = { ok: true } | { ok: false; error: string };

const INVALID_LINK =
  "This reset link is invalid or has expired. Please request a new one.";

export async function performReset(
  deps: PerformResetDeps,
  input: { token: string; password: string },
): Promise<ResetResult> {
  if (input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const row = await deps.getPasswordResetTokenByHash(
    hashResetToken(input.token),
  );
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: INVALID_LINK };
  }
  const passwordHash = await deps.hashPassword(input.password);
  await deps.updateUserPassword(row.userId, passwordHash);
  await deps.markPasswordResetTokenUsed(row.id);
  await deps.invalidateUserSessions(row.userId);
  return { ok: true };
}
```

NOTE: the test file above doesn't pass `buildResetUrl` — add it to `requestDeps()` in the test as `buildResetUrl: (t: string) => `/reset-password?token=${t}``. (Adjust the test when writing it; listed here so the interface is authoritative.)

- [ ] **Step 4: Server actions.** In `src/app/(auth)/actions.ts` append (imports: `requestReset`, `performReset` from `@/lib/auth/password-reset`; `hashPassword` already imported; `invalidateUserSessions` from `@/lib/auth/session`; `appUrl` from `@/lib/design/notify`; `sendPasswordResetEmail` from `@/lib/notify/account`; queries from `@/lib/db/queries`; `isValidEmail` from `@/lib/validation/email`):

```ts
export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  if (!email || !isValidEmail(email)) {
    return { error: "Please enter a valid email address." };
  }
  await requestReset(
    {
      getUserByEmail,
      createPasswordResetToken,
      sendPasswordResetEmail,
      buildResetUrl: (token) =>
        appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
    },
    email,
  );
  // Same message whether or not the account exists.
  return {
    success: "If an account exists for that email, a reset link is on its way.",
  };
}

export async function resetPassword(formData: FormData) {
  const token = (formData.get("token") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";
  const confirm = (formData.get("confirm") as string) ?? "";
  if (!token) {
    return { error: "This reset link is invalid. Please request a new one." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }
  const result = await performReset(
    {
      getPasswordResetTokenByHash,
      updateUserPassword,
      markPasswordResetTokenUsed,
      invalidateUserSessions,
      hashPassword,
    },
    { token, password },
  );
  if (!result.ok) {
    return { error: result.error };
  }
  redirect("/login?reset=1");
}
```

- [ ] **Step 5: Full gate** — `npx vitest run`, tsc, biome on the three touched files.

- [ ] **Step 6: Commit** — `git commit -m "feat(auth): password reset request + perform flow (DI core, server actions)"`

---

### Task 4: Forgot/reset pages + login link

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/app/(auth)/forgot-password/page.test.tsx`
- Modify: `src/app/(auth)/login/page.tsx` (add "Forgot password?" link + success banner for `?reset=1`)

**Interfaces:**
- Consumes: `requestPasswordReset`, `resetPassword` actions from `../actions`; `Spinner`, `cn` (same imports as login page).
- Both pages are client components (`useActionState`), visually cloned from the login card: same background orbs, same card div, same KO OS wordmark `Link`, same input/button classes. Copy those classNames verbatim from `login/page.tsx` — do not invent new styles.

- [ ] **Step 1: Failing component test** (`forgot-password/page.test.tsx`, style-match `step-basics.test.tsx` / existing auth page tests):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./page";

vi.mock("../actions", () => ({
  requestPasswordReset: vi.fn(),
}));

describe("ForgotPasswordPage", () => {
  it("renders an email field and submit button", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset link/i }),
    ).toBeInTheDocument();
  });

  it("links back to login", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Build `forgot-password/page.tsx`.** Structure (reuse login page's exact wrapper/card/wordmark/input/button JSX and classNames):

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { requestPasswordReset } from "../actions";

type State = { error?: string; success?: string } | null;

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await requestPasswordReset(formData)) ?? null,
    null,
  );

  return (
    /* login page wrapper + orbs + card + wordmark, copied verbatim */
    /* header: h1 "Reset your password", sub "Enter your email and we'll send you a reset link." */
    /* error banner div (same classes as login) when state?.error */
    /* success banner when state?.success — same box, but border/bg from the
       success-ish neutral: reuse the error box classes with
       text-[var(--status-success-fg)] if a success token exists; otherwise
       plain text-[var(--text-secondary)] */
    /* form: email input (name="email", required, type="email"), submit button
       labeled "Send Reset Link" / pending "Sending…" with <Spinner /> */
    /* footer: <Link href="/login">Back to sign in.</Link> */
  );
}
```

(The commented skeleton is structural guidance; the actual JSX must be complete, copied from login/page.tsx with the fields swapped. Check `globals.css`/theme for `--status-success-fg` before using it — the light-mode token rule.)

- [ ] **Step 4: Build `reset-password/page.tsx`.** Same card. Reads the token from the URL on the client:

```tsx
"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { resetPassword } from "../actions";

type State = { error?: string } | null;

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [showPw, setShowPw] = useState(false);
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await resetPassword(formData)) ?? null,
    null,
  );

  if (!token) {
    return (
      /* card with error text "This reset link is invalid or has expired." and
         a Link to /forgot-password: "Request a new link." */
    );
  }

  return (
    /* card: h1 "Choose a new password"
       form: <input type="hidden" name="token" value={token} />
             password input (name="password", min 6, show/hide toggle copied from login)
             confirm input (name="confirm", type="password")
             submit "Reset Password" / "Resetting…"
       error banner when state?.error
       footer link to /login */
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
```

(`useSearchParams` requires the `Suspense` wrapper in the App Router — without it, `next build` fails the page's prerender.)

- [ ] **Step 5: Login page additions.** In `login/page.tsx`:
  - Under the password field (inside the form, right-aligned): `<div className="flex justify-end -mt-3"><Link className="text-xs text-primary hover:text-[var(--primary-hover)] font-semibold transition-colors" href="/forgot-password">Forgot password?</Link></div>`
  - Success banner: the existing `useEffect` reads `?error=`; extend it to also read `?reset=1` into a `resetDone` state, rendered above the form in the same banner style but success-toned: `Password updated. Sign in with your new password.`

- [ ] **Step 6: Full gate** — `npx vitest run` (component tests + suite), `npx tsc --noEmit -p tsconfig.json`, biome on the four touched files. Also run `npx next build` once for this task — it's the only check that catches a missing Suspense around `useSearchParams`. (If the build needs env vars that aren't set locally, note it and rely on tsc + tests.)

- [ ] **Step 7: Commit** — `git commit -m "feat(auth): forgot/reset password pages + login link"`

---

## Deploy runbook (not code)

1. Run `drizzle/0006_password_reset_tokens.sql` against prod before/with deploy (migrate.mjs runs in build — verify the build log shows 0006 applied).
2. `NEXT_PUBLIC_APP_URL` must be the real prod origin — it's baked into every reset link.
3. Live smoke: request reset → email arrives → link resets → old session is signed out → token reuse rejected.

## Self-review notes (already applied)

- Enumeration: request path always returns the same success copy; only shape-invalid emails get an error (client-side input problem, not account probing).
- Single-use + supersede: `createPasswordResetToken` deletes prior tokens; `performReset` checks `usedAt` and marks used before returning.
- Google-provider users may set a password via this flow (they prove mailbox ownership); that's intended — it enables email/password login alongside Google.
- Sessions invalidated on reset via existing `invalidateUserSessions`.
