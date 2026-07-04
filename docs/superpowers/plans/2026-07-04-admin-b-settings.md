# Admin Part B — System Settings (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only settings page storing the design-team notification email in the DB (consumed by the design-request emails), with SMTP status shown read-only. Secrets stay in env.

**Architecture:** A singleton `app_settings` row. `getDesignTeamEmail()` becomes async and prefers the DB value over env. An admin-only `/admin/settings` page + `POST /api/admin/settings` route edit it. Part B of the 4-part admin feature (A, C done; B now; then D). Scope is deliberately minimal (YAGNI): only the design-team email — the one setting with a real consumer — plus a read-only SMTP status. Feature toggles / due-date offset are deferred until they have a consumer.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + postgres.js, Biome.

## Global Constraints

- Scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test`; typecheck = `npx tsc --noEmit`; apply migrations = `npm run db:migrate` (idempotent; `.env` = shared prod DB).
- Migrations are hand-written `drizzle/NNNN_*.sql` (drizzle DDL format) — no `db:generate`/`db:push`.
- **Secrets stay in env.** The settings page/route never store or display SMTP credentials — only a boolean "configured?" status derived from `process.env`.
- Auth: settings are **admin-only** — page uses `requireRole(["admin"])`; the route checks `dbUser.role !== "admin"` → 403 (note: stricter than the designer-or-admin actions elsewhere).
- Reuse `isValidEmail` (`@/lib/validation/email`), the existing `Input`/`Label`/`Button` components, CSS-variable tokens.
- Recipient fallback stays: DB `designTeamEmail` → `DESIGN_TEAM_EMAIL` → `ZOHO_MAIL_FROM` → `ZOHO_SMTP_USER`.
- One commit per task.

---

### Task 1: `app_settings` schema + migration (applied)

**Files:**
- Modify: `src/lib/db/schema.ts` (add table at the end, after `ticketUpdates`)
- Create: `drizzle/0004_app_settings.sql`

**Interfaces:**
- Produces: singleton `appSettings` table — `id integer PK (always 1)`, `designTeamEmail text | null`, `updatedAt timestamp`.

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, after the `ticketUpdates` table, add:

```ts
// Singleton row (id is always 1) holding admin-editable app configuration.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  designTeamEmail: text("design_team_email"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

(`integer`, `text`, `timestamp`, `pgTable` are already imported in this file.)

- [ ] **Step 2: Write the migration**

Create `drizzle/0004_app_settings.sql`:

```sql
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"design_team_email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: `✓ applied 0004_app_settings.sql (1 statement(s))` then `✓ Migrations up to date.`

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0004_app_settings.sql
git commit -m "feat(admin): app_settings singleton table"
```

---

### Task 2: Settings queries + make `getDesignTeamEmail` DB-aware

**Files:**
- Modify: `src/lib/db/queries/index.ts` (add `appSettings` to the schema import; add settings queries)
- Modify: `src/lib/design/notify.ts` (make `getDesignTeamEmail` async, DB-first)

**Interfaces:**
- Consumes: `appSettings` (Task 1), `db`, `eq`.
- Produces:
  ```ts
  getAppSettings(): Promise<{ id: number; designTeamEmail: string | null; updatedAt: Date } | null>
  updateAppSettings(data: { designTeamEmail: string | null }): Promise<app_settings row>
  getDesignTeamEmail(): Promise<string>   // was sync; now async, DB-first then env fallbacks
  ```

- [ ] **Step 1: Add `appSettings` to the schema import + settings queries**

In `src/lib/db/queries/index.ts`, add `appSettings` to the existing schema import. Then add at the end of the file:

```ts
// ── App settings ────────────────────────────────────────────────────

export async function getAppSettings() {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  return row ?? null;
}

export async function updateAppSettings(data: { designTeamEmail: string | null }) {
  const [row] = await db
    .insert(appSettings)
    .values({ id: 1, designTeamEmail: data.designTeamEmail, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { designTeamEmail: data.designTeamEmail, updatedAt: new Date() },
    })
    .returning();
  return row;
}
```

- [ ] **Step 2: Make `getDesignTeamEmail` async and DB-first**

In `src/lib/design/notify.ts`:

(a) Add the query import (merge with any existing `@/lib/db/queries` import, or add a new import line):

```ts
import { getAppSettings } from "@/lib/db/queries";
```

(b) Replace `getDesignTeamEmail` with:

```ts
/** Design-team inbox: DB setting first, then env fallbacks. */
export async function getDesignTeamEmail(): Promise<string> {
  const settings = await getAppSettings();
  return (
    settings?.designTeamEmail ||
    process.env.DESIGN_TEAM_EMAIL ||
    process.env.ZOHO_MAIL_FROM ||
    process.env.ZOHO_SMTP_USER ||
    ""
  ).trim();
}
```

