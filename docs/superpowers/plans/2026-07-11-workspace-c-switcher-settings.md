# Workspace & Team — Plan C: Workspace Card, Switcher, Settings, dashboard cards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sidebar shows a Workspace Card with a switcher menu; Owners get a Workspace Settings page (name, logo, Danger Zone); the dashboard shows the prototype's Invite-Your-Team / Team-Overview cards.

**Architecture:** Workspace CRUD routes (`GET/PATCH/DELETE /api/workspace`, `POST /api/workspace/switch`) on the Plan A guard. The dashboard layout resolves the active workspace + memberships once and threads them through `DashboardShell` into the sidebar, whose profile card becomes the Workspace Card. Switching sets the pointer cookie then hard-reloads (`location.assign`) — the whole context changes, so client caches are reset, not patched.

**Tech Stack:** Next.js 15 App Router, existing UI kit (`dropdown-menu`, `dialog`, `input`), Drizzle, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-07-11-workspace-team-design.md` (sections 3, 4, 8). **Prerequisites: Plans A and B fully merged.** One approved deviation from the prototype: the Settings *Notifications* toggle card is omitted in v1 (nothing workspace-scoped to toggle yet).

## Global Constraints

- **Always `corepack pnpm`**, never bare `pnpm`, never npm.
- Branch `feat/workspace`; commit at the end of every task.
- Vocabulary: Workspace, Team, Members, Owner/Member, Workspace Switcher. Adaptive color tokens only.
- Workspace switch and delete end in a FULL page reload (`window.location.assign`), never `router.push` — stale per-workspace client state must die.
- API error shape `{ error: string }`; 400/401/403/404 as in Plan B.
- Verification: `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`.

---

### Task 1: Workspace CRUD queries

**Files:**
- Modify: `src/lib/db/queries/workspaces.ts` (append)

**Interfaces:**
- Produces (via `@/lib/db/queries`):

```ts
export async function updateWorkspace(id: string, data: { name?: string; logoUrl?: string | null }): Promise<void>;
export async function deleteWorkspaceOwnedBy(workspaceId: string, ownerId: string): Promise<boolean>; // false = not found / not the owner
export async function countWorkspaceBrands(workspaceId: string): Promise<number>;
```

- [ ] **Step 1: Append the functions**

Add to `src/lib/db/queries/workspaces.ts` (extend the drizzle-orm import with `count`):

```ts
// ── Workspace settings / lifecycle ───────────────────────────────────

export async function updateWorkspace(
  id: string,
  data: { name?: string; logoUrl?: string | null },
) {
  await db
    .update(workspaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(workspaces.id, id));
}

/**
 * Delete a workspace ONLY if `ownerId` still owns it — the ownership check
 * and the delete are one atomic statement, so a concurrent ownership change
 * can't slip through between check and delete. Brands (and their whole
 * content tree), memberships, and invitations go with it via FK cascades.
 */
export async function deleteWorkspaceOwnedBy(
  workspaceId: string,
  ownerId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId)),
    )
    .returning({ id: workspaces.id });
  return deleted.length > 0;
}

export async function countWorkspaceBrands(workspaceId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId));
  return row?.value ?? 0;
}
```

- [ ] **Step 2: Typecheck + lint, commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint`
Expected: exit 0.

```bash
git add src/lib/db/queries/workspaces.ts
git commit -m "feat(db): workspace update/delete/brand-count queries"
```

---

### Task 2: Workspace API routes (`GET/PATCH/DELETE /api/workspace`, `POST /api/workspace/switch`)

**Files:**
- Create: `src/app/api/workspace/route.ts`
- Create: `src/app/api/workspace/switch/route.ts`

**Interfaces:**
- Consumes: `getActiveWorkspace`, `setActiveWorkspaceCookie` (Plan A Task 4), `can` (Plan A Task 2), `getMembership`, `getWorkspacesForUser`, Task 1 queries.
- Produces JSON for Tasks 3–4:
  - `GET /api/workspace` → `{ workspace: { id, name, logoUrl }, role }`
  - `PATCH /api/workspace` body `{ name?, logoUrl? }` → `{ ok: true }`
  - `DELETE /api/workspace` → `{ ok: true }` (then client hard-reloads); 400 if caller's only workspace
  - `POST /api/workspace/switch` body `{ workspaceId }` → `{ ok: true }`

