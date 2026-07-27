# Design-Review Polish (Epic 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can view a delivered design inline (no download until approved), mark it up on an annotation canvas with notes, and the design team sees revision requests as an admin "Needs revision" tab plus an in-app notification.

**Architecture:** Server-side download gating on ticket status; a new `design_annotations` table (normalized 0–1 coords) whose rows are created alongside the existing review `revise` action; a canvas authoring component (user) and read-only overlay (admin); a status-filtered admin tab and best-effort `notifications` rows to designer/admin users.

**Tech Stack:** Next.js App Router, Drizzle/Postgres, Cloudflare R2 (`src/lib/storage.ts`), React `<canvas>`, vitest.

## Global Constraints
- Package manager (WSL): `corepack pnpm`; never bare `pnpm`; never `npm install`.
- Auth: every ticket/deliverable/annotation access goes through `checkBrandAccess(userId, ticket.brandId, "manage_content")`; staff = `dbUser.role === "designer" || "admin"`.
- Download gating is server-side truth (403), not just UI hiding. Inline view is always allowed for an authorized viewer.
- Migrations: hand-written SQL under `drizzle/`, run via `scripts/migrate.mjs` (`_migrations` ledger); `drizzle/meta` gitignored; no `db:push`. Next migration number: check `ls drizzle/*.sql` (0013 exists).
- Best-effort side-effects (email, in-app notify) must never fail the status write.
- Only "why" comments (repo CLAUDE.md). biome-clean (`corepack pnpm exec biome check`) + `tsc --noEmit` clean before each commit.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File structure
```
src/lib/storage.ts                         # extend getSignedReadUrl: optional disposition+filename
src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.ts   # inline vs attachment gate
src/app/api/design-tickets/[id]/deliverables/zip/route.ts               # gate on delivered/staff
src/app/(dashboard)/design-request/[id]/page.tsx                        # view vs download UI
src/lib/db/schema.ts                       # + designAnnotations table
drizzle/0014_design_annotations.sql        # migration
src/lib/db/queries/index.ts                # addAnnotation, getAnnotationsForTicket
src/lib/design/annotation-geometry.ts      # pure normalized<->pixel mapping
src/app/api/design-tickets/[id]/review/route.ts                        # accept+persist annotations; notify team
src/components/design/annotation-canvas.tsx        # authoring (user)
src/components/design/annotation-overlay.tsx       # read-only render (admin + preview)
src/app/(dashboard)/design-request/[id]/review-actions.tsx             # bundle annotations into revise
src/app/admin/tickets/[id]/page.tsx        # render annotations read-only
src/app/admin/tickets/queue-client.tsx     # "Needs revision" tab
```

---

# PHASE 1-A — View-before-download gating

## Task 1: Content-disposition on signed URLs + gate the deliverable route

**Files:**
- Modify: `src/lib/storage.ts`, `src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.ts`
- Test: `src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.test.ts`

**Interfaces:**
- Produces: `getSignedReadUrl(key, expiresInSeconds?, opts?: { disposition?: "inline" | "attachment"; fileName?: string })` — passes `ResponseContentDisposition` to `GetObjectCommand`.

- [ ] **Step 1: Write failing tests** — mock `@/lib/auth/get-user`, `@/lib/db/queries` (`checkBrandAccess`, `getDesignTicketById`, `getDeliverableById`), `@/lib/storage`. Assert: (a) `?disposition=attachment` on a ticket whose status is NOT `delivered`, non-staff owner → 403; (b) same but staff (`role: "designer"`) → 302 redirect; (c) `?disposition=inline` (or no param) on a non-delivered ticket, authorized owner → 302; (d) `delivered` ticket + attachment + owner → 302.

```ts
// shape (fill mocks per existing route.test.ts patterns in the repo)
it("blocks download before approval for a non-staff owner", async () => {
  mockOwnerWithAccess(); mockTicket({ status: "ready_for_review" });
  const res = await GET(req("?disposition=attachment"), params);
  expect(res.status).toBe(403);
});
it("allows inline view before approval", async () => {
  mockOwnerWithAccess(); mockTicket({ status: "ready_for_review" });
  const res = await GET(req("?disposition=inline"), params);
  expect(res.status).toBe(302);
});
```

- [ ] **Step 2: Run → FAIL.** `corepack pnpm vitest run "src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.test.ts"`

- [ ] **Step 3: Implement.** In `storage.ts`, extend `getSignedReadUrl` to accept `opts` and pass `ResponseContentDisposition: opts.disposition === "attachment" ? \`attachment; filename="${opts.fileName}"\` : "inline"` into `GetObjectCommand`. In the route: parse `const disposition = new URL(req.url).searchParams.get("disposition") === "attachment" ? "attachment" : "inline";` After the existing access/staff resolution, add: `const isStaff = dbUser.role === "designer" || dbUser.role === "admin"; if (disposition === "attachment" && ticket.status !== "delivered" && !isStaff) return Response.json({ error: "Approve the design to download it." }, { status: 403 });` Pass `{ disposition, fileName: deliverable.fileName }` to `getSignedReadUrl`.

