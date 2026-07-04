# Admin Part D — Broadened Ticket Management (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins the ability to set ticket **priority** (shown & sorted in the queue), **reassign** a ticket to any designer, and **override** its status beyond the designer-settable set — without changing the designer flow.

**Architecture:** A `priority` enum column on `design_tickets`; a pure `humanizePriority`/`priorityRank` helper; `updateDesignTicket` gains `priority`; a `getStaffUsers` query for the reassign picker; an **admin-only** `POST /api/admin/tickets/[id]/manage` route; and admin-only UI (priority badge + sort in the queue, a management panel on the ticket-detail page). Final part of the 4-part admin feature (A, C, B done).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + postgres.js, Vitest, Biome.

## Global Constraints

- Scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test`; typecheck = `npx tsc --noEmit`; apply migrations = `npm run db:migrate` (idempotent; `.env` = shared prod DB).
- Migrations are hand-written `drizzle/NNNN_*.sql` — no `db:generate`/`db:push`.
- Auth: management actions are **admin-only** (route: `dbUser.role !== "admin"` → 403; UI panel rendered only when the viewer is admin). Designers keep their existing claim/status flow unchanged.
- Styling: CSS-variable tokens only; no hardcoded light hexes / `text-white` on theme surfaces.
- Reuse `humanizeStatus`/`TicketStatus`, `TicketStatusBadge`, `formatTicketNumber`, `getDesignTicketById`/`getUserById`/`updateDesignTicket`.
- Priority enum values: `low | normal | high | urgent`, default `normal`.
- One commit per task.

---

### Task 1: `priority` enum + column + migration (applied)

**Files:**
- Modify: `src/lib/db/schema.ts` (add enum near the other enums; add column to `designTickets` after `status`)
- Create: `drizzle/0005_ticket_priority.sql`

**Interfaces:**
- Produces: `ticketPriorityEnum` and `designTickets.priority` (`notNull`, default `"normal"`).

- [ ] **Step 1: Add the enum + column**

In `src/lib/db/schema.ts`:

(a) After `designTicketStatusEnum` (around line 84), add:

```ts
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
```

(b) In `designTickets`, add the column immediately after the `status` line:

```ts
  status: designTicketStatusEnum("status").notNull().default("submitted"),
  priority: ticketPriorityEnum("priority").notNull().default("normal"),
