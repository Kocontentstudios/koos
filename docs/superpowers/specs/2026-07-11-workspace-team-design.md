# Workspaces & Team — Design

**KO OS** · Design spec · 11 July 2026 · Status: approved design, pending implementation plan

Successor to [`2026-07-11-workspace-team-approaches.md`](./2026-07-11-workspace-team-approaches.md) (options paper). Decisions taken there and confirmed 11 July 2026:

- **Approach: D's UI on A's schema** — the prototype's exact Owner/Member surface, on a role-ready schema with a capability-table guard.
- **Per-Brand scoping: schema-ready, no UI** — the restriction table exists and the guard consults it; nothing writes to it in v1.
- **Member powers: content only** — create/edit Brands, strategies, calendars, design tickets; no inviting, no Settings, no deletions.
- **Defaults accepted:** 7-day invite expiry; one email per invite; personal Workspaces named "*FirstName*'s Workspace"; ownership transfer and per-seat billing out of v1 scope; deleting a Workspace deletes its Brands after typed confirmation.

The interactive prototype in `docs/ko-os-workspace-team/` is the UI contract (structure, not colors — the app's adaptive tokens apply). Platform roles (`user/designer/admin`) are an unrelated axis and stay untouched.

---

## 1. Data model

One migration, `drizzle/0010_workspaces.sql`, applied through the `scripts/migrate.mjs` ledger (staging first).

### New tables

**`workspaces`**

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `logo_url` | text | |
| `owner_id` | uuid → users | `on delete cascade` — deleting an account deletes its personal workspace |
| `created_at`, `updated_at` | timestamp | |

**`workspace_members`**

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid → workspaces | cascade |
| `user_id` | uuid → users | cascade |
| `role` | `workspace_role` enum | new pg enum: `owner \| member`. Extending later (admin, viewer) is `ALTER TYPE … ADD VALUE` — the role-ready schema |
| `created_at` | timestamp | |

Unique on `(workspace_id, user_id)`; index on `user_id` (switcher lookup).

**`workspace_invitations`**

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid → workspaces | cascade |
| `email` | citext not null | same case-insensitive type as `users.email`, so "already a member" joins can't be dodged by casing |
| `role` | `workspace_role` | default `member` (the invite modal has no role picker) |
| `token_hash` | text unique not null | SHA-256 of the emailed token — same never-store-the-secret pattern as `sessions` and `password_reset_tokens` |
| `invited_by_id` | uuid → users | `set null` |
| `expires_at` | timestamptz not null | created + 7 days |
| `accepted_at` | timestamp | null = pending |
| `created_at` | timestamp | |

Revoking an invite deletes the row. Resending rotates `token_hash` and resets `expires_at`.

**`member_brand_access`** — the schema-ready scoping table

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid → workspaces | cascade |
| `user_id` | uuid → users | cascade |
| `brand_id` | uuid → brands | cascade |

Unique on `(workspace_id, user_id, brand_id)`. **Created now, always empty in v1** — no UI writes to it. The guard is written from day one as: *a member with no rows sees all Brands; a member with rows sees only those Brands* (the default-open rule). The future restriction UI needs zero migration and zero guard change.

### Changes to `brands`

- Add `workspace_id` uuid → workspaces (`cascade`), backfilled then `set not null` in the same migration.
- `brands.user_id` is **kept permanently, reinterpreted as "created by"** (attribution). It is no longer read for any ownership or access decision. No column drop.

### Backfill (same migration, pure SQL)

1. Insert one workspace per existing user, named `first_name || '''s Workspace'`, `owner_id` = the user.
2. Insert an `owner` membership row per user for their personal workspace.
3. `UPDATE brands SET workspace_id = <owner's personal workspace>`, then `SET NOT NULL`.

### Active workspace selection

A new httpOnly cookie stores the active workspace id. It is a **pointer, not a credential**: every request validates membership and silently falls back to the user's first workspace (owner memberships first) when the cookie is missing, stale, or points to a workspace the user was removed from. Removal is therefore effective immediately — matching the prototype's "immediately loses access to all Workspace data."

## 2. Access enforcement

### Capability table (`src/lib/auth/workspace-roles.ts`)

| capability | owner | member |
|---|---|---|
| `manage_content` — create/edit Brands, strategies, calendars, chat, design tickets | ✓ | ✓ |
| `delete_content` — delete Brands | ✓ | — |
| `manage_team` — invite, resend, revoke, remove | ✓ | — |
| `manage_settings` — workspace name, logo | ✓ | — |
| `delete_workspace` | ✓ | — |

"No deletions" for Members means the **containers**: Brands (`delete_content`) and the Workspace (`delete_workspace`) are Owner-only. Deleting items *inside* a Brand a Member can already edit — a chat conversation, a draft calendar item — is routine content management and stays within `manage_content`.

Defined in code (not owner-configurable). The guard reads this table even while only two roles exist; adding a role later is a column here, not a route audit.

### Guard functions

- **`getActiveWorkspace()`** (`src/lib/auth/`) — companion to `getAuthUser()`: resolves the cookie to a validated membership row + workspace, with the fallback chain above. Page shells call it once, as `requireBrand()` does today.
- **`requireBrandAccess(userId, brandId, capability)`** (query layer, `src/lib/db/queries/`) — one query joining `brands → workspace_members`, plus the default-open check against `member_brand_access`. Returns the brand or throws a typed `ForbiddenError`. Fetch-and-authorize is one call, so no unauthorized brand object ever exists in scope.

### The guard refactor

The ~12 inline `brand.userId !== dbUser.id` checks in API routes (chat, strategy/generate, calendar/generate, design-brief/generate, design-tickets and its subroutes, jobs) are replaced by `requireBrandAccess`. After this refactor a route cannot reach a Brand without passing the guard, and the guard is unit-tested once instead of trusted twelve times. Brand-list queries (`getBrandsByUserId`, `getActiveBrandForUser`) get workspace-scoped equivalents (`getBrandsForWorkspace`, `getActiveBrandForWorkspace`) that also honor `member_brand_access`.

## 3. API surface

New routes under `/api/workspace`:

| route | capability | notes |
|---|---|---|
| `GET /api/workspace` | member | current workspace + caller's role |
| `PATCH /api/workspace` | `manage_settings` | name, logo |
| `DELETE /api/workspace` | `delete_workspace` | cascades to Brands; client requires typed-name confirmation; **rejected if it is the caller's only workspace** |
| `GET /api/workspace/members` | member | members + pending invitations |
| `DELETE /api/workspace/members/[userId]` | `manage_team` | Owner cannot remove self |
| `POST /api/workspace/invitations` | `manage_team` | validation: invalid format / already a Member / already invited (pending); rate-limited via existing `hitRateLimit` |
| `POST /api/workspace/invitations/[id]/resend` | `manage_team` | rotates token, resets expiry, re-sends email |
| `DELETE /api/workspace/invitations/[id]` | `manage_team` | revoke |
| `POST /api/workspace/switch` | member of target | sets the active-workspace cookie |

### Invitation acceptance — public page `/invite/[token]`

Hash the URL token, look up the invitation, check `expires_at` and `accepted_at`. Then:

- **Signed in with the invited email** → create membership, stamp `accepted_at`, switch the workspace cookie, redirect to dashboard. If a membership already exists (double-click, revoke-then-reinvite race), the unique `(workspace_id, user_id)` constraint makes acceptance idempotent — treat it as success and redirect.
- **Signed in as a different email** → prompt to switch accounts. The token is bound to the invited address; forwarding the link grants nothing.
- **Not signed in** → sign-in/sign-up with the email prefilled and this page as the return URL; membership attaches immediately after auth completes.

## 4. UI

All screens follow the prototype (`docs/ko-os-workspace-team/index.html`, `COMPONENTS.md`, `USER_FLOWS.md`).

- **Workspace Card + Switcher** — replaces the profile card in `src/components/layout/app-sidebar.tsx`: logo/initial, workspace name, caller's role badge. The menu lists all memberships (with roles), *Workspace Settings*, *Team*. Switching posts to `/api/workspace/switch` then performs a **full page reload** — the entire context changes, so client caches are reset rather than patched.
- **Team page** (`/team`, dashboard group) — tabs **All Members / Pending**; rows: avatar, name, email, role or Pending badge. Owner actions: *Invite Team* modal (email-only, three validation states), *Resend*, *Remove* (confirmation modal naming the member and consequences, toast on completion). **Members see the list read-only** — actions gated by capability in both UI and API (UI gate is UX; API gate is the enforcement).
- **Workspace Settings** (`/workspace/settings`, Owner-only; Members are redirected) — *Workspace Information* card (name, logo via existing `/api/upload`), auto-save on blur; *Danger Zone* card (delete workspace, typed-name confirmation, cascade warning with brand count).
- **Dashboard cards** — prototype's two states: *Invite Your Team* gradient card while the workspace has no other members; *Team Overview* card (member count, pending count, avatar stack) once it does.

**Deliberate deviation:** the prototype's Settings page shows a *Notifications* toggle card. Nothing workspace-scoped exists to toggle (notifications are per-user/per-ticket today), so **v1 omits that card** rather than shipping decorative toggles. It returns when workspace-level notifications exist.

## 5. Emails

Two templates in `src/lib/email-templates.ts` following the existing `BuiltEmail` pattern, sent via `sendMail`:

1. **`workspaceInviteEmail`** — "*{Inviter}* invited you to join *{Workspace}* on KO OS", accept link to `/invite/{token}`, expiry note. Sent on invite and resend.
2. **`memberJoinedEmail`** — to the Owner when an invitation is accepted.

## 6. Error handling

- Guard failures throw a typed `ForbiddenError` mapped to `403` with the app's stable `{ error }` shape — distinct from `404` (brand absent).
- A Member removed mid-session gets `403`s from APIs; on next navigation the cookie fallback lands them in their personal workspace. No crash, no stuck state.
- Invite validation returns field-level messages matching the prototype's three states.
- Expired/used invite links render a friendly page ("This invitation has expired — ask the Owner to resend it"), never a 500.
- Workspace deletion re-checks capability inside the delete transaction, so a concurrent ownership change cannot slip through.

## 7. Testing

Colocated `*.test.ts`, matching the existing `password-reset.test.ts` / `roles.test.ts` style:

1. **Capability table** — owner/member × every capability.
2. **`requireBrandAccess`** — owner; member; member *with* `member_brand_access` rows (proves the dormant scoping path actually restricts); non-member; cross-workspace brand; deleted membership.
3. **Invitation lifecycle** — token hash round-trip; expiry; single-use; resend rotates token; email binding rejects a differently-signed-in account.
4. **Route validation matrix** — three invite validation states; owner-cannot-remove-self; member hitting owner-only routes gets 403; delete-only-workspace rejected.
5. **Migration rehearsal** — staging first (own database): verify every brand has a `workspace_id` and every user has exactly one owner membership before production.

## 8. Rollout

On `feat/workspace` (off `dev`), guard-first, each stage leaving the app fully working:

1. **Migration** — tables + backfill (additive; invisible).
2. **Guard + route refactor** — every existing user is the sole owner-member of their personal workspace, so any behavior diff at this stage is a bug by definition.
3. **Invite flow + Team page.**
4. **Workspace Card/Switcher + Settings + dashboard cards.**

PRs flow `dev → staging → main`; the migration ledger applies staging-first automatically during builds.

## 9. Out of scope (v1)

- Ownership transfer; per-seat billing.
- Per-Brand restriction UI (schema and guard support ship dormant).
- Roles beyond Owner/Member (schema supports adding them).
- Workspace-level notification settings (the prototype's toggle card).
- Postgres RLS (Approach B) — additive later if hardening is warranted.

---

*Prototype reference: `docs/ko-os-workspace-team/`. Options paper: `2026-07-11-workspace-team-approaches.md`.*
