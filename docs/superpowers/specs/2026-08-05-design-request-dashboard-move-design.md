# Design Request: Nav Removal, Dashboard Card, Staging Upload Fix

Date: 2026-08-05
Branch: feat/design-request-update

## Goal

Move the design-request entry point out of the sidebar nav onto the dashboard
(per approved mockup), and fix file uploads failing on staging.

## Changes

### 1. Sidebar nav (`src/lib/nav.ts`)

Remove the "Design Tickets" (`/design-request`) entry from `MAIN_NAV`.
"Design Studio" stays. `/design-request` routes and their `PAGE_META` entries
remain — users reach the ticket list via dashboard links.

### 2. Dashboard (`src/app/(dashboard)/dashboard/page.tsx`)

- Add an always-visible "Upload a Design Request" action card to the existing
  card row, after "Request a Design". Copy: "Already have a design brief?
  Paste or upload it and send it directly to the creative team."
  Links to `/design-request/new`, amber tint, Upload icon.
- Existing conditional card logic is unchanged.
- The lower "Upload a Design Request" side panel is refocused as
  "Design Tickets": keeps the Open/Delivered stats and "View all" link
  (now the primary path to the ticket list), drops the upload CTA that
  moved into the card row.

### 3. Staging upload failure (infra, not code)

Root cause: the R2 bucket CORS `AllowedOrigins` lacks
`https://staging.kocontentstudios.com`. Preflight OPTIONS returns 403 there
(verified live), so the browser never sends the presigned PUT and the form
shows a bare "Upload failed". `*.vercel.app` and production origins pass.

Fix: `scripts/r2-cors.mjs` — applies the canonical CORS config (localhost,
`*.vercel.app`, app/staging/apex kocontentstudios.com) using R2 env vars,
mirroring the check-smtp.mjs diagnostic-script pattern. Run once now;
re-run whenever origins change.

## Out of scope

Any change to the upload flow code (presign API, uploader component) — the
flow is correct; only bucket config was missing an origin.
