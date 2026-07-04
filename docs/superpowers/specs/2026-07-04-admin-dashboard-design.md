# Admin — Progress Updates, Config, Dashboard, Broadened Ticket Management

**Date:** 2026-07-04
**Feature:** 3 of 3 (strategy / design-request-emails / admin)
**Status:** Approved design, pending implementation plan

## Context — what already exists (do NOT rebuild)

- `src/app/admin/` shell guarded by `requireRole(["designer","admin"])`
  (`admin/layout.tsx`), titled "KO Design Admin".
- **Ticket queue** `admin/tickets/` — claim / start / upload deliverables
  (`queue-client.tsx`, `getDesignerQueue`).
- **User/role management** `admin/users/` — admin-only, `updateUserRole`.
- **Notifications** system — `notifications` table (types `design_ready` |
  `ticket_status` | `system`), bell plumbing (`api/notifications/*`,
  `createNotification`, `getUnreadNotificationCount`, ...).
- `user_role` enum (`user | designer | admin`), `requireRole`, `getAuthUser`.
- Ticket status enum: `submitted → assigned → in_progress → ready_for_review →
  delivered`, plus `revision_requested`.

**Principle:** fill the real gaps only; reuse the queue, notifications, and auth.
Avoid redundancy.

## The gaps to fill (build in this order)

### A. Progress updates to users (the stated pain)

There is currently **no way for staff to send a free-text progress update**; the
`ticket_status` notification type is defined but unused, and the designer
status-change route creates no notification.

- New table `ticket_updates` (`id, ticketId FK, authorId FK users, message text,
  newStatus <ticket_status | null>, createdAt`) + migration.
- New **admin ticket detail page** `/admin/tickets/[id]` (there is a queue but no
  per-ticket admin detail): shows ticket data, deliverables, and an update
  composer. Guarded designer-or-admin.
- Posting an update inserts a `ticket_updates` row **and** a `ticket_status`
  notification to `ticket.userId` (reuse `createNotification`). Optional status
  change applied in the same action.
- User side: render the update timeline on the existing
  `design-request/[id]/page.tsx` (owner-guarded already).

### B. System configuration (admin-only)

- New table `app_settings` (single-row or key/value jsonb) with:
  design-team notification email (consumed by Feature 2), default due-date offset
  (days), and feature toggles.
- New page `/admin/settings` (`requireRole(["admin"])`) + API to read/update.
- **SMTP secrets stay in env** (security). The page shows SMTP status read-only
  (configured / not configured) and never stores passwords.

### C. Admin overview dashboard

- New `/admin` landing page (index) with read-only metrics: open tickets,
  overdue tickets (past `dueDate`, not delivered), tickets by status, per-designer
  load (assigned counts), user counts, recent activity (latest tickets/updates).
- Reuses/extends `queries/index.ts` with aggregate read queries.

### D. Broadened ticket management

- Add `priority` enum to `design_tickets` (`low | normal | high | urgent`,
  default `normal`) + migration; show + sort in the queue.
- Admin can **reassign** a ticket to any designer (`assignedDesignerId`) and
  **override status** beyond the designer-settable set. Extend
  `api/admin/tickets/[id]/status/route.ts` (and/or a new reassign route) with an
  admin-only branch; keep `DESIGNER_SETTABLE` for designers.

## Authorization split

- Designer **or** admin: queue, ticket detail, post progress updates,
  deliverables.
- Admin **only**: settings, user roles, reassignment, status override, priority
  policy.
- Follow existing route pattern (`getAuthUser()` → role check → 403) and
  `requireRole` in server pages.

## Error handling / edge cases

- Progress update: reject empty message; if a status change is included, validate
  it against the enum and the actor's allowed set.
- Settings: validate email format for the team address; missing settings row →
  fall back to env defaults.
- Dashboard queries must not N+1; use aggregate SQL.
- Reassign: target must be a `designer` or `admin`; guard against invalid ids.

## Testing

- Post an update as staff → user sees it in their ticket timeline + gets a
  notification.
- Edit team email in settings → Feature 2 uses it (env fallback when unset).
- Dashboard metrics match seeded data (open/overdue/by-status/per-designer).
- Admin reassigns + overrides status; designer still limited to
  `DESIGNER_SETTABLE`; priority sorts in the queue.

## Sequencing

A → C → B → D. A depends on nothing new; B is consumed by Feature 2 (env fallback
bridges the gap until B ships).

## Out of scope

- Real-time updates / websockets (notifications + refresh are sufficient).
- A full comment thread / two-way messaging (updates are staff→user one-way).
- Replacing the existing queue or user-management UIs.
