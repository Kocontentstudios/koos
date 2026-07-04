# Admin Part C — Overview Dashboard (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff an `/admin` landing dashboard with read-only operational metrics: open/overdue tickets, tickets by status, per-designer load, user counts, and recent activity.

**Architecture:** A few aggregate query functions in `queries/index.ts`, a server component `/admin/page.tsx` that fetches them in parallel and renders stat cards + breakdown lists, and a nav update so `/admin` is the dashboard home. Part C of the 4-part admin feature (A done; C now; then B settings, D broadened management).

**Tech Stack:** Next.js 16 App Router (server components), Drizzle ORM aggregates (`count`), Biome.

## Global Constraints

- Scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test`; typecheck = `npx tsc --noEmit`.
- Auth: `/admin` is inside the existing `admin/layout.tsx` which already calls `requireRole(["designer","admin"])`; the page also calls it (defense in depth). No schema/migration changes in Part C.
- Styling: CSS-variable tokens only (`var(--border)`, `bg-surface-1`, `text-foreground`, `var(--text-secondary)`, `var(--text-muted)`); no hardcoded light hexes / `text-white` on theme surfaces.
- Reuse: `formatTicketNumber` (`@/lib/design/ticket`), `humanizeStatus`/`TicketStatus` (`@/lib/design/tickets-ui`), `TicketStatusBadge`. Metrics are read-only — no writes.
- One commit per task.

---

### Task 1: Aggregate dashboard queries

**Files:**
- Modify: `src/lib/db/queries/index.ts` (add operators to the drizzle import; add a new "Admin dashboard" section)

**Interfaces:**
- Consumes: `designTickets`, `users`, `brands`, `db` (already imported).
- Produces:
  ```ts
  getTicketCountsByStatus(): Promise<Array<{ status: string; count: number }>>
  getOverdueTicketCount(): Promise<number>            // due_date < now AND status != delivered
  getUserCountsByRole(): Promise<Array<{ role: string; count: number }>>
  getDesignerLoads(): Promise<Array<{ designerId: string | null; firstName: string | null; lastName: string | null; count: number }>>
  getRecentTickets(limit?: number): Promise<Array<{ id: string; ticketNumber: number; designType: string; status: string; brandName: string | null; createdAt: Date }>>
  ```

- [ ] **Step 1: Extend the drizzle operator import**

In `src/lib/db/queries/index.ts`, change the first import line from:

```ts
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
```

to:

```ts
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
} from "drizzle-orm";
```

- [ ] **Step 2: Add the dashboard query section**

At the end of `src/lib/db/queries/index.ts`, add:

```ts
// ── Admin dashboard ─────────────────────────────────────────────────

/** Ticket counts grouped by status. */
export async function getTicketCountsByStatus() {
  return db
    .select({ status: designTickets.status, count: count() })
    .from(designTickets)
    .groupBy(designTickets.status);
}

/** Tickets past their due date that are not yet delivered. */
export async function getOverdueTicketCount() {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(
      and(
        lt(designTickets.dueDate, new Date()),
        ne(designTickets.status, "delivered"),
      ),
    );
  return row?.count ?? 0;
}

/** User counts grouped by role. */
export async function getUserCountsByRole() {
  return db
    .select({ role: users.role, count: count() })
    .from(users)
    .groupBy(users.role);
}

/** Active (assigned/in_progress/ready_for_review) ticket load per designer. */
export async function getDesignerLoads() {
  return db
    .select({
      designerId: designTickets.assignedDesignerId,
      firstName: users.firstName,
      lastName: users.lastName,
      count: count(),
    })
    .from(designTickets)
    .leftJoin(users, eq(designTickets.assignedDesignerId, users.id))
    .where(
      and(
        isNotNull(designTickets.assignedDesignerId),
        inArray(designTickets.status, [
          "assigned",
          "in_progress",
          "ready_for_review",
        ]),
      ),
    )
    .groupBy(
      designTickets.assignedDesignerId,
      users.firstName,
      users.lastName,
    );
}