- [ ] **Step 1: `src/app/api/workspace/route.ts`**

```ts
import { getActiveWorkspace, setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import {
  deleteWorkspaceOwnedBy,
  getWorkspacesForUser,
  updateWorkspace,
} from "@/lib/db/queries";

export async function GET() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  return Response.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      logoUrl: workspace.logoUrl,
    },
    role,
  });
}

export async function PATCH(req: Request) {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "manage_settings")) {
    return Response.json(
      { error: "Only the workspace owner can change settings." },
      { status: 403 },
    );
  }

  let body: { name?: string; logoUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: { name?: string; logoUrl?: string | null } = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 80) {
      return Response.json(
        { error: "Workspace name must be 1–80 characters." },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if (body.logoUrl !== undefined) patch.logoUrl = body.logoUrl;
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await updateWorkspace(workspace.id, patch);
  return Response.json({ ok: true });
}

export async function DELETE() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!can(role, "delete_workspace")) {
    return Response.json(
      { error: "Only the workspace owner can delete a workspace." },
      { status: 403 },
    );
  }

  const memberships = await getWorkspacesForUser(dbUser.id);
  if (memberships.length <= 1) {
    return Response.json(
      { error: "You can't delete your only workspace." },
      { status: 400 },
    );
  }

  const deleted = await deleteWorkspaceOwnedBy(workspace.id, dbUser.id);
  if (!deleted) {
    return Response.json(
      { error: "Only the workspace owner can delete a workspace." },
      { status: 403 },
    );
  }

  // Point the cookie at a surviving workspace so the reload lands cleanly.
  const remaining = memberships.find((m) => m.workspaceId !== workspace.id);
  if (remaining) await setActiveWorkspaceCookie(remaining.workspaceId);
  return Response.json({ ok: true });
}
```

(The typed-name confirmation is client-side UX in Task 5; the server contract is capability + atomic ownership check.)

- [ ] **Step 2: `src/app/api/workspace/switch/route.ts`**

```ts
import { getAuthUser } from "@/lib/auth/get-user";
import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import { getMembership } from "@/lib/db/queries";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  let body: { workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  // The cookie is a pointer, but never point it somewhere the user isn't.
  if (!(await getMembership(body.workspaceId, dbUser.id))) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  await setActiveWorkspaceCookie(body.workspaceId);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add src/app/api/workspace
git commit -m "feat(api): workspace get/update/delete and switch routes"
```

---

### Task 3: Workspace Card + Switcher in the sidebar

**Files:**
- Create: `src/components/layout/workspace-card.tsx`
- Modify: `src/components/layout/app-sidebar.tsx` (replace the User Card block, lines ~174–195, and the `UserInfo` props)
- Modify: `src/components/layout/dashboard-shell.tsx` (thread new props)
- Modify: `src/app/(dashboard)/layout.tsx` (resolve workspace + memberships)

**Interfaces:**
- Consumes: `getActiveWorkspace`, `getWorkspacesForUser` (Plan A), `DropdownMenu*` from `src/components/ui/dropdown-menu.tsx` (verify its exported subcomponent names in that file before writing JSX and adapt if they differ from the shadcn standard used below).
- Produces: `WorkspaceCard` client component with props:

```ts
interface WorkspaceCardProps {
  collapsed: boolean;
  active: { id: string; name: string; logoUrl: string | null; role: "owner" | "member" };
  memberships: Array<{ id: string; name: string; logoUrl: string | null; role: "owner" | "member" }>;
}
```

- [ ] **Step 1: Resolve workspace data in the dashboard layout**

