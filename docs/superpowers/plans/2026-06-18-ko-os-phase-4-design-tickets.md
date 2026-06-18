# Plan: Phase 4 — Design Tickets + Designer Admin

**Date:** 2026-06-18
**Goal (design spec §7):** Close the revenue loop. Request Design (from a calendar item) → ticket → confirmation → tickets list/detail → lifecycle → deliverables (R2) + notifications → a lightweight designer/admin fulfillment queue. "AI plans, humans design."

**Verifiable now:** DB (Aiven/local) + Gemini + R2 all live, so ticket creation, deliverable upload/download, and notifications are tested for real.

## Source of truth
- UI spec §5.8 (request form, prefilled), §5.9/confirmation, §5.10 (delivery + notification), Design Tickets List + Lifecycle table (statuses/colors), item-detail ticket states.
- Design spec §3.4 (lifecycle: Submitted→Assigned→In Progress→Ready for Review→Delivered, + Revision Requested side-path), §8 (billing-readiness: usage_events + invoice stub), §10 (designer admin intentionally minimal: queue + status + upload).
- Schema already has `design_tickets` (ticketNumber int unique, calendarItemId, brandId, userId, assignedDesignerId, designType, dimensions, slides, brief, notes, dueDate, status, ts), `design_deliverables` (ticketId, fileUrl, fileName, slideIndex), `notifications` (userId, type, payload, readAt). Roles enum `user|designer|admin` exists.

## Key decisions
- **ticketNumber (DT-#####):** add a Postgres sequence (`pgSequence`) and default `ticketNumber` to `nextval` — collision-free, survives `db:push`. Format helper `formatTicketNumber(n)` → `DT-00124` (TDD). Requires `db:push` to local + Aiven.
- **Calendar item ↔ ticket link:** via `design_tickets.calendarItemId` (reverse lookup) — no new column. "Design Ticket Submitted" state derived from existence of a ticket for that item.
- **Deliverables:** uploaded to R2 under `deliverables/<ticketId>/…` (private); downloaded via short-lived **signed URLs** (`getSignedReadUrl`). Per-file download now; "Download all as ZIP" deferred (noted in UI) to avoid a heavy dep.
- **Role gating:** `requireRole(["designer","admin"])` helper + an `/admin` layout guard.
- **Notifications:** created on delivery + status changes; user-side **bell with unread count** polled via TanStack Query (~30s) per spec §10; mark-as-read. Toast on the calendar/delivery path.
- **Invoice stub:** confirmation screen carries a disabled "Get Invoice" affordance (design spec §8).

## Tasks

### 1. Schema + ticket number (TDD)
- Add `pgSequence("design_ticket_number_seq")`; set `designTickets.ticketNumber` default `sql\`nextval(...)\``. `formatTicketNumber(n)` helper + test. `db:push` to local **and** Aiven (both need the sequence).

### 2. Queries
- Tickets: `createDesignTicket`, `getTicketById` (with brand+item join), `getTicketsByUser`, `getTicketForCalendarItem`, `updateTicketStatus`, `assignTicket`, `getDesignerQueue` (submitted/assigned/in_progress), `getTicketsAssignedTo`.
- Deliverables: `addDeliverable`, `getDeliverables(ticketId)`.
- Notifications: `createNotification`, `getNotifications(userId)`, `getUnreadCount(userId)`, `markNotificationsRead`.
- Ownership enforced everywhere (user owns ticket via brand.userId; designer sees queue/assigned; admin broader).

### 3. Create-ticket route — `POST /api/design-tickets`
- Auth → body `{ calendarItemId?, brandId, designType, dimensions?, slides?, brief, notes?, dueDate? }` → verify brand ownership → insert ticket (status `submitted`, ticketNumber from sequence) → `recordUsageEvent("design_ticket_created", {designType})` → return `{ ticket }`. No silent failure.

### 4. Request Design modal (calendar) — replace the Phase-3 seam
- In the calendar item drawer, **Request Design** opens a modal prefilled per §5.8: campaign (read-only), calendar item (read-only), design type (editable, default from item), dimensions (auto from item), brief (from item, editable), brand colors + logo (from brand), notes, due date (default 2 days before item date). Footer Cancel/Submit; submit → route → confirmation screen (§5.9: checkmark, ticket summary, View My Tickets + Back to Calendar, disabled Get Invoice stub). On success the drawer/item reflects "Design Ticket Submitted".

### 5. Tickets list — `/design-request`
- `requireBrand` → `getTicketsByUser`. Title + filter tabs (All | Submitted | In Progress | Delivered) → cards (DT-#####, status badge, date, design type, campaign). Empty state. URL filter via nuqs.

### 6. Ticket detail — `/design-request/[id]`
- Ownership-checked. Shows ticket fields, status timeline, brief/notes, brand context, and **deliverables** (thumbnails + signed-URL downloads) when present. When `ready_for_review`/`delivered`: actions to **approve** (→ delivered, item → ready) or **request revision** (→ revision_requested). Status badges per lifecycle colors.

### 7. Designer/admin — `/admin/tickets` (role: designer|admin)
- `/admin` layout guarded by `requireRole`. Queue list (`getDesignerQueue`) + "my assigned". Actions: **Claim** (assign self → assigned), **advance status** (in_progress / ready_for_review), **upload deliverables** (→ R2 via a route, status → ready_for_review, create notification for the user). Minimal per design spec §10.

### 8. Deliverable upload + download routes
- `POST /api/admin/tickets/[id]/deliverables` (role-gated): multipart → R2 `deliverables/<ticketId>/…` → `addDeliverable` rows → notify user. `GET /api/design-tickets/[id]/deliverables/[deliverableId]` → ownership/role check → 302 to signed URL.

### 9. Notifications (user)
- Bell in the dashboard header: unread count (TanStack Query poll ~30s), dropdown list, mark-as-read on open. `GET /api/notifications` + `POST /api/notifications/read`. Toast hook for "design ready" where appropriate.

### 10. Verify + review + tag
- Gates: tsc, vitest, biome. **Live:** seed brand+calendar item; create ticket (assert DT-##### + usage_event); designer claims + uploads a deliverable to R2; user fetches signed download; notification created + unread count. `next build` green. Two-stage review, fix findings, tag `phase-4-design-tickets`.

## Out of scope (later)
- ZIP "download all", billing/checkout/real invoices (stub only), realtime (polling for now), email notifications, full PM tooling for designers.
