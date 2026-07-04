# Admin Part A — Progress Updates to Users (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let designers/admins post a free-text progress update on a ticket that notifies the requester, and show that update timeline to the requester on their ticket page.

**Architecture:** New `ticket_updates` table (one row per staff update, optional status change). A new admin ticket-detail page (`/admin/tickets/[id]`) with an update composer posting to a new `POST /api/admin/tickets/[id]/updates` route, which inserts the update **and** a `ticket_status` notification to the ticket owner. Both the admin detail page and the requester's existing `design-request/[id]` page render a shared read-only timeline. This is Part A of a 4-part admin feature (A progress-updates → C dashboard → B settings → D broadened ticket management); each part is its own plan.

**Tech Stack:** Next.js 16 App Router (server pages + route handlers), React 19, Drizzle ORM + postgres.js, the existing notifications system, Vitest + RTL, Biome.

## Global Constraints

- Scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test` (`vitest run --passWithNoTests`); typecheck = `npx tsc --noEmit`; apply migrations = `npm run db:migrate` (idempotent runner; `.env` points at the shared prod DB).
- Migrations are **hand-written** `drizzle/NNNN_*.sql` (drizzle DDL format, `--> statement-breakpoint` between statements) — `drizzle/meta/` is gitignored, do NOT use `db:generate`/`db:push`.
- Auth: designer **or** admin for all Part A staff actions — mirror the existing pattern `getAuthUser()` → `dbUser.role !== "designer" && dbUser.role !== "admin"` → 403 (see `api/admin/tickets/[id]/status/route.ts`). Server pages use `requireRole(["designer","admin"])`.
- Styling: existing CSS-variable tokens (`var(--border)`, `bg-surface-1`, `text-foreground`, `var(--text-secondary)`, `var(--status-error-fg)`); no hardcoded light hexes / `text-white` on theme surfaces (dark-first app).
- Reuse existing helpers: `formatTicketNumber` (`@/lib/design/ticket`), `humanizeStatus`/`TicketStatus` (`@/lib/design/tickets-ui`), `TicketStatusBadge`, `createNotification`/`getDesignTicketById`/`getBrandById`/`getDeliverables`/`updateDesignTicket` (`@/lib/db/queries`).
- Do NOT leak staff identities to requesters: the requester-facing timeline labels every author "KO Design Team"; the admin timeline shows the real author name.
- One commit per task.

---

### Task 1: `ticket_updates` schema + migration (applied)

**Files:**
- Modify: `src/lib/db/schema.ts` (add table after `notifications`, ~line 314)
- Create: `drizzle/0003_ticket_updates.sql`

**Interfaces:**
- Consumes: `designTickets`, `users`, `designTicketStatusEnum` (already in schema.ts).
- Produces: `ticketUpdates` table. `typeof ticketUpdates.$inferInsert` = `{ ticketId: string; authorId: string; message: string; newStatus?: <enum> | null; ... }`.

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, after the `notifications` table definition, add:

```ts
export const ticketUpdates = pgTable("ticket_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => designTickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  newStatus: designTicketStatusEnum("new_status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Write the migration**

Create `drizzle/0003_ticket_updates.sql`:

```sql
CREATE TABLE "ticket_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"message" text NOT NULL,
	"new_status" "design_ticket_status",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_updates" ADD CONSTRAINT "ticket_updates_ticket_id_design_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."design_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_updates" ADD CONSTRAINT "ticket_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Apply the migration to the DB**

Run: `npm run db:migrate`
Expected: `✓ applied 0003_ticket_updates.sql (3 statement(s))` then `✓ Migrations up to date.` (The runner is idempotent; a second run would say "up to date".)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0003_ticket_updates.sql
git commit -m "feat(admin): ticket_updates table for staff progress updates"
```

---

### Task 2: Queries — `createTicketUpdate` + `getTicketUpdates`

**Files:**
- Modify: `src/lib/db/queries/index.ts` (add after the Notifications section, before Usage Events)

**Interfaces:**
- Consumes: `ticketUpdates` (Task 1), `users`, `db`, `eq`, `desc`, `leftJoin` (all already imported/used in this file).
- Produces:
  ```ts
  createTicketUpdate(data: typeof ticketUpdates.$inferInsert): Promise<ticketUpdates row>
  getTicketUpdates(ticketId: string): Promise<Array<{ update: <ticketUpdates row>; authorFirstName: string | null; authorLastName: string | null }>>
  ```

- [ ] **Step 1: Add `ticketUpdates` to the schema import**

In `src/lib/db/queries/index.ts`, add `ticketUpdates` to the existing import from the schema module (the destructured `import { ... } from "../schema"` / `"@/lib/db/schema"` list that already includes `designTickets`, `users`, `notifications`, etc.).

- [ ] **Step 2: Add the query functions**

Add after the Notifications section (after `markNotificationsRead`, before `// ── Usage Events`):

```ts
// ── Ticket Updates ──────────────────────────────────────────────────

export async function createTicketUpdate(
  data: typeof ticketUpdates.$inferInsert,
) {
  const [row] = await db.insert(ticketUpdates).values(data).returning();
  return row;
}

/** A ticket's progress updates, newest first, with the author's name. */
export async function getTicketUpdates(ticketId: string) {
  return db
    .select({
      update: ticketUpdates,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(ticketUpdates)
    .leftJoin(users, eq(ticketUpdates.authorId, users.id))
    .where(eq(ticketUpdates.ticketId, ticketId))
    .orderBy(desc(ticketUpdates.createdAt));
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for `queries/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/queries/index.ts
git commit -m "feat(admin): ticket update queries (create + list with author)"
```

---

### Task 3: Surface the update message in the notification bell (TDD)

The bell renders `ticket_status` notifications via `formatNotificationMessage`, which currently only shows the status. A free-text progress update should show its message.

**Files:**
- Modify: `src/lib/design/tickets-ui.ts` (`NotificationPayload`, `formatNotificationMessage`)
- Test: `src/lib/design/tickets-ui.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `NotificationLike`/`NotificationPayload`.
- Produces: for `type: "ticket_status"`, if `payload.message` is a non-empty string, `formatNotificationMessage` returns it; otherwise the existing status sentence.

- [ ] **Step 1: Add failing tests**

In `src/lib/design/tickets-ui.test.ts`, add:

```ts
describe("formatNotificationMessage — ticket_status", () => {
  it("shows the free-text message when present", () => {
    expect(
      formatNotificationMessage({
        type: "ticket_status",
        payload: { message: "Started on your carousel — first draft tomorrow." },
      }),
    ).toBe("Started on your carousel — first draft tomorrow.");
  });
  it("falls back to the status sentence when no message", () => {
    expect(
      formatNotificationMessage({
        type: "ticket_status",
        payload: { status: "in_progress" },
      }),
    ).toBe("Your design ticket is now In Progress.");
  });
});
```

(Ensure `formatNotificationMessage` is imported in the test file — it is already exported from `tickets-ui.ts`; add it to the existing import if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/design/tickets-ui.test.ts`
Expected: FAIL — the first case currently returns "Your design ticket is now updated."

- [ ] **Step 3: Implement**

In `src/lib/design/tickets-ui.ts`:

(a) Add `message` to `NotificationPayload`:

```ts
interface NotificationPayload {
  ticketId?: string;
  designType?: string;
  count?: number;
  status?: string;
  message?: string;
}
```

(b) In `formatNotificationMessage`, update the `ticket_status` case:

```ts
    case "ticket_status": {
      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message;
      }
      const status = payload.status
        ? humanizeStatus(payload.status as TicketStatus)
        : "updated";
      return `Your design ticket is now ${status}.`;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/design/tickets-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/tickets-ui.ts src/lib/design/tickets-ui.test.ts
git commit -m "feat(admin): show progress-update message in the notification bell"
```

---

### Task 4: `POST /api/admin/tickets/[id]/updates` route

**Files:**
- Create: `src/app/api/admin/tickets/[id]/updates/route.ts`

**Interfaces:**
- Consumes: `getAuthUser`; `getDesignTicketById`, `updateDesignTicket`, `createTicketUpdate` (Task 2), `createNotification` from `@/lib/db/queries`.
- Produces: `POST` accepting `{ message: string; status?: string }`. On success: inserts a `ticket_updates` row (with `newStatus` when a status was set), optionally updates the ticket status, creates a `ticket_status` notification to the ticket owner with payload `{ ticketId, ticketNumber, designType, status?, message }`, and returns `{ ok: true }`.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/tickets/[id]/updates/route.ts`:

```ts
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createNotification,
  createTicketUpdate,
  getDesignTicketById,
  updateDesignTicket,
} from "@/lib/db/queries";

// Statuses a designer/admin may set alongside a progress update (mirrors the
// status route's DESIGNER_SETTABLE). Broader admin overrides land in Part D.
const SETTABLE = ["assigned", "in_progress", "ready_for_review"] as const;
type SettableStatus = (typeof SETTABLE)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: { message?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "A message is required." }, { status: 400 });
  }

  let newStatus: SettableStatus | null = null;
  if (body.status) {
    if (!(SETTABLE as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    newStatus = body.status as SettableStatus;
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (newStatus) {
    await updateDesignTicket(id, { status: newStatus });
  }
  await createTicketUpdate({
    ticketId: id,
    authorId: dbUser.id,
    message,
    newStatus,
  });
  await createNotification({
    userId: ticket.userId,
    type: "ticket_status",
    payload: {
      ticketId: id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      status: newStatus ?? undefined,
      message,
    },
  });

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for the new route.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/tickets/[id]/updates/route.ts"
git commit -m "feat(admin): post progress update + notify requester"
```

---

### Task 5: Shared timeline + admin ticket-detail page + composer + queue link

**Files:**
- Create: `src/app/(dashboard)/design-request/ticket-updates-timeline.tsx` (shared, server component)
- Create: `src/app/admin/tickets/[id]/page.tsx`
- Create: `src/app/admin/tickets/[id]/update-composer.tsx` (client)
- Modify: `src/app/admin/tickets/queue-client.tsx` (link each row to the detail page)

**Interfaces:**
- Consumes: `getDesignTicketById`, `getBrandById`, `getDeliverables`, `getTicketUpdates` (Task 2); `requireRole`; `formatTicketNumber`; `humanizeStatus`, `TicketStatus`, `TicketStatusBadge`.
- Produces:
  ```ts
  // ticket-updates-timeline.tsx
  interface TimelineUpdate { id: string; message: string; newStatus: string | null; createdAt: Date; authorName: string }
  export function TicketUpdatesTimeline({ updates }: { updates: TimelineUpdate[] }): JSX.Element
  // update-composer.tsx
  export function UpdateComposer({ ticketId }: { ticketId: string }): JSX.Element
  ```

- [ ] **Step 1: Create the shared timeline component**

Create `src/app/(dashboard)/design-request/ticket-updates-timeline.tsx`:

```tsx
import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";

export interface TimelineUpdate {
  id: string;
  message: string;
  newStatus: string | null;
  createdAt: Date;
  authorName: string;
}

function formatWhen(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TicketUpdatesTimeline({
  updates,
}: {
  updates: TimelineUpdate[];
}) {
  if (updates.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
        No updates yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {updates.map((u) => (
        <li
          key={u.id}
          className="rounded-xl border border-[var(--border)] bg-surface-1 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">
              {u.authorName}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {formatWhen(u.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
            {u.message}
          </p>
          {u.newStatus && (
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Status → {humanizeStatus(u.newStatus as TicketStatus)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Create the update composer (client)**

Create `src/app/admin/tickets/[id]/update-composer.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { humanizeStatus } from "@/lib/design/tickets-ui";

const STATUS_OPTIONS = ["assigned", "in_progress", "ready_for_review"] as const;

export function UpdateComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, status: status || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not post the update.";
        setError(msg);
        toast.error(msg);
        return;
      }
      setMessage("");
      setStatus("");
      toast.success("Update posted");
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
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <Textarea
        value={message}
        disabled={pending}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Post a progress update the requester will see…"
        className="min-h-[80px]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          disabled={pending}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-surface-1 px-2 text-[13px] text-foreground"
        >
          <option value="">No status change</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </select>
        <Button
          variant="default"
          loading={pending}
          loadingText="Posting…"
          disabled={pending || message.trim().length === 0}
          onClick={submit}
        >
          Post update
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the admin ticket-detail page**

Create `src/app/admin/tickets/[id]/page.tsx`:

```tsx
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import {
  type TimelineUpdate,
  TicketUpdatesTimeline,
} from "@/app/(dashboard)/design-request/ticket-updates-timeline";
import { requireRole } from "@/lib/auth/require-role";
import {
  getBrandById,
  getDeliverables,
  getDesignTicketById,
  getTicketUpdates,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { UpdateComposer } from "./update-composer";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["designer", "admin"]);
  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) notFound();

  const [brand, deliverables, updateRows] = await Promise.all([
    getBrandById(ticket.brandId),
    getDeliverables(ticket.id),
    getTicketUpdates(ticket.id),
  ]);

  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName:
      `${r.authorFirstName ?? ""} ${r.authorLastName ?? ""}`.trim() || "Staff",
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/tickets"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Queue
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-foreground">
            {formatTicketNumber(ticket.ticketNumber)}
          </h1>
          <p className="text-[15px] text-[var(--text-secondary)]">
            {ticket.designType}
            {ticket.dimensions ? ` · ${ticket.dimensions}` : ""}
            {brand?.name ? ` · ${brand.name}` : ""}
          </p>
        </div>
        <TicketStatusBadge status={ticket.status as TicketStatus} />
      </header>

      <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Brief
          </p>
          <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {ticket.brief}
          </p>
        </div>
        {ticket.notes && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Notes
            </p>
            <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
              {ticket.notes}
            </p>
          </div>
        )}
        <p className="text-[13px] text-[var(--text-muted)]">
          Due {formatDate(ticket.dueDate)} · {deliverables.length} deliverable
          {deliverables.length === 1 ? "" : "s"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          Post an update
        </h2>
        <UpdateComposer ticketId={ticket.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <TicketUpdatesTimeline updates={updates} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Link queue rows to the detail page**

In `src/app/admin/tickets/queue-client.tsx`, add a `Link` to the detail page in each `QueueItem`. Add the import at the top:

```tsx
import Link from "next/link";
```

Then, inside the `QueueItem` return, add a "View / update" link in the action row (after the closing `</input>`/file input, before the closing `</div>` of the `mt-3 flex` action row):

```tsx
        <Link
          href={`/admin/tickets/${row.id}`}
          className="inline-flex h-9 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-primary hover:underline"
        >
          View / update
        </Link>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for the four touched files.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/design-request/ticket-updates-timeline.tsx" "src/app/admin/tickets/[id]/page.tsx" "src/app/admin/tickets/[id]/update-composer.tsx" "src/app/admin/tickets/queue-client.tsx"
git commit -m "feat(admin): ticket detail page with update composer + queue link"
```

---

### Task 6: Show the update timeline on the requester's ticket page

**Files:**
- Modify: `src/app/(dashboard)/design-request/[id]/page.tsx`

**Interfaces:**
- Consumes: `getTicketUpdates` (Task 2), `TicketUpdatesTimeline` + `TimelineUpdate` (Task 5).
- Produces: the requester sees a read-only "Updates" section; every author is labeled "KO Design Team" (no staff-identity leak).

- [ ] **Step 1: Load updates and render the timeline**

In `src/app/(dashboard)/design-request/[id]/page.tsx`:

(a) Add imports:

```ts
import {
  type TimelineUpdate,
  TicketUpdatesTimeline,
} from "../ticket-updates-timeline";
import { getDeliverables, getDesignTicketById, getTicketUpdates } from "@/lib/db/queries";
```

(merge `getTicketUpdates` into the existing `@/lib/db/queries` import rather than duplicating it.)

(b) After `const deliverables = await getDeliverables(ticket.id);`, load and map updates:

```ts
  const updateRows = await getTicketUpdates(ticket.id);
  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName: "KO Design Team",
  }));