Rewrite `src/app/(dashboard)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getWorkspacesForUser } from "@/lib/db/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser, workspace, role } = await getActiveWorkspace();

  if (!dbUser) {
    redirect("/login");
  }

  const memberships = await getWorkspacesForUser(dbUser.id);

  const user = {
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    avatarUrl: dbUser.avatarUrl,
  };

  return (
    <DashboardShell
      user={user}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        logoUrl: workspace.logoUrl,
        role,
      }}
      memberships={memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        logoUrl: m.workspace.logoUrl,
        role: m.role,
      }))}
    >
      {children}
    </DashboardShell>
  );
}
```

In `src/components/layout/dashboard-shell.tsx`, add `workspace` and `memberships` to the props (same types as `WorkspaceCardProps.active` / `.memberships`) and pass both to `<AppSidebar …>` unchanged. Keep `user` — the top header still uses it.

- [ ] **Step 2: The WorkspaceCard component**

`src/components/layout/workspace-card.tsx`:

```tsx
"use client";

import { Check, ChevronsUpDown, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface WorkspaceInfo {
  id: string;
  name: string;
  logoUrl: string | null;
  role: "owner" | "member";
}

function roleLabel(role: "owner" | "member") {
  return role === "owner" ? "Owner" : "Member";
}

function WorkspaceAvatar({ ws }: { ws: WorkspaceInfo }) {
  if (ws.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny avatar, remote logo
    return (
      <img
        src={ws.logoUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#7c5cff] text-sm font-semibold text-white">
      {ws.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function WorkspaceCard({
  collapsed,
  active,
  memberships,
}: {
  collapsed: boolean;
  active: WorkspaceInfo;
  memberships: WorkspaceInfo[];
}) {
  const [pending, startTransition] = useTransition();

  function switchTo(workspaceId: string) {
    if (workspaceId === active.id) return;
    startTransition(async () => {
      const res = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      // Full reload on purpose: the entire context (brands, chats,
      // calendars) changes — reset the world instead of patching caches.
      if (res.ok) window.location.assign("/dashboard");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Workspace menu"
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border border-[var(--nav-border)] bg-[var(--nav-card)] p-3 text-left transition-colors hover:bg-[var(--nav-hover)] disabled:opacity-60",
            collapsed &&
              "md:justify-center md:border-transparent md:bg-transparent md:p-2",
          )}
        >
          <WorkspaceAvatar ws={active} />
          <div className={cn("min-w-0 flex-1", collapsed && "md:hidden")}>
            <p className="truncate text-sm font-medium text-[var(--nav-text-active)]">
              {active.name}
            </p>
            <p className="truncate text-xs text-[var(--nav-text)]">
              {roleLabel(active.role)}
            </p>
          </div>
          <ChevronsUpDown
            size={16}
            className={cn("shrink-0 text-[var(--nav-text)]", collapsed && "md:hidden")}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {memberships.map((ws) => (
          <DropdownMenuItem key={ws.id} onSelect={() => switchTo(ws.id)}>
            <span className="flex-1 truncate">{ws.name}</span>
            <span className="text-xs text-muted-foreground">
              {roleLabel(ws.role)}
            </span>
            {ws.id === active.id && <Check size={14} />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/team">
            <Users size={16} /> Team
          </Link>
        </DropdownMenuItem>
        {active.role === "owner" && (
          <DropdownMenuItem asChild>
            <Link href="/workspace/settings">
              <Settings2 size={16} /> Workspace Settings
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Replace the sidebar User Card**

In `src/components/layout/app-sidebar.tsx`:

1. Extend the props: `export function AppSidebar({ user, workspace, memberships }: { user: UserInfo; workspace: WorkspaceInfo; memberships: WorkspaceInfo[] })` — import the `WorkspaceInfo` shape from `./workspace-card` (export it there).
2. Replace the entire `{/* User Card */}` block (the `div.px-3.pb-4` wrapper at the bottom, currently rendering initials + name + email) with:

```tsx
        {/* Workspace Card (replaces the profile card — prototype §Workspace Card) */}
        <div className="px-3 pb-4">
          <WorkspaceCard
            collapsed={collapsed}
            active={workspace}
            memberships={memberships}
          />
        </div>