```

- [ ] **Step 2: Write the migration**

Create `drizzle/0005_ticket_priority.sql`:

```sql
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN "priority" "ticket_priority" DEFAULT 'normal' NOT NULL;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: `✓ applied 0005_ticket_priority.sql (2 statement(s))` then up to date. (The `NOT NULL DEFAULT 'normal'` backfills existing rows.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0005_ticket_priority.sql
git commit -m "feat(admin): ticket priority enum + column"
```

---

### Task 2: `humanizePriority` + `priorityRank` (TDD)

**Files:**
- Modify: `src/lib/design/tickets-ui.ts`
- Test: `src/lib/design/tickets-ui.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TicketPriority = "low" | "normal" | "high" | "urgent";
  export function humanizePriority(p: TicketPriority): string;   // "Urgent"
  export function priorityRank(p: TicketPriority): number;       // urgent=0 … low=3 (sort ascending = most urgent first)
  ```

- [ ] **Step 1: Add failing tests**

In `src/lib/design/tickets-ui.test.ts`, add (ensure `humanizePriority` and `priorityRank` are added to the existing import from `./tickets-ui`):

```ts
describe("priority helpers", () => {
  it("humanizes each priority", () => {
    expect(humanizePriority("urgent")).toBe("Urgent");
    expect(humanizePriority("normal")).toBe("Normal");
  });
  it("ranks urgent highest (lowest number) for ascending sort", () => {
    const order = (["low", "urgent", "normal", "high"] as const)
      .slice()
      .sort((a, b) => priorityRank(a) - priorityRank(b));
    expect(order).toEqual(["urgent", "high", "normal", "low"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/design/tickets-ui.test.ts`
Expected: FAIL — `humanizePriority`/`priorityRank` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/design/tickets-ui.ts`:

```ts
export type TicketPriority = "low" | "normal" | "high" | "urgent";

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function humanizePriority(p: TicketPriority): string {
  return PRIORITY_LABELS[p] ?? p;
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Lower number = more urgent; sort ascending to surface urgent first. */
export function priorityRank(p: TicketPriority): number {
  return PRIORITY_RANK[p] ?? 99;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/design/tickets-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/tickets-ui.ts src/lib/design/tickets-ui.test.ts
git commit -m "feat(admin): priority label + rank helpers"
```

---

### Task 3: `updateDesignTicket` accepts priority; `getStaffUsers` query

**Files:**
- Modify: `src/lib/db/queries/index.ts`

**Interfaces:**
- Produces:
  ```ts
  updateDesignTicket(id, data: Partial<Pick<..., "status" | "assignedDesignerId" | "notes" | "priority">>)  // + priority
  getStaffUsers(): Promise<Array<{ id: string; firstName: string; lastName: string; role: string }>>       // designers + admins
  ```

- [ ] **Step 1: Add `priority` to the updatable fields**

In `src/lib/db/queries/index.ts`, in `updateDesignTicket`, extend the `Pick` union to include `"priority"`:

```ts
export async function updateDesignTicket(
  id: string,
  data: Partial<
    Pick<
      typeof designTickets.$inferInsert,
      "status" | "assignedDesignerId" | "notes" | "priority"
    >
  >,
) {
```

- [ ] **Step 2: Add `getStaffUsers`**

Add near the other Users queries (after `getAllUsers`):

```ts
/** Designers and admins — candidates for ticket assignment. */
export async function getStaffUsers() {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.role, ["designer", "admin"]))
    .orderBy(users.firstName);
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → clean for `queries/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/queries/index.ts
git commit -m "feat(admin): updateDesignTicket priority + getStaffUsers query"
```

---

### Task 4: `POST /api/admin/tickets/[id]/manage` (admin-only)

**Files:**
- Create: `src/app/api/admin/tickets/[id]/manage/route.ts`

**Interfaces:**
- Consumes: `getAuthUser`; `getDesignTicketById`, `getUserById`, `updateDesignTicket`.
- Produces: `POST` accepting `{ status?, priority?, assignedDesignerId? (string | null) }`; admin-only; validates each field; reassigns/overrides/prioritizes; returns `{ ticket }`.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/tickets/[id]/manage/route.ts`:

```ts
import { getAuthUser } from "@/lib/auth/get-user";
import {
  getDesignTicketById,
  getUserById,
  updateDesignTicket,
} from "@/lib/db/queries";

const STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
] as const;
type Status = (typeof STATUSES)[number];

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || dbUser.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: {
    status?: string;
    priority?: string;
    assignedDesignerId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: {
    status?: Status;
    priority?: Priority;
    assignedDesignerId?: string | null;
  } = {};

  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status as Status;
  }
  if (body.priority !== undefined) {
    if (!(PRIORITIES as readonly string[]).includes(body.priority)) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }
    patch.priority = body.priority as Priority;
  }
  if (body.assignedDesignerId !== undefined) {
    if (body.assignedDesignerId === null) {
      patch.assignedDesignerId = null;
    } else {
      const assignee = await getUserById(body.assignedDesignerId);
      if (
        !assignee ||
        (assignee.role !== "designer" && assignee.role !== "admin")
      ) {
        return Response.json({ error: "Invalid assignee" }, { status: 400 });
      }
      patch.assignedDesignerId = body.assignedDesignerId;
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const updated = await updateDesignTicket(id, patch);
  return Response.json({ ticket: updated });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → clean for the new route.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/tickets/[id]/manage/route.ts"
git commit -m "feat(admin): admin ticket management route (reassign/status/priority)"
```

---

### Task 5: Priority badge + queue sort + admin management panel

**Files:**
- Create: `src/app/(dashboard)/design-request/priority-badge.tsx`
- Create: `src/app/admin/tickets/[id]/manage-panel.tsx` (client)
- Modify: `src/app/admin/tickets/queue-client.tsx` (priority badge on rows)
- Modify: `src/app/admin/tickets/page.tsx` (add `priority` to QueueRow mapping + sort by priority)
- Modify: `src/app/admin/tickets/[id]/page.tsx` (render the management panel for admins)

**Interfaces:**
- Consumes: `humanizePriority`/`priorityRank`/`TicketPriority` (Task 2); the manage route (Task 4); `getStaffUsers` (Task 3); `requireRole` (returns `{ dbUser }`).
- Produces: `PriorityBadge`; `ManagePanel`; `QueueRow` gains `priority`.

- [ ] **Step 1: Priority badge**

Create `src/app/(dashboard)/design-request/priority-badge.tsx`:

```tsx
import { humanizePriority, type TicketPriority } from "@/lib/design/tickets-ui";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === "normal") return null;
  const cls =
    priority === "urgent"
      ? "text-[var(--status-error-fg)]"
      : priority === "high"
        ? "text-foreground"
        : "text-[var(--text-muted)]";
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {humanizePriority(priority)}
    </span>
  );
}
```

- [ ] **Step 2: Management panel (client)**

Create `src/app/admin/tickets/[id]/manage-panel.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { humanizePriority, humanizeStatus } from "@/lib/design/tickets-ui";

const STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export interface StaffOption {
  id: string;
  name: string;
}

export function ManagePanel({
  ticketId,
  currentStatus,
  currentPriority,
  currentAssigneeId,
  staff,
}: {
  ticketId: string;
  currentStatus: string;
  currentPriority: string;
  currentAssigneeId: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [priority, setPriority] = useState(currentPriority);
  const [assignee, setAssignee] = useState(currentAssigneeId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          priority,
          assignedDesignerId: assignee || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not update the ticket.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Ticket updated");
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  const selectCls =
    "h-9 rounded-lg border border-[var(--border)] bg-surface-1 px-2 text-[13px] text-foreground";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Status
          <select
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className={selectCls}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Priority
          <select
            value={priority}
            disabled={pending}
            onChange={(e) => setPriority(e.target.value)}
            className={selectCls}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizePriority(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Assignee
          <select
            value={assignee}
            disabled={pending}
            onChange={(e) => setAssignee(e.target.value)}
            className={selectCls}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
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
        onClick={save}
        className="self-start"
      >
        Save changes
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Priority in the queue (badge + sort)**

In `src/app/admin/tickets/queue-client.tsx`:

(a) Add the import:

```tsx
import { PriorityBadge } from "@/app/(dashboard)/design-request/priority-badge";
import type { TicketPriority } from "@/lib/design/tickets-ui";
```

(b) Add `priority` to the `QueueRow` interface:

```tsx
  status: TicketStatus;
  priority: TicketPriority;
```

(c) In `QueueItem`, render the badge next to the status badge (in the header row, right after `<TicketStatusBadge status={row.status} />`):

```tsx
          <TicketStatusBadge status={row.status} />
          <PriorityBadge priority={row.priority} />
```

In `src/app/admin/tickets/page.tsx`:

(d) Add `priority` to the mapped `QueueRow` and sort by priority. Add the import:

```ts
import { priorityRank, type TicketPriority } from "@/lib/design/tickets-ui";
```

(e) In the `queue` mapping, add `priority: ticket.priority as TicketPriority,` to each row object, then sort the resulting array before passing it to `QueueClient`:

```ts
  const queue: QueueRow[] = rows
    .map(({ ticket, campaignName, itemTitle, brandName }) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      dimensions: ticket.dimensions,
      slides: ticket.slides,
      brief: ticket.brief,
      status: ticket.status as TicketStatus,
      priority: ticket.priority as TicketPriority,
      brandName: brandName ?? null,
      campaignName: campaignName ?? null,
      itemTitle: itemTitle ?? null,
      dueDate: ticket.dueDate ? ticket.dueDate.toISOString() : null,
    }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
```

- [ ] **Step 4: Render the management panel on the detail page (admins only)**

In `src/app/admin/tickets/[id]/page.tsx`:

(a) Capture the role and load staff. Change `await requireRole(["designer", "admin"]);` to:

```ts
  const { dbUser } = await requireRole(["designer", "admin"]);
  const isAdmin = dbUser.role === "admin";
```

(b) Add `getStaffUsers` to the `@/lib/db/queries` import, and to the `Promise.all` (only used when admin, but fetching is cheap):

```ts
  const [brand, deliverables, updateRows, staff] = await Promise.all([
    getBrandById(ticket.brandId),
    getDeliverables(ticket.id),
    getTicketUpdates(ticket.id),
    getStaffUsers(),
  ]);
```

(c) Import the panel and its option type, and render a "Manage" section for admins, before the "Post an update" section:

```tsx
import { ManagePanel, type StaffOption } from "./manage-panel";
```

```tsx
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">Manage</h2>
          <ManagePanel
            ticketId={ticket.id}
            currentStatus={ticket.status}
            currentPriority={ticket.priority}
            currentAssigneeId={ticket.assignedDesignerId}
            staff={staff.map<StaffOption>((s) => ({
              id: s.id,
              name: `${s.firstName} ${s.lastName}`.trim(),
            }))}
          />
        </section>
      )}
```

- [ ] **Step 5: Typecheck + lint + full suite**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → clean for the touched files.
Run: `npm test` → PASS (Task 2's new tests included).

- [ ] **Step 6: Manual verification (needs DB + auth)**

As an **admin**, open a ticket detail page, use Manage to change status (to any value incl. delivered), priority, and assignee — confirm each persists and the queue reflects the new priority ordering + badge. As a **designer**, confirm the Manage panel is absent and `POST /api/admin/tickets/[id]/manage` returns 403. Confirm the designer claim/start flow still works unchanged.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/design-request/priority-badge.tsx" "src/app/admin/tickets/[id]/manage-panel.tsx" src/app/admin/tickets/queue-client.tsx src/app/admin/tickets/page.tsx "src/app/admin/tickets/[id]/page.tsx"
git commit -m "feat(admin): priority in queue + admin management panel (reassign/status/priority)"
```

---

## Self-Review notes

- **Spec coverage:** priority column (Task 1) + badge/sort in queue (Task 5) ✓; reassign to any designer (Task 4 route + Task 5 panel) ✓; status override beyond designer-settable (Task 4 full STATUSES) ✓; admin-only (route 403 + panel gated on `isAdmin`) ✓; designer flow unchanged (existing status route untouched) ✓.
- **Type consistency:** `TicketPriority`/`humanizePriority`/`priorityRank` (Task 2) used by the badge, queue, and panel (Task 5); `updateDesignTicket` priority (Task 3) consumed by the manage route (Task 4); `getStaffUsers` shape (Task 3) mapped to `StaffOption` (Task 5).
- **No placeholders:** all code complete, incl. the hand-written `0005` migration (applied in Task 1).
- **Assignee validation:** the route rejects a non-staff assignee (Task 4) rather than trusting the client; `null` unassigns.