```

(c) Add an Updates section just before the `{status === "ready_for_review" && <ReviewActions .../>}` line:

```tsx
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <TicketUpdatesTimeline updates={updates} />
      </section>
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for the page.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS (the only new tests are Task 3's; the rest is type/lint-verified).

- [ ] **Step 4: Manual verification (needs DB + auth environment)**

Sign in as a designer/admin, open `/admin/tickets`, click **View / update** on a ticket, post an update (with and without a status change). Then sign in as that ticket's owner and confirm: the update appears under "Updates" on `/design-request/[id]` labeled "KO Design Team", the bell shows the update's message, and the unread badge increments. Confirm posting an empty message is rejected.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/design-request/[id]/page.tsx"
git commit -m "feat(admin): show progress-update timeline on the requester ticket page"
```

---

## Self-Review notes

- **Spec coverage:** `ticket_updates` table (Task 1) ✓; staff posts free-text update → notification to owner (Task 4) ✓; admin ticket-detail page + composer (Task 5) ✓; requester sees timeline (Task 6) ✓; bell surfaces the message (Task 3) ✓; reuses existing queue/notifications/auth (Tasks 4-6) ✓; no staff-identity leak (Task 5/6 authorName) ✓.
- **Type consistency:** `ticketUpdates.$inferInsert` (Task 1) consumed by `createTicketUpdate` (Task 2) and the route (Task 4); `getTicketUpdates` row shape `{ update, authorFirstName, authorLastName }` (Task 2) mapped to `TimelineUpdate` (Task 5) in both pages (Tasks 5, 6); `SETTABLE`/`STATUS_OPTIONS` are the same three statuses in the route (Task 4) and composer (Task 5).
- **No placeholders:** every code step is complete, including the hand-written `0003` migration.
- **Migration applied in Task 1** against the shared DB so later tasks and manual testing work; the runner is idempotent so redeploys are safe.