```

3. The `initials` computation and `UserInfo`'s unused fields may now be dead — delete `const initials = …` if nothing else uses it; keep `UserInfo` (top-header still shows the user elsewhere via `DashboardShell`).

- [ ] **Step 4: Drive it**

Run `corepack pnpm dev`:

1. Sidebar bottom shows the workspace name + your role instead of your name/email.
2. Owner of one + member of another (from Plan B's flow): the menu lists both with roles; switching hard-reloads into the other workspace's dashboard — brands, campaigns, chats all change.
3. Member's menu hides "Workspace Settings"; Team link works.
4. Collapsed sidebar (md+): the card degrades to the avatar square, menu still opens.

Expected: all four hold, in dark AND light themes.

- [ ] **Step 5: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add src/components/layout "src/app/(dashboard)/layout.tsx"
git commit -m "feat(sidebar): workspace card + switcher replacing the profile card"
```

---

### Task 4: Workspace Settings page

**Files:**
- Create: `src/app/(dashboard)/workspace/settings/page.tsx`
- Create: `src/app/(dashboard)/workspace/settings/settings-client.tsx`
- Modify: `src/lib/nav.ts` (PAGE_META entry)

**Interfaces:**
- Consumes: `getActiveWorkspace`, `can`, `countWorkspaceBrands`; `PATCH/DELETE /api/workspace` (Task 2); the existing upload route (find it: `ls src/app/api/upload` — read its handler to confirm the request field name and response shape before wiring the logo input; the code below assumes `POST /api/upload` with `FormData{ file }` → `{ url: string }` — adapt to what the handler actually returns).

- [ ] **Step 1: PAGE_META**

In `src/lib/nav.ts` add to `PAGE_META` (above `/admin`):

```ts
  {
    match: "/workspace",
    meta: { title: "Workspace Settings", subtitle: "Name, logo, and danger zone" },
  },
```

- [ ] **Step 2: Server page (owner-gated)**

`src/app/(dashboard)/workspace/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { countWorkspaceBrands, getWorkspacesForUser } from "@/lib/db/queries";
import { SettingsClient } from "./settings-client";

export default async function WorkspaceSettingsPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");
  if (!can(role, "manage_settings")) redirect("/dashboard");

  const [brandCount, memberships] = await Promise.all([
    countWorkspaceBrands(workspace.id),
    getWorkspacesForUser(dbUser.id),
  ]);

  return (
    <SettingsClient
      workspace={{
        id: workspace.id,
        name: workspace.name,
        logoUrl: workspace.logoUrl,
      }}
      brandCount={brandCount}
      canDelete={memberships.length > 1}
    />
  );
}
```

- [ ] **Step 3: Client component (auto-save name, logo upload, Danger Zone)**