/** Most recently created tickets, with brand name. */
export async function getRecentTickets(limit = 8) {
  return db
    .select({
      id: designTickets.id,
      ticketNumber: designTickets.ticketNumber,
      designType: designTickets.designType,
      status: designTickets.status,
      brandName: brands.name,
      createdAt: designTickets.createdAt,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .orderBy(desc(designTickets.createdAt))
    .limit(limit);
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for `queries/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/queries/index.ts
git commit -m "feat(admin): aggregate queries for the overview dashboard"
```

---

### Task 2: `/admin` dashboard page + nav

**Files:**
- Create: `src/app/admin/page.tsx`
- Modify: `src/app/admin/layout.tsx` (add Dashboard nav link; point the logo at `/admin`)

**Interfaces:**
- Consumes: the Task 1 queries; `requireRole`; `formatTicketNumber`; `humanizeStatus`, `TicketStatus`; `TicketStatusBadge`.
- Produces: `/admin` renders the dashboard; `/admin/tickets` (queue) and `/admin/users` remain unchanged.

- [ ] **Step 1: Create the dashboard page**

Create `src/app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { requireRole } from "@/lib/auth/require-role";
import {
  getDesignerLoads,
  getOverdueTicketCount,
  getRecentTickets,
  getTicketCountsByStatus,
  getUserCountsByRole,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";

const OPEN_STATUSES = new Set<string>([
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "revision_requested",
]);

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <p className="text-[12px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold text-foreground">
        {value}
      </p>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  await requireRole(["designer", "admin"]);

  const [byStatus, overdue, byRole, loads, recent] = await Promise.all([
    getTicketCountsByStatus(),
    getOverdueTicketCount(),
    getUserCountsByRole(),
    getDesignerLoads(),
    getRecentTickets(8),
  ]);

  const statusMap = new Map(byStatus.map((r) => [r.status, r.count]));
  const openCount = byStatus
    .filter((r) => OPEN_STATUSES.has(r.status))
    .reduce((sum, r) => sum + r.count, 0);
  const readyCount = statusMap.get("ready_for_review") ?? 0;
  const deliveredCount = statusMap.get("delivered") ?? 0;
  const totalUsers = byRole.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Dashboard
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          Operational overview of the design pipeline.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open tickets" value={openCount} />
        <StatCard label="Overdue" value={overdue} />
        <StatCard label="Ready for review" value={readyCount} />
        <StatCard label="Delivered" value={deliveredCount} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Tickets by status
          </h2>
          <ul className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
            {byStatus.length === 0 ? (
              <li className="text-[13px] text-[var(--text-secondary)]">
                No tickets yet.
              </li>
            ) : (
              byStatus.map((r) => (
                <li
                  key={r.status}
                  className="flex items-center justify-between gap-3"
                >
                  <TicketStatusBadge status={r.status as TicketStatus} />
                  <span className="text-[14px] font-medium text-foreground">
                    {r.count}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Designer load
          </h2>
          <ul className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
            {loads.length === 0 ? (
              <li className="text-[13px] text-[var(--text-secondary)]">
                No active assignments.
              </li>
            ) : (
              loads.map((l) => (
                <li
                  key={l.designerId ?? "unassigned"}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-[14px] text-foreground">
                    {`${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() ||
                      "Unknown"}
                  </span>
                  <span className="text-[14px] font-medium text-foreground">
                    {l.count} active
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="text-[13px] text-[var(--text-muted)]">
            {totalUsers} user{totalUsers === 1 ? "" : "s"} ·{" "}
            {byRole
              .map((r) => `${r.count} ${r.role}`)
              .join(" · ")}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          Recent tickets
        </h2>
        <ul className="flex flex-col gap-2">
          {recent.length === 0 ? (
            <li className="rounded-xl border border-[var(--border)] bg-surface-1 px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
              No tickets yet.
            </li>
          ) : (
            recent.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/tickets/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-3 hover:border-primary"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatTicketNumber(t.ticketNumber)}
                    </span>
                    <span className="text-[14px] text-foreground">
                      {t.designType}
                    </span>
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t.brandName ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <TicketStatusBadge status={t.status as TicketStatus} />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatDate(t.createdAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add the Dashboard nav link + point the logo at `/admin`**

In `src/app/admin/layout.tsx`:

(a) Change the logo `Link` href from `/admin/tickets` to `/admin`.

(b) Add a Dashboard link as the first nav item (before Queue):

```tsx
          <nav className="flex items-center gap-4 text-[13px] text-[var(--text-secondary)]">
            <Link href="/admin" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/admin/tickets" className="hover:text-foreground">
              Queue
            </Link>
            {isAdmin && (
              <Link href="/admin/users" className="hover:text-foreground">
                Users
              </Link>
            )}
          </nav>
```

- [ ] **Step 3: Typecheck + lint + full suite**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run lint` → no errors for the two files.
Run: `npm test` → PASS (no new tests; type/lint-verified).

- [ ] **Step 4: Manual verification (needs DB + auth)**

Sign in as a designer/admin and open `/admin`. Confirm the stat cards, status breakdown, designer load, user counts, and recent-tickets list render with real numbers, that recent-ticket rows link to the detail page, and that the "Dashboard" nav item and logo both route to `/admin`.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx src/app/admin/layout.tsx
git commit -m "feat(admin): overview dashboard at /admin with pipeline metrics"
```

---

## Self-Review notes

- **Spec coverage:** open/overdue/by-status/per-designer/user-counts/recent-activity (Task 1 queries → Task 2 page) ✓; `/admin` landing + nav (Task 2) ✓; read-only, no writes ✓; reuses existing badge/auth ✓.
- **Type consistency:** the five query return shapes (Task 1) are consumed exactly in the page (Task 2); `count()` yields `number`; statuses cast to `TicketStatus` for the badge.
- **No placeholders:** all code complete. No migration (read-only feature).
- **Overdue semantics:** `lt(dueDate, now)` excludes null due dates (null comparisons are null → not matched), so undated tickets are never "overdue" — intended.
