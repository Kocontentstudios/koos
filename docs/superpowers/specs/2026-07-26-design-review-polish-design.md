# Epic 1 — Design-Review Polish (Design Spec)

Status: Draft for review · Date: 2026-07-26 · Owner: engineering
Parent program: `.claude/plans/squishy-mapping-pixel.md`

## 1. Purpose

Tighten the design-delivery loop so users can review a delivered design, choose satisfied vs.
needs-revision, and give the design team unambiguous revision direction — including **visual
annotations** on the design itself. Covers original request **#1** and its two sub-notes
(view-before-download gating; an annotation canvas for clarity). Much of the review flow already
exists (Epic-3-era): this epic adds the three missing pieces.

## 2. Locked decisions (from the user)

- **View before download:** when a user clicks to *view* a delivered design, it is shown inline
  and **not downloaded to disk until they state they're satisfied** (approve). Download is gated
  on approval.
- **Satisfied vs. revise:** already exists (`ReviewActions` → approve/revise + note). This epic
  keeps it and enriches revise with annotations.
- **Annotation canvas:** a canvas where the user can mark/outline the part they want updated and
  add notes, sent to the design team with the revision request.
- **Design-team visibility:** revision requests surface to the design team as a **tab beside the
  recent tickets on the admin dashboard**, plus an in-app notification (today it's email-only).

## 3. Current-state anchors (reuse, don't rebuild)

- User ticket detail: `src/app/(dashboard)/design-request/[id]/page.tsx` — previews image
  deliverables, per-file + ZIP download, renders `ReviewActions` when status `ready_for_review`.
- Review action: `src/app/(dashboard)/design-request/[id]/review-actions.tsx` +
  `POST /api/design-tickets/[id]/review/route.ts` (approve → `delivered`; revise →
  `revision_requested` + appends note; emails team via `sendTicketReviewTeamEmail`).
- Deliverable serving: `.../deliverables/[deliverableId]/route.ts` (signed-URL 302 redirect,
  access-checked) and `.../deliverables/zip/route.ts` (`Content-Disposition: attachment`).
- Admin: `src/app/admin/tickets/queue-client.tsx` (recent tickets, no status tabs yet),
  `.../[id]/page.tsx` (renders brief/notes/deliverables/updates).
- Notifications: `createNotification(...)`, `getNotifications`, `markNotificationsRead` exist;
  `notification_type` enum has `ticket_status`; consumer `/api/notifications`. Designers/admins =
  users with role `designer` or `admin`.
- Statuses: `design_ticket_status` enum includes `ready_for_review`, `delivered`,
  `revision_requested`. Storage: R2 via `src/lib/storage.ts` (`getSignedReadUrl`, `uploadObject`).
- Access guard: `checkBrandAccess(userId, brandId, "manage_content")`.

## 4. Part A — View-before-download gating

**Rule:** a user may always *view* a delivered design inline; *downloading* (saving to disk) is
allowed only once the ticket is **approved** (`delivered`). Staff (designer/admin) may always
download.

- Deliverable route `.../deliverables/[deliverableId]/route.ts`: accept `?disposition=inline`
  (default) vs `?disposition=attachment`.
  - `inline`: always allowed for an authorized viewer — used for the preview `<img>` and the
    in-page viewer. (The signed URL is short-lived; inline viewing doesn't equal a saved file.)
  - `attachment`: allowed only if `ticket.status === "delivered"` (approved) OR the caller is
    staff; otherwise **403** with a clear message ("Approve the design to download it"). Pass a
    response-content-disposition to the signed URL so the browser downloads vs. renders.
- ZIP route `.../deliverables/zip/route.ts`: same gate — 403 until `delivered`/staff.
- UI (`design-request/[id]/page.tsx`): before approval, show a **View** affordance (opens the
  inline viewer / annotation canvas) and present Download as disabled/hidden with a hint that
  approving unlocks download. After approval, show Download + ZIP as today.

Server-side gating is the source of truth (not just hiding the button).

## 5. Part B — Annotation canvas

Let the user mark up a delivered design image and attach notes, bundled into the revision
request so the design team sees exactly what to change.

### 5.1 Data model — new `design_annotations` table
```
design_annotations {
  id uuid pk
  ticket_id uuid → design_tickets (cascade)
  deliverable_id uuid → design_deliverables (cascade)   -- which image
  author_id uuid → users
  shapes jsonb   -- [{ type: "rect"|"path", coords: normalized 0..1, color }]
  note text      -- per-annotation comment
  created_at timestamptz
}
```
Coordinates are **normalized (0–1)** so annotations render correctly at any display size.
Migration via `scripts/migrate.mjs` (hand-written SQL; drizzle/meta gitignored). Queries:
`addAnnotation`, `getAnnotationsForTicket`.

### 5.2 Authoring UI (user side)
- A client component `annotation-canvas.tsx`: renders the deliverable image with a `<canvas>`
  overlay; tools = rectangle + freehand outline; a note field per mark. Reuses `Button`/tokens.
- Lives in the review area of `design-request/[id]/page.tsx` (a "Mark up this design" affordance
  opening the canvas over a chosen image deliverable).
- On **Request Revision**, the composed annotations (shapes + notes) POST alongside the existing
  review `revise` action. Extend `POST /api/design-tickets/[id]/review` to accept an optional
  `annotations` array; persist each via `addAnnotation`, still set `revision_requested`, still
  append the text note, still email + (Part C) notify the team.
- Keep it pragmatic v1: image deliverables only (skip PDFs); mark → note → send.

### 5.3 Admin rendering (design-team side)
- Admin ticket detail (`admin/tickets/[id]/page.tsx`): for a `revision_requested` ticket, render
  each deliverable image with its annotations drawn read-only on an overlay (same normalized
  coords), plus the per-annotation notes listed. This is what makes the request unambiguous.

## 6. Part C — Admin revisions tab + in-app notify

- **Revisions tab:** the admin tickets surface (`admin/tickets/queue-client.tsx` / page) gets
  status tabs — at minimum an "Needs revision" tab filtering `revision_requested` — beside the
  existing recent/queue view. Reuse existing status querying; add a `revision_requested` count
  badge.
- **In-app notification:** in the review route's `revise` branch, in addition to the existing
  email, write a `notifications` row (`type: "ticket_status"`, payload = ticketNumber + link) for
  each design-team recipient (users with role `designer`/`admin`) via `createNotification`. This
  makes revision requests visible in-app, not just by email. Best-effort (a notify failure must
  not fail the revise action).

## 7. Error handling & security
- Download gating enforced server-side (403 until approved / staff), not merely UI-hidden.
- Annotation writes go through `checkBrandAccess` on the ticket's brand; a deliverable_id is
  validated to belong to the ticket (no cross-ticket annotation).
- In-app notify + email are best-effort and isolated from the status write.
- Normalized coords prevent leaking absolute pixel geometry / rendering mismatches.

## 8. Testing
- Part A: download route 403s pre-approval for a non-staff owner; 200/redirect after `delivered`;
  inline always allowed; ZIP gated identically; staff bypass.
- Part B: `addAnnotation`/`getAnnotationsForTicket`; review route persists annotations + still
  transitions to `revision_requested`; deliverable_id-belongs-to-ticket validation; canvas
  component renders marks (jsdom-level: normalized→pixel mapping is a pure function, unit-test it).
- Part C: revise writes a `ticket_status` notification for each designer/admin (best-effort
  swallow on failure); admin tab filters `revision_requested`.
- Live QA: deliver a ticket → user views inline (no download) → marks up an image + note →
  request revision → admin sees the annotated image + note in the "Needs revision" tab + an
  in-app notification → approve unlocks download.

## 9. Phasing
1. **1-A:** view-before-download gating (routes + UI). Small, self-contained.
2. **1-B:** `design_annotations` table + queries + review-route annotation persistence.
3. **1-C:** annotation canvas authoring UI (user) + admin read-only rendering.
4. **1-D:** admin revisions tab + in-app notification on revise.

## 10. Open items to confirm during build
- Annotation tools for v1: rectangle + freehand only (no text-on-image, no arrows) — confirm.
- Design-team notification recipients: all `designer`+`admin` users (vs. a single configured
  account) — default to all designer/admin; revisit if noisy.
- Whether the annotation canvas also applies pre-delivery (design-request composition) — no; v1
  is review-time markup of delivered images only.