`src/app/(dashboard)/workspace/settings/settings-client.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
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

async function patchWorkspace(body: {
  name?: string;
  logoUrl?: string | null;
}): Promise<string | null> {
  const res = await fetch("/api/workspace", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? "Could not save. Please try again.";
}

function SectionCard({
  title,
  children,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-6 ${
        danger
          ? "border-[var(--status-error-fg)]/40"
          : "border-[var(--border)] bg-surface-1"
      }`}
    >
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsClient({
  workspace,
  brandCount,
  canDelete,
}: {
  workspace: { id: string; name: string; logoUrl: string | null };
  brandCount: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-save on blur, per the prototype ("changes saved automatically").
  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    setStatus("saving");
    startTransition(async () => {
      const err = await patchWorkspace({ name: trimmed });
      if (err) {
        setStatus("error");
        setError(err);
      } else {
        setStatus("saved");
        setError(null);
        router.refresh();
      }
    });
  }

  function uploadLogo(file: File) {
    setStatus("saving");
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        setStatus("error");
        setError("Logo upload failed. Please try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const err = await patchWorkspace({ logoUrl: url });
      if (err) {
        setStatus("error");
        setError(err);
      } else {
        setStatus("saved");
        setError(null);
        router.refresh();
      }
    });
  }

  function deleteWorkspace() {
    startTransition(async () => {
      const res = await fetch("/api/workspace", { method: "DELETE" });
      if (res.ok) {
        window.location.assign("/dashboard");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "Could not delete the workspace.");
      setDeleteOpen(false);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionCard title="Workspace Information">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="ws-name"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Workspace name
            </label>
            <Input
              id="ws-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs text-muted-foreground">
              Logo
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {workspace.logoUrl ? "Replace logo" : "Upload logo"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved."}
            {status === "error" && (
              <span className="text-[var(--status-error-fg)]">{error}</span>
            )}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Danger Zone" danger>
        <p className="mb-4 text-sm text-muted-foreground">
          Deleting this workspace permanently removes its {brandCount} brand
          {brandCount === 1 ? "" : "s"} and every campaign, calendar, chat, and
          design ticket inside them. This cannot be undone.
        </p>
        {!canDelete && (
          <p className="mb-4 text-xs text-muted-foreground">
            You can't delete your only workspace.
          </p>
        )}
        <button
          type="button"
          disabled={!canDelete || pending}
          onClick={() => setDeleteOpen(true)}
          className="rounded-lg border border-[var(--status-error-fg)]/60 px-4 py-2 text-sm font-medium text-[var(--status-error-fg)] disabled:opacity-50"
        >
          Delete Workspace
        </button>
      </SectionCard>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {workspace.name}?</DialogTitle>
            <DialogDescription>
              Type the workspace name to confirm. All {brandCount} brand
              {brandCount === 1 ? "" : "s"} and their content will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={workspace.name}
            aria-label="Type the workspace name to confirm deletion"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirmText !== workspace.name || pending}
              onClick={deleteWorkspace}
              className="flex items-center gap-2 rounded-lg bg-[var(--status-error-fg)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? <Spinner /> : null}
              Delete Workspace
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

(No Notifications card — approved v1 deviation; see spec §4.)

- [ ] **Step 4: Drive it**

Run `corepack pnpm dev` as an owner:

1. Rename the workspace, blur → "Saved."; sidebar card updates after refresh.
2. Upload a logo → appears in the sidebar Workspace Card.
3. Danger Zone: delete button disabled until the typed name matches exactly; deleting a second workspace lands you (hard reload) in your remaining workspace; deleting your ONLY workspace is blocked with the friendly message.
4. As a member, request `/workspace/settings` → redirected to `/dashboard`; `PATCH /api/workspace` via curl → 403.

Expected: all four hold.

- [ ] **Step 5: Typecheck, lint, tests; commit**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add "src/app/(dashboard)/workspace" src/lib/nav.ts
git commit -m "feat(workspace): settings page — rename, logo, typed-confirm delete"
```

---

### Task 5: Dashboard team cards

**Files:**
- Create: `src/app/(dashboard)/dashboard/team-cards.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `requireBrand()` (already returns `{ dbUser, workspace, role, brand }` since Plan A Task 6), `getWorkspaceMembers`, `getPendingInvitations`, `can`.

- [ ] **Step 1: The two card states**

`src/app/(dashboard)/dashboard/team-cards.tsx` (server-safe, presentational):

```tsx
import { Users } from "lucide-react";
import Link from "next/link";

/** Prototype "Dashboard - Invite Card": shown while the workspace has no
 * teammates; swapped for TeamOverviewCard once it does. */
export function InviteTeamCard() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-gradient-to-r from-primary/10 to-[#7c5cff]/10 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Users size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Invite Your Team</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bring teammates into this workspace to manage brands, campaigns,
            and design requests together.
          </p>
          <Link
            href="/team"
            className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
          >
            Invite Team
          </Link>
        </div>
      </div>
    </div>
  );
}

export function TeamOverviewCard({
  memberCount,
  pendingCount,
  names,
}: {
  memberCount: number;
  pendingCount: number;
  names: string[];
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Team</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {memberCount} member{memberCount === 1 ? "" : "s"}
            {pendingCount > 0 && ` · ${pendingCount} pending`}
          </p>
        </div>
        {/* Avatar stack (overlapping circles), per the prototype */}
        <div className="flex -space-x-2">
          {names.slice(0, 4).map((n) => (
            <div
              key={n}
              title={n}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--border)] bg-gradient-to-br from-[#e8a0b0] to-[#7c5cff] text-[10px] font-semibold text-white"
            >
              {n
                .split(" ")
                .filter(Boolean)
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </div>
          ))}
        </div>
      </div>
      <Link
        href="/team"
        className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
      >
        Manage team →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the dashboard page**

In `src/app/(dashboard)/dashboard/page.tsx` (it already calls `requireBrand()` at line ~53): fetch team data alongside the existing dashboard queries and render one of the cards in the existing card grid (place it after the page's first row of cards — inspect the JSX and slot it where the layout has room; it must not displace the primary stat cards):

```tsx
import { getPendingInvitations, getWorkspaceMembers } from "@/lib/db/queries";
import { InviteTeamCard, TeamOverviewCard } from "./team-cards";
// inside the component, after requireBrand():
const { dbUser, workspace, brand } = await requireBrand();
const [teamMembers, pendingInvites] = await Promise.all([
  getWorkspaceMembers(workspace.id),
  getPendingInvitations(workspace.id),
]);
// in the JSX:
{teamMembers.length <= 1 && pendingInvites.length === 0 ? (
  <InviteTeamCard />
) : (
  <TeamOverviewCard
    memberCount={teamMembers.length}
    pendingCount={pendingInvites.length}
    names={teamMembers.map((m) =>
      `${m.user.firstName} ${m.user.lastName}`.trim(),
    )}
  />
)}
```

(Show the overview card as soon as there is a pending invite OR a second member — a lone owner with an outstanding invite shouldn't still see the "get started" pitch.)

- [ ] **Step 3: Drive it, then commit**

Run `corepack pnpm dev`: solo workspace → gradient Invite card; workspace with a member or pending invite → overview card with avatar stack and counts. Check both themes.

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

```bash
git add "src/app/(dashboard)/dashboard"
git commit -m "feat(dashboard): invite-your-team / team-overview cards"
```

---

### Task 6: Feature-complete verification + rollout

- [ ] **Step 1: Full gate**

Run: `corepack pnpm test && corepack pnpm lint && corepack pnpm exec tsc --noEmit && corepack pnpm build`
Expected: all pass.

- [ ] **Step 2: Whole-feature walkthrough (spec §7 flows)**

With two browser profiles (Owner A, invitee B):

1. A invites B → B registers via link → auto-joins → A gets the joined email.
2. B sees A's brands/campaigns; B creates content (allowed); B hits `/workspace/settings` → redirected; B `DELETE /api/workspace` → 403.
3. B's switcher lists both workspaces; switching hard-reloads context both ways.
4. A removes B from Team → B's next navigation lands in B's personal workspace (no crash, no 500s in the console).
5. A (owning a second workspace) deletes it via Danger Zone typed confirm → lands in remaining workspace; brands of the deleted workspace are gone.

Expected: every step matches `docs/superpowers/specs/2026-07-11-workspace-team-design.md`.

- [ ] **Step 3: Ship through the pipeline**

Per the branch topology (dev → staging → main):

```bash
git push -u origin feat/workspace
gh pr create --base dev --title "feat: Workspaces & Team" --body "Implements docs/superpowers/specs/2026-07-11-workspace-team-design.md (plans A/B/C).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**Deploy-window note:** the build applies migrations BEFORE the new code is promoted, so between `0010_workspaces.sql` landing and the new deployment going live, the OLD code's `createBrand` (no `workspace_id`) violates the new NOT NULL and brand onboarding 500s for that window. Promote at low traffic; the reverse direction is safe (users created by old code are self-healed by `getActiveWorkspace`).

After merge to `dev`, promote to `staging` — the build applies `0010_workspaces.sql` to the staging database automatically. **On staging, before promoting to `main`, re-run the backfill verification query from Plan A Task 1 Step 5 against the staging DB** (users === workspaces === owner memberships, zero orphan brands) and click through flows 1–4 on the staging domain. Only then PR `staging → main`; production migration runs in that deploy's build.

Expected: staging verification green before any production promotion.