(c) In `sendDesignRequestEmails`, change `const team = getDesignTeamEmail();` to `const team = await getDesignTeamEmail();` (it's already an async function).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS (no other caller of `getDesignTeamEmail` exists — it's only used inside `sendDesignRequestEmails`).
Run: `npm run lint` → clean for the two files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/queries/index.ts src/lib/design/notify.ts
git commit -m "feat(admin): app settings queries; design-team email now DB-first"
```

---

### Task 3: `POST /api/admin/settings` route (admin-only)

**Files:**
- Create: `src/app/api/admin/settings/route.ts`

**Interfaces:**
- Consumes: `getAuthUser`; `updateAppSettings` (Task 2); `isValidEmail`.
- Produces: `POST` accepting `{ designTeamEmail?: string | null }`; admin-only; validates a non-empty email; stores `trimmed || null`; returns `{ ok: true, settings }`.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/settings/route.ts`:

```ts
import { getAuthUser } from "@/lib/auth/get-user";
import { updateAppSettings } from "@/lib/db/queries";
import { isValidEmail } from "@/lib/validation/email";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || dbUser.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { designTeamEmail?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const designTeamEmail = body.designTeamEmail?.trim() || null;
  if (designTeamEmail && !isValidEmail(designTeamEmail)) {
    return Response.json(
      { error: "Enter a valid email address, or leave it blank." },
      { status: 400 },
    );
  }

  const settings = await updateAppSettings({ designTeamEmail });
  return Response.json({ ok: true, settings });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → clean for the new route.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/settings/route.ts"
git commit -m "feat(admin): admin-only settings update route"
```

---

### Task 4: `/admin/settings` page + form + nav link

**Files:**
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/app/admin/settings/settings-form.tsx` (client)
- Modify: `src/app/admin/layout.tsx` (add admin-only Settings nav link)

**Interfaces:**
- Consumes: `requireRole`, `getAppSettings` (Task 2); the settings route (Task 3).
- Produces: `/admin/settings` (admin-only) with a design-team-email form and a read-only SMTP status line.

- [ ] **Step 1: Create the settings form (client)**

Create `src/app/admin/settings/settings-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  initialDesignTeamEmail,
}: {
  initialDesignTeamEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialDesignTeamEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designTeamEmail: email.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not save settings.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="design-team-email">Design team notification email</Label>
        <Input
          id="design-team-email"
          type="email"
          value={email}
          disabled={pending}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="design@yourcompany.com"
        />
        <p className="text-[11px] text-[var(--text-muted)]">
          New design requests are emailed here. Leave blank to use the mail
          account's default address.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      <Button
        variant="default"
        loading={pending}
        loadingText="Saving…"
        disabled={pending}
        onClick={submit}
        className="self-start"
      >
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create the settings page**

Create `src/app/admin/settings/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { getAppSettings } from "@/lib/db/queries";
import { SettingsForm } from "./settings-form";

export default async function AdminSettingsPage() {
  await requireRole(["admin"]);
  const settings = await getAppSettings();
  const smtpConfigured = Boolean(
    process.env.ZOHO_SMTP_USER && process.env.ZOHO_SMTP_PASS,
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Settings
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          System configuration.
        </p>
      </header>

      <SettingsForm initialDesignTeamEmail={settings?.designTeamEmail ?? ""} />

      <div className="max-w-md rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        <p className="text-[13px] font-medium text-foreground">Email (SMTP)</p>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {smtpConfigured
            ? "Configured. Credentials are managed via environment variables."
            : "Not configured. Set ZOHO_SMTP_USER / ZOHO_SMTP_PASS in the environment."}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the admin-only Settings nav link**

In `src/app/admin/layout.tsx`, inside the `{isAdmin && ( ... )}` region of the nav, add a Settings link after the Users link. Change the existing admin block from a single `Link` to a fragment holding both:

```tsx
            {isAdmin && (
              <>
                <Link href="/admin/users" className="hover:text-foreground">
                  Users
                </Link>
                <Link href="/admin/settings" className="hover:text-foreground">
                  Settings
                </Link>
              </>
            )}
```

- [ ] **Step 4: Typecheck + lint + full suite**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → clean for the three files.
Run: `npm test` → PASS.

- [ ] **Step 5: Manual verification (needs DB + auth)**

As an **admin**, open `/admin/settings`, set the design-team email, save (confirm toast + persistence on reload). Confirm the SMTP status line reflects env. Submit a design request and confirm the team notification now goes to the saved address (overriding env). As a **designer** (non-admin), confirm `/admin/settings` redirects to `/dashboard` and `POST /api/admin/settings` returns 403.

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/settings/page.tsx" "src/app/admin/settings/settings-form.tsx" src/app/admin/layout.tsx
git commit -m "feat(admin): admin settings page for design-team email + SMTP status"
```

---

## Self-Review notes

- **Spec coverage:** `app_settings` (Task 1) ✓; settings queries + DB-first team email consumed by Feature 2 (Task 2) ✓; admin-only route (Task 3) ✓; admin-only page + SMTP-status-read-only + nav (Task 4) ✓; secrets stay in env (only a boolean status shown) ✓.
- **Type consistency:** `getAppSettings`/`updateAppSettings` shapes (Task 2) consumed by the route (Task 3) and page (Task 4); `getDesignTeamEmail` is now `Promise<string>` and its sole caller `sendDesignRequestEmails` awaits it (Task 2 Step 2c).
- **YAGNI:** only the design-team email (real consumer) + SMTP status are implemented; feature toggles / due-date offset deferred.
- **Auth:** settings are admin-only (page redirect + route 403), stricter than the designer-or-admin actions in Parts A/D.
