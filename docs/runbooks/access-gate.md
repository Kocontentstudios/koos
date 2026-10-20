# Access gate runbook

The interim paywall until a payment provider is integrated (Paystack is the
chosen rail; see the gitignored `docs/payments/payment-provider-assessment.md`).
Every new workspace is unusable until an admin approves it, after the client's
onboarding call and payment.

## What a new client sees

Sign up, then `/access`: what KO OS offers, a **Book a call** button
(cal.com), and a note that booking alone does not unlock the account. Every
other app page redirects there, and every API route that touches workspace
data or spends AI credit answers `403` with
`{"code": "workspace_pending"}`. Sign out stays available.

Staff accounts (`users.role` `designer` or `admin`) are never gated.

## Approving a client

1. Admin (not designer) opens **Admin → Access** (`/admin/workspaces`).
2. Pending workspaces are listed first, with owner name, email and signup date.
3. **Approve**. The whole workspace opens for everyone in it, and the owner is
   emailed "Your KO OS workspace is ready".
4. If the toast says the email did not send, tell the client directly. The
   approval itself has already been saved.

**Revoke** sends the workspace back to the gate after a confirmation. Its
brands and content are kept, and approving it again restores everything.

Every decision records who made it and when (`workspaces.access_decided_by`,
`access_decided_at`). Workspaces that existed before the gate shipped show
"Approved before the gate".

## Revoking mid-session

A revoked workspace loses access on its next request: every dashboard page
checks the gate itself (not only the layout, which Next does not re-run on
client navigation), and a calendar job still generating is failed at its next
resume rather than allowed to keep spending.

## Deploy window

Migrations run at the start of the build, while the previous deployment is
still serving. A workspace created in those few minutes is stored as pending
but stays usable until the new code goes live, then lands on the gate. If the
build fails after migrating, that lasts until the next successful deploy.
Approve any such workspace from the Access page; nothing else is affected.

## Teammates

The gate is per workspace, not per person. Someone invited into an approved
client workspace works there normally. Their own personal workspace stays
pending, and they only see `/access` if they switch into it; the page then
offers a button back to every approved workspace they belong to.

## Changing the booking link

`BOOK_CALL_URL` in `src/lib/auth/workspace-approval.ts`. It is a code change
and a deploy.

## Adding a route or server action

`src/lib/auth/access-gate-coverage.test.ts` fails the build until every new
API route and dashboard server action reaches one of `checkBrandAccess`,
`guardWorkspaceRoute`, `requireOpenWorkspace`, `isActiveWorkspaceOpen` or
`requireBrand`. If a route really must stay open to pending accounts, add it to
the allow-list there with the reason.

## How it is enforced

| Layer | Where | What it checks |
| --- | --- | --- |
| Pages | `src/app/(dashboard)/layout.tsx` via `requireOpenWorkspace` | the active workspace |
| Brand-scoped routes and actions | `checkBrandAccess` in `src/lib/db/queries/workspaces.ts` | the brand's **own** workspace |
| Workspace routes | `guardWorkspaceRoute` in `src/lib/auth/workspace-guard.ts` | the active workspace |
| Brand creation actions | `isActiveWorkspaceOpen` | the active workspace |

One definition decides all of them: `isWorkspaceOpen` in
`src/lib/auth/workspace-approval.ts`. It fails closed for any role it does not
recognise.

## Measuring it

Funnel 3 in `docs/analytics.md`: `signed_up` → `access_book_call_clicked` →
`workspace_access_changed` (approved).

## Retiring it when payments land

The payment webhook sets `access_status = 'approved'` instead of an admin.
Keep the column and the guards; replace the `/access` page's booking panel
with checkout.
