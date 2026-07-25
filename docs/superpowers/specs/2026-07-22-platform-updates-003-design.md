# Platform Updates 003 — Design

Date: 2026-07-22

Three independent tracks. They share no code and should be built and verified
separately, in the order given.

- **A — Design requests without a completed brand**
- **B — Calendar generation speed**
- **C — Admin brand view and export**

---

## A — Design requests without a completed brand

### Problem

`requireBrand()` (`src/lib/auth/require-brand.ts:10`) redirects to
`/brand/create` whenever `onboardingStatus !== "completed"`. Every page in the
`(dashboard)` group calls it individually — the group layout does not. A user
who has not finished the brand form therefore never sees a dashboard, so there
is nowhere to put a "request a design" button for them.

Separately, `dashboard/page.tsx:226` gates the existing "Request a Design"
action card behind `setupComplete`, which requires both a strategy and a
calendar. A user with a *fully completed* brand still sees no design-request
entry point until they have generated a calendar.

`design_tickets.brandId` is `NOT NULL` (`schema.ts:377`), and no brand row
exists at all until the form is fully submitted — `saveBrandProfile`
(`brand/actions.ts:60`) writes `onboardingStatus: "completed"` on the first
insert. There is no draft row today.

### Approach

Keep the hard redirect. Add entry points that reach a standalone quick-request
page, and give that page a brand row to attach the ticket to.

**Entry points**

| Location | Change |
| --- | --- |
| Dashboard | Remove the `setupComplete` gate on the "Request a Design" action card |
| `/brand/create` | Add a "Just need one design right now?" card in the form footer |

`/design-request` keeps its existing "New Request" link to the design-mode
chat. Anyone who can reach that page already has a completed brand, so the
chat has the context it needs and is the better flow for them.

**Quick-request page** — `src/app/(dashboard)/design-request/quick/page.tsx`,
guarded by `getActiveWorkspace()` only, never `requireBrand`.

Form fields: business name (prefilled from an existing brand row if present),
design type, slides (carousel only), dimensions, description, optional
reference image via the existing `/api/upload`, delivery email (prefilled from
the user), optional due date.

**Submission flow**

1. A server action returns the existing brand id, or inserts a minimal row with
   `onboardingStatus: "draft"` and `completionPercentage: 0`.
2. `POST /api/design-brief/generate` with `{ brandId, conversation }` and no
   `conversationId`.
3. Poll via the existing `src/lib/generation/poll-job.ts` helper.
4. Show the returned brief in the existing Design Brief Card for review and
   editing.
5. `POST /api/design-tickets` — emails and the admin queue already work.

### Why this needs no backend changes

`POST /api/design-brief/generate` already accepts a bare `conversation: string`
with `conversationId` optional, and `generateDesignBriefWork`
(`run-generation.ts:563`) only persists a `design_briefs` row when a
conversation id is present. A synthesized conversation string reuses that
endpoint, the job runner, and the polling client unchanged.

`checkBrandAccess` (`queries/workspaces.ts:112`) authorizes on workspace
membership and capability only — onboarding status is irrelevant — so a draft
brand satisfies `POST /api/design-tickets` as-is.

`requireBrand` still gates the dashboard on `=== "completed"`, so a draft row
cannot accidentally unlock it. `saveBrandProfile` already takes its `existing`
branch and upgrades the same row in place when the user finishes the form
later, carrying their brand name over as a prefill.

### Error handling

If the AI polish call fails, submit the raw form description as the brief. The
premise of the feature is "one design, no setup"; blocking it on a model call
that can return `AI_NoObjectGeneratedError` defeats that. The designer receives
a rougher brief rather than nothing.

### Components

- `src/lib/design/quick-request.ts` — `quickRequestSchema` and
  `buildQuickRequestConversation(input)`. Pure; unit-testable with no DB or
  model.
- `src/app/(dashboard)/design-request/quick/page.tsx` — server page, workspace
  guard only.
- `src/app/(dashboard)/design-request/quick/quick-request-form.tsx` — client
  form and submission flow.
- Server action for draft-brand resolution.

---

## B — Calendar generation speed

### Problem

**Every pause costs 75 seconds of dead air.** When a slice hits
`CALENDAR_SLICE_BUDGET_MS` it throws `JobPausedError`, calls `persist()` —
which stamps `updatedAt = now` (`queries/index.ts:791`) — and exits. Nothing
relaunches it. The job resumes only when a poll observes more than
`CALENDAR_STALE_MS` (75s, `stale.ts:15`) of silence. The worker stops
deliberately and announces it, then the system waits out a death-detection
window before continuing. The resume machinery was built for Vercel's
unexpected 300s kill and is being used for a planned handoff.

