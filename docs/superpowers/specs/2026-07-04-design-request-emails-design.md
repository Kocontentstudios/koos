# Design Request — Email Delivery (team notify, confirmation, final delivery)

**Date:** 2026-07-04
**Feature:** 2 of 3 (strategy / design-request-emails / admin)
**Status:** Approved design, pending implementation plan

## Problem

Today, submitting a design request writes a `design_tickets` row and nothing
else. **No email is ever sent.** A `sendMail` helper exists (`src/lib/email.ts`,
nodemailer + Zoho SMTP) but is **never called anywhere** in the codebase. The
modal's "your request has been sent to the KO design team" copy is not backed by
any delivery. Reference-image upload in the modal is a non-functional
placeholder (out of scope here).

We also want the requester to optionally route the finished design + updates to
an email different from their account email.

## Goals

1. Add an optional delivery/contact email to the design request.
2. Actually send email on submission (team + requester) and on delivery.
3. Ensure the request "is being sent, to the right email, with all the data
   required for proper delivery."

## Design

### Schema

- Add `deliveryEmail text` (nullable) to `design_tickets` (`schema.ts:265`) +
  a drizzle migration (`db:generate`).
- The design-team notification address comes from the Feature 3 `app_settings`
  value, with an **env fallback** (e.g. `DESIGN_TEAM_EMAIL`) so this feature
  ships independently of Feature 3.

### Modal (`request-design-modal.tsx`)

- Add optional field **"Receive updates & final design at"**.
  - Placeholder = the account email; helper: "*Leave blank to use your account
    email.*"
  - Validate email format only if provided.
  - Framing (per decision): this single field receives both progress updates and
    the final design — labeled as "receive updates & final design," not "send
    final design to."
- Include `deliveryEmail` in the POST body.

### On submit (`POST /api/design-tickets`)

1. Persist `deliveryEmail` via `createDesignTicket` (extend the insert in
   `queries/index.ts:336`).
2. Send **team notification** to the configured team address containing all
   request data: ticket number (`DT-#####`), requester name + account email,
   delivery email, brand, design type, dimensions, slides, brief, notes, due
   date, and a link to the admin ticket detail page.
3. Send **requester confirmation** to `deliveryEmail || accountEmail`
   summarizing the request + ticket number + "we'll update you here."
4. Email sends are wrapped in try/catch and logged; **a mail failure must not
   fail ticket creation** (still return `{ ticket }`). Log enough to confirm
   what was sent and to which address.

### On delivery (`api/admin/tickets/[id]/deliverables/route.ts`)

- Keep the existing `design_ready` notification to the owner.
- Additionally email the finished design (deliverable file links) to
  `deliveryEmail || ownerAccountEmail`. Same non-blocking try/catch pattern.

### Email templates

- Add small HTML template builders next to `src/lib/email.ts` (e.g.
  `src/lib/email/templates.ts`): `designRequestTeamEmail`,
  `designRequestConfirmationEmail`, `designDeliveryEmail`. Plain, brand-light
  HTML + text fallback.

## Error handling / edge cases

- Invalid delivery email in the modal → inline validation, block submit.
- Empty delivery email → fall back to account email everywhere.
- SMTP not configured (missing env) → `sendMail` throws; caught + logged; ticket
  flow still succeeds. Surface a clear server log line.

## Testing / verification

- Submit a request with and without a delivery email; confirm the ticket row has
  the right `deliveryEmail` and that team + confirmation emails are attempted to
  the correct addresses with all fields present (verify via logs / a test SMTP
  inbox).
- Upload deliverables; confirm the delivery email goes to the delivery address
  (or account email fallback) and the `design_ready` notification still fires.
- Ticket creation still succeeds when SMTP is misconfigured.

## Out of scope

- Reference-image upload wiring in the modal.
- Rich/branded email design system (keep templates simple).
- SMTP credential management UI (credentials stay in env — see Feature 3).