- [ ] **Step 4: Run → PASS**; `corepack pnpm exec tsc --noEmit`; `corepack pnpm exec biome check --write` the changed files.

- [ ] **Step 5: Commit** `feat: gate deliverable download on approval; inline view always allowed`.

---

## Task 2: Gate the ZIP route + view/download UI

**Files:**
- Modify: `src/app/api/design-tickets/[id]/deliverables/zip/route.ts`, `src/app/(dashboard)/design-request/[id]/page.tsx`
- Test: `src/app/api/design-tickets/[id]/deliverables/zip/route.test.ts`

- [ ] **Step 1: Failing test** — ZIP route 403s when `ticket.status !== "delivered"` and caller is non-staff owner; 200 when `delivered`; staff bypass. (Mirror Task 1 mocks; the route already has `checkBrandAccess` + staff detection.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In the ZIP route, after access + staff resolution, add the same gate: `if (ticket.status !== "delivered" && !isStaff) return Response.json({ error: "Approve the design to download it." }, { status: 403 });` In `page.tsx`: when `status !== "delivered"` and not staff, render a **View** button (opens the inline viewer / Task-6 canvas) and render Download/ZIP as a disabled control with hint "Approve to download"; when `delivered`, render Download + ZIP as today. The preview `<img src>` uses `?disposition=inline` (always allowed).

- [ ] **Step 4: Run → PASS**; tsc + biome clean.

- [ ] **Step 5: Commit** `feat: gate zip download; show view-vs-download by approval state`.

---

# PHASE 1-B — Annotation data + persistence

## Task 3: `design_annotations` table + queries

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/queries/index.ts`
- Create: `drizzle/0014_design_annotations.sql`
- Test: `src/lib/db/queries/design-annotations.test.ts`

**Interfaces:**
- Produces: `type AnnotationShape = { type: "rect" | "path"; coords: number[]; color: string }`; `addAnnotation(data): Promise<row>`; `getAnnotationsForTicket(ticketId): Promise<rows>`.

- [ ] **Step 1: Add Drizzle table** to `schema.ts`:
```ts
export const designAnnotations = pgTable("design_annotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => designTickets.id, { onDelete: "cascade" }),
  deliverableId: uuid("deliverable_id").notNull().references(() => designDeliverables.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shapes: jsonb("shapes").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index().on(t.ticketId)]);
```

- [ ] **Step 2: Migration** `drizzle/0014_design_annotations.sql` (confirm 0014 is next):
```sql
CREATE TABLE IF NOT EXISTS design_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES design_tickets(id) ON DELETE CASCADE,
  deliverable_id uuid NOT NULL REFERENCES design_deliverables(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shapes jsonb NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS design_annotations_ticket_id_idx ON design_annotations(ticket_id);
```

- [ ] **Step 3: Failing test** — `addAnnotation`/`getAnnotationsForTicket` exported functions (DB-free, mock `@/lib/db/client` per `brand-tool-queries.test.ts`).

- [ ] **Step 4: Implement queries** (`insert(...).returning()`; `select().where(eq(ticketId)).orderBy(createdAt)`), export `AnnotationShape`. Run migration locally: `node scripts/migrate.mjs`.

- [ ] **Step 5: Run → PASS**; tsc + biome clean; **Commit** `feat: design_annotations table + queries`.

---

## Task 4: Persist annotations through the review revise action

**Files:**
- Modify: `src/app/api/design-tickets/[id]/review/route.ts`
- Test: extend `src/app/api/design-tickets/[id]/review/route.test.ts`

**Interfaces:**
- Consumes: `addAnnotation` (Task 3), `getDeliverables` (validate deliverable belongs to ticket).

- [ ] **Step 1: Failing test** — a `revise` POST with `annotations: [{ deliverableId, shapes, note }]` where `deliverableId` belongs to the ticket → persists each via `addAnnotation` AND still sets `revision_requested`; an annotation whose `deliverableId` does NOT belong to the ticket → that annotation is rejected/skipped (assert `addAnnotation` not called for it) and the route does not 500.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Extend the request body type with optional `annotations?: { deliverableId: string; shapes: unknown; note?: string }[]`. In the `revise` branch, before/after the status update: fetch `getDeliverables(ticket.id)`, build a valid id set, and for each annotation whose `deliverableId` is in the set, `await addAnnotation({ ticketId: id, deliverableId, authorId: dbUser.id, shapes, note })`. Wrap annotation persistence so a failure logs but doesn't break the revise (best-effort, consistent with the email pattern). Keep the existing note append + email.

- [ ] **Step 4: Run → PASS**; tsc + biome clean; **Commit** `feat: persist review annotations on revision request`.

---

# PHASE 1-C — Canvas UI + admin rendering

## Task 5: Normalized geometry + annotation canvas (authoring)

**Files:**
- Create: `src/lib/design/annotation-geometry.ts`, `src/components/design/annotation-canvas.tsx`
- Test: `src/lib/design/annotation-geometry.test.ts`

**Interfaces:**
- Produces: `toNormalized(px, size)` / `toPixels(norm, size)` pure fns (0–1 ↔ px); `<AnnotationCanvas imageUrl onChange={(annotations) => ...} />` producing `AnnotationShape[]` + per-shape note.

- [ ] **Step 1: Failing test** (geometry is a pure function — unit-test it): `toNormalized({x:50,y:25}, {w:100,h:100})` → `{x:0.5,y:0.25}`; `toPixels` round-trips; clamps to [0,1].

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement geometry** (pure), then the canvas component: render `<img>` + absolutely-positioned `<canvas>` overlay sized to the rendered image; pointer events draw a rectangle (drag) or freehand path; store shapes in normalized coords via the geometry fns; a note input per shape; call `onChange` with the current annotations. Tools: rect + freehand only (v1). Reuse `Button`/tokens. `"use client"`.

- [ ] **Step 4: Run geometry test → PASS** (canvas exercised in live QA); tsc + biome clean.

- [ ] **Step 5: Commit** `feat: annotation canvas + normalized geometry`.

---

## Task 6: Wire the canvas into the user review flow

**Files:**
- Modify: `src/app/(dashboard)/design-request/[id]/review-actions.tsx`, `src/app/(dashboard)/design-request/[id]/page.tsx`
- Test: extend `review-actions` test if present (else a small render test)

- [ ] **Step 1: Failing/anchor test** — `ReviewActions` given a deliverable can open the canvas and, on Request Revision, includes the collected `annotations` in the POST body to `/api/design-tickets/[id]/review`.

- [ ] **Step 2 → 4:** Implement — add a "Mark up this design" affordance in the review area that mounts `<AnnotationCanvas>` over a chosen image deliverable; hold the annotations in state; on `revise`, send `{ action: "revise", note, annotations }`. Keep approve unchanged. tsc + biome clean.

- [ ] **Step 5: Commit** `feat: mark up a design and send annotations with a revision`.

---

## Task 7: Admin read-only annotation rendering

**Files:**
- Create: `src/components/design/annotation-overlay.tsx`
- Modify: `src/app/admin/tickets/[id]/page.tsx`
- Test: none beyond tsc (server render + overlay; visual in live QA)

- [ ] **Step 1: Implement** `AnnotationOverlay` (read-only: renders an image with shapes drawn from normalized coords via the Task-5 geometry, notes listed beneath). In the admin ticket detail, fetch `getAnnotationsForTicket(ticket.id)`; for each deliverable with annotations, render `<AnnotationOverlay>`. Group by `deliverableId`.

- [ ] **Step 2:** tsc + biome clean; **Commit** `feat: render review annotations on the admin ticket page`.

---

# PHASE 1-D — Revisions tab + in-app notify

## Task 8: In-app notify the design team on revise

**Files:**
- Modify: `src/app/api/design-tickets/[id]/review/route.ts`
- Test: extend `review/route.test.ts`

**Interfaces:**
- Consumes: `getStaffUsers()` (returns designer/admin users), `createNotification({ userId, type: "ticket_status", payload })`.

- [ ] **Step 1: Failing test** — on `revise`, a `ticket_status` notification is created for each staff user (mock `getStaffUsers` → 2 users → `createNotification` called twice); a `createNotification` failure does NOT fail the revise (still returns the updated ticket).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In the `revise` branch, best-effort: `const staff = await getStaffUsers(); await Promise.allSettled(staff.map((s) => createNotification({ userId: s.id, type: "ticket_status", payload: { ticketId: id, ticketNumber: ticket.ticketNumber, status: "revision_requested" } })));` wrapped in try/catch that logs. Keep the existing email.

- [ ] **Step 4: Run → PASS**; tsc + biome clean; **Commit** `feat: in-app notify the design team on a revision request`.

---

## Task 9: Admin "Needs revision" tab

**Files:**
- Modify: `src/app/admin/tickets/queue-client.tsx` (+ its page if server-fetch filtering is needed)
- Test: `src/app/admin/tickets/queue-client.test.tsx` (or extend existing)

- [ ] **Step 1: Failing test** — the queue renders status tabs; selecting "Needs revision" shows only `revision_requested` rows and a count badge reflecting their number.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a client-side tab filter over the already-loaded ticket rows (All / Needs revision at minimum; add In-progress/Ready if trivial), with a count badge on "Needs revision". If the page only loads a subset, add a server query for `revision_requested` — prefer client filter over the existing rows if they include status.

- [ ] **Step 4: Run → PASS**; tsc + biome clean; **Commit** `feat: admin needs-revision tab`.

**Phase checkpoints:** after 1-A, 1-B, 1-C, 1-D run `corepack pnpm exec tsc --noEmit && corepack pnpm exec biome check <changed> && corepack pnpm vitest run`.

## Verification (live QA)
Deliver a ticket (staff sets `delivered`… actually set to `ready_for_review`) → as the owner, **View** the image inline (confirm no file downloads; Download is gated) → **mark up** an image + note → **Request Revision** → status `revision_requested`, annotations persisted → admin **"Needs revision"** tab shows it, the annotated image + notes render on the admin detail, and an in-app **notification** exists for staff → **Approve** → Download + ZIP now work (attachment 200); pre-approval attachment returns 403. Gates: `tsc`, `biome check`, `vitest run` all clean.
