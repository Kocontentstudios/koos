# Design Request Workflow Update — Design

**Date:** 2026-08-05
**Status:** Approved
**Branch:** feat/design-request-system

## Goal

Let clients submit a complete design request on a single page — request type, project info, brief, file uploads, references, specs — without going through the AI chat, mirroring the old agency workflow (client sends brief + assets, team executes, conversation and status updates happen on the platform).

## Approach

Extend the existing `design_tickets` infrastructure rather than building a parallel system. The new form writes through the existing creation path, so the admin queue, designer transitions, review flow, emails, and analytics keep working untouched.

## 1. Data model (migration `0016`, hand-written SQL)

- Add `'draft'` to the `design_ticket_status` enum.
- `design_tickets` gains:
  - `title text` — project title.
  - `specs jsonb` — nullable structured display data: `{ platform, dimensions, orientation, fileFormat, deliverablesCount }`.
- New table `design_ticket_attachments`:
  - `id uuid PK`, `ticket_id uuid` FK → design_tickets (cascade), `kind text` (`file` | `link`), `category text` (`asset` | `reference`), `file_key text` (R2 object key, files only), `file_name text`, `mime_type text`, `size_bytes integer`, `url text` (pasted Drive/Dropbox/Figma links only), `note text` ("what do you like about these references?"), `created_at timestamp`.
- Request type stores into the existing free-text `design_type` column. `DESIGN_TYPE_OPTIONS` in `src/lib/design/tickets-ui.ts` is replaced with the spec's 16 options (Social Media Post, Carousel, Flyer, Poster, Banner, Presentation, Logo, Brand Identity, Business Card, Packaging, Video Thumbnail, Video Editing, Motion Graphics, UI/UX Design, Website Design, Custom Request). Chat mode and calendar modal pick up the new list automatically.
- `priority` becomes requester-settable at creation (column exists; post-creation changes remain admin-only).

## 2. Status model

Keep the 6 existing DB statuses plus `draft`. Display labels in `tickets-ui.ts`:

| DB value | Display |
|---|---|
| draft | Draft |
| submitted | Submitted |
| assigned | Assigned |
| in_progress | In Progress |
| ready_for_review | Client Review |
| revision_requested | Revision Requested |
| delivered | Completed |

The spec's "Under Review" and "Approved" are absorbed into Submitted and Completed respectively (accepted trade-off). Drafts are excluded from the admin queue and open-ticket counts.

## 3. File uploads (presigned R2)

- New `POST /api/uploads/presign`: auth + brand access → validates extension/MIME allowlist (images, PDF, DOCX, video, ZIP) and size (**100 MB per file, 10 files per request**) → returns presigned PUT URL + object key under the `reference-images/` prefix, namespaced per user.
- Browser PUTs directly to R2 (bypasses Vercel's ~4.5 MB body cap), then submits only object keys with the form. The server verifies each key sits under the caller's own namespace before persisting.
- Attachments are read via the existing signed-GET helper on user and admin detail pages.
- Abandoned uploads from unsubmitted forms may orphan R2 objects; cleanup job explicitly out of scope.

## 4. API

- `POST /api/design-tickets` extended: `title`, `priority`, `specs`, `attachments[]` (files + links), `saveAsDraft` flag. Drafts relax validation (title or brief required), skip emails/usage events, get status `draft`.
- New `PATCH /api/design-tickets/[id]`: owner-only, draft-only — update fields, or flip draft → submitted (fires normal email/analytics path on submit). `DELETE` discards a draft.
- Admin ticket detail renders title, specs, attachments.

## 5. UI

- **New page `/design-request/new`** — single-page form per the product spec: request type dropdown, project info (title, brand, due date, priority), design brief (Improve with AI + Save Draft), uploads dropzone + link paste, design references with notes, optional specs. Zod schema shared client/server. localStorage autosave as crash-safety net on top of DB drafts.
- **Improve with AI:** new `POST /api/design-tickets/improve-brief` — synchronous, rate-limited, rewrites the brief in place using form context (request type, brand, specs). Follows the brand-suggest pattern; `maxOutputTokens` set explicitly.
- **Success screen:** `KO-<n>` request ID, status badge, priority-based ETA, "View Request" and "Return to Design Requests" buttons.
- **Dashboard card:** title "Upload a Design Request", description per product spec, CTA "Upload Request" → `/design-request/new`.
- **`/design-request` list:** "New Request" CTA → `/design-request/new`; drafts shown with a Draft badge and open back into the form. Chat mode, calendar modal, and quick form remain as secondary entry points.

## 6. ETA copy (priority-based)

| Priority | Copy |
|---|---|
| urgent | within 4 business hours |
| high | within 12 hours |
| normal | within 24 hours |
| low | within 48 hours |

## 7. Testing

Unit tests for the shared zod schema, draft-transition rules, presign validation (type/size/key ownership), and status label mapping, following existing repo test patterns.

## Out of scope

- R2 orphan cleanup job.
- Two-way requester comments on `ticket_updates`.
- Retiring the calendar modal or chat design mode.