**Pauses are the norm at 90 days.** The outline caps at 90 days
(`prompts/calendar.ts`, `dayOffset` 0–89). At ~4–5 posts/week that is ~55–65
slots, ~15 units of 4 slots, 3–4 waves at concurrency 5, plus a 16k-token
outline call. That reliably exceeds the 240s slice budget, so nearly every
90-day generation pauses at least once and pays the 75s gap.

**Nothing is visible until 100% complete.** `createCalendar` and
`insertCalendarItems` run only after every unit finishes
(`run-generation.ts:462`). The outline already holds every date, platform,
time, title and design flag and is ready in roughly 40 seconds, but it is
buried in a checkpoint while the user watches a progress bar for minutes.

### Scope

B1 and B2 only. A faster model tier for brief-writing and a work-proportional
resume budget were considered and deferred — both are tuning decisions best
made against production logs, and B2 removes most of their urgency.

### B1 — Chain the next slice immediately

On `JobPausedError`, schedule the continuation directly via `after()` rather
than exiting silently and waiting to look stale. Stale detection remains
untouched as the safety net for genuine worker deaths.

This removes 75s × (number of pauses) of dead time. It does not change the
amount of model work.

### B2 — Write the calendar from the outline

Once the outline call returns, create the calendar and its items immediately
with placeholder briefs. Each brief-writing unit then updates its own slots'
briefs as it lands.

Time-to-usable-calendar drops from roughly five minutes to roughly forty
seconds. The calendar stops being all-or-nothing: a job that ultimately fails
still leaves the user a real schedule rather than nothing.

Requires a brief-pending state in the calendar UI so an item whose brief has
not yet arrived reads as in-progress rather than broken or empty.

Assembly logic is unchanged: `assembleCalendarItems` already treats outline
slots as authoritative and chunk briefs as the only thing a chunk contributes,
with `fallbackBrief` covering gaps.

### Interaction with resume

B2 changes what the checkpoint is for. Completed briefs become durable in the
calendar items themselves rather than only in the job's jsonb checkpoint, so a
resumed slice can determine remaining work from the calendar rows. The
checkpoint remains the source of truth for the outline.

---

## C — Admin brand view and export

### Problem

Admins can see users, tickets and settings, but not brands. `brand_assets`
(`schema.ts:283`) is defined but nothing in `src/` reads or writes it — the
only file a user ever uploads is a logo, from `brand/create/step-visual.tsx`
and workspace settings.

### Scope

Surface what already exists. No new upload feature; `brand_assets` stays
unused.

### Pages

Add a **Brands** nav item alongside Users in `admin/layout.tsx:31`, admin-only.

- `/admin/brands` — table of every brand: name, workspace, owner email,
  draft/completed, completion percentage, ticket count, created date.
  Searchable by name and owner email.
- `/admin/brands/[id]` — full read-only profile grouped by the same seven
  sections as the create form. Logo preview, colors as swatches, platforms as
  chips. Print-optimized layout.

Both guarded by `requireRole(["admin"])`, with a matching check in each API
route.

### Downloads

- `GET /api/admin/brands/[id]/logo` — streams the file with
  `Content-Disposition: attachment`. Required because `logoUrl` points at
  external storage, where a plain `download` attribute is ignored
  cross-origin.
- `GET /api/admin/brands/[id]/export` — JSON attachment of the full profile.

For a PDF, the detail page carries print styles and admins use the browser's
print-to-PDF. This adds no dependency, no bundle weight, and no serverless
memory pressure; JSON already covers machine use.

### Components

- `src/lib/admin/brand-export.ts` — `toBrandExport(brand)`. Pure;
  unit-testable.
- `listBrandsForAdmin()` and `getBrandForAdmin(id)` in `src/lib/db/queries/`.
- `src/app/admin/brands/page.tsx` and `brands-table.tsx`.
- `src/app/admin/brands/[id]/page.tsx`.
- The two API routes above.

---

## Testing

Each track's pure module carries the unit tests — `quick-request.ts`,
`brand-export.ts` — following the existing pattern of colocated `.test.ts`
files beside pure logic.

For B, `calendar-assembly.test.ts` and `stale.test.ts` already cover assembly
and stale policy. B1 needs coverage that a pause schedules a continuation
rather than relying on stale detection. B2 needs coverage that outline-derived
items are written before briefs exist, and that a unit's completion updates
only its own slots.

Route-level behavior is verified through the existing job-polling and
ticket-creation tests.

## Out of scope

- Brand asset uploads beyond the logo; `brand_assets` remains unused.
- Server-side PDF generation.
- A faster model tier for brief-writing (deferred pending production logs).
- Work-proportional resume budgets (deferred; `MAX_RESUMES` stays at 3).
- Relaxing `requireBrand` to admit incomplete brands to the dashboard.
