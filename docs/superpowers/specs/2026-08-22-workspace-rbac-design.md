# Workspace Role-Based Access — Design

**KO OS** · Design spec · 22 August 2026 · Status: implemented on `feat/workspace-access`

Successor to [`2026-07-11-workspace-team-design.md`](./2026-07-11-workspace-team-design.md), which shipped Workspaces & Team with two roles (`owner | member`) and a deliberately dormant per-brand scoping table. Source of the role set: `docs/local/KO OS Role-Based Access Roles.docx`.

Platform roles (`user/designer/admin` in `src/lib/auth/roles.ts`) remain a separate, untouched axis. The `admin` in each enum is a different thing.

---

## 1. What the source document specified, and what it left open

The document defines four roles — Workspace Owner, Workspace Admin, Brand Manager, Contributor — with a purpose and a can/cannot list each. Vetting it against the code surfaced four gaps, resolved before building:

| Gap | Resolution |
|---|---|
| "Brand Manager cannot access unassigned brands" was unimplementable: `evaluateBrandAccess` treated an **empty** assignment list as "sees every brand", so a brand manager with no assignments saw everything, and removing their last assignment silently promoted them | Replaced the default-open rule with an explicit `brand_scope` column (§3) |
| Billing appears in three of the four role rows; the product has **no billing code at all** | `view_billing` / `manage_billing` defined and granted to Owner only, with no surface |
| "Cannot delete brands" had nothing to enforce: `delete_content` had zero call sites, and no brand-delete route exists | `delete_content` retired; `create_brand` / `delete_brand` introduced |
| The document is silent on who creates brands, who signs off on deliverables, and whether ownership transfer exists | Decided explicitly (§2); transfer stays out of scope |

## 2. The capability model

`src/lib/auth/workspace-access.ts`. Roles are declared in **descending privilege** — Postgres orders an enum by declaration order and both member listings sort on that column, so the ordering is load-bearing, not cosmetic.

| capability | owner | admin | brand_manager | contributor |
|---|:--:|:--:|:--:|:--:|
| `manage_content` | ✓ | ✓ | ✓ | ✓ |
| `create_brand` | ✓ | ✓ | — | — |
| `delete_brand` | ✓ | ✓ | — | — |
| `approve_deliverables` | ✓ | ✓ | ✓ | — |
| `manage_team` | ✓ | ✓ | — | — |
| `invite_contributor` | ✓ | ✓ | ✓ | — |
| `manage_brand_access` | ✓ | ✓ | — | — |
| `manage_settings` | ✓ | ✓ | — | — |
| `delete_workspace` | ✓ | — | — | — |
| `transfer_ownership`, `view_billing`, `manage_billing` *(no surface yet)* | ✓ | — | — | — |

A test asserts the full 4 × 12 grid plus a **monotonicity invariant**: every role holds a superset of the role below it. A grant that breaks the ladder fails the build.

## 3. Brand scope — the security core

`workspace_members.brand_scope` is `'all' | 'assigned'`. Under `assigned`, `member_brand_access` is consulted and **an empty list means no brands**. This inverts the retired v1 rule and closes a privilege-escalation-by-deletion hole: previously, deleting a member's last assignment row granted them the entire workspace.

Scope is a function of role, not a free choice (`resolveBrandScope`), and the database carries the same rule as CHECK constraints so an impossible membership cannot be persisted:

```sql
CHECK (role NOT IN ('owner','admin') OR brand_scope = 'all')
CHECK (role <> 'brand_manager'       OR brand_scope = 'assigned')
```

The decision function is pure and total:

```
no membership                                  -> 404   (never leak existence)
capability not held                            -> 403
scope 'assigned' and brand not assigned        -> 404
otherwise                                      -> ok
```

## 4. Escalation invariants

Enforced server-side by pure, exhaustively tested functions (`evaluateRoleChange`, `evaluateMemberRemoval`, `evaluateInvite`), with the Team UI mirroring them so it never offers an action the API would refuse:

1. **No acting on peers or superiors.** You may only act on a member of strictly lower privilege. Admins manage brand managers and contributors, never each other.
2. **No lateral or upward grants.** You may only grant a role strictly below your own — nobody can mint a peer.
3. **Ownership is unreachable.** It can never be granted, and the workspace owner's membership can never be changed or removed. There is no transfer flow, so there is no legitimate path.
4. **No self-service.** Nobody changes their own membership through the team API.
5. **A scoped inviter cannot widen access.** A brand manager may invite only contributors, only to brands they hold, and — critically — may never produce a workspace-wide member, which would hand out brands the inviter cannot themselves reach.
6. **Scope follows role.** Promotion to admin forces `all` and clears stale assignment rows; demotion to brand manager forces `assigned` and requires at least one brand. Role and scope are written in one statement, because a CHECK binds them.

Brand ids from a request are narrowed to the workspace **before** the permission check, so a forged or foreign id drops out rather than becoming an assignment.

## 5. Migration — `drizzle/0019_workspace_roles.sql`

`scripts/migrate.mjs` wraps every migration file in one transaction. Postgres refuses to *use* a value added by `ALTER TYPE … ADD VALUE` in the transaction that added it, so the obvious "add three enum values" migration fails the build. The transaction-safe recipe is a **type swap** — a freshly `CREATE TYPE`d enum *is* usable in the transaction that created it:

```sql
CREATE TYPE workspace_role_v2 AS ENUM ('owner','admin','brand_manager','contributor');
ALTER TABLE workspace_members ALTER COLUMN role TYPE workspace_role_v2
  USING (CASE role::text WHEN 'member' THEN 'contributor' ELSE role::text END)::workspace_role_v2;
DROP TYPE workspace_role;
ALTER TYPE workspace_role_v2 RENAME TO workspace_role;
```

**Mapping:** `member → contributor`, `brand_scope = 'all'`. Lossless in capability terms — `member` held exactly `manage_content`, which `contributor` also holds, and `all` preserves every existing user's visibility.

Two further constraints the migration carries: `member_brand_access` gains a composite foreign key to `workspace_members(workspace_id, user_id)` with `ON DELETE CASCADE`, so "grants die with the membership" is structural rather than something every delete path must remember; and constraint names are kept under Postgres' 63-byte identifier limit, which silently truncates longer ones and then makes them undroppable by the name written in the migration.

### Deploy sequencing — this migration needs a two-phase rollout

Migrations run at **build** time, before the new deployment is promoted, so the currently-deployed code serves against the new schema for the length of the build.

The *write* side is safe: old code never writes the literal `'member'` (it writes `'owner'`, or a role read back from the database, or relies on the column default). **The read side is not.** Migration 0019 rewrites every `member` row to `contributor`, and the deployed `can()` is:

```js
return GRANTS[role].has(capability);   // GRANTS = { owner, member }
```

`GRANTS['contributor']` is `undefined`, so this throws a `TypeError`. It is reached from `guardWorkspaceRoute` and from `checkBrandAccess`, i.e. essentially every authenticated request. Verified by executing the deployed function directly: `owner` returns normally, `contributor` / `admin` / `brand_manager` all throw. Owners are unaffected; **every non-owner member would 500 for the whole build window**, and permanently if the deploy were rolled back.

**Therefore this branch must not be the first thing deployed.** Ship the one-line compatibility shim below to production first, let it promote, then merge this branch:

```diff
 export function can(role: WorkspaceRole, capability: Capability): boolean {
-  return GRANTS[role].has(capability);
+  const grants = GRANTS[role] ?? GRANTS.member;
+  return grants.has(capability);
 }
```

Unknown roles degrade to the least-privileged known role rather than throwing, so during the window a migrated member behaves exactly as they did before. (`isWorkspaceRole` needs no change — at HEAD it is referenced only from tests.)

Rehearsed end to end on a throwaway Postgres 16 before merge: the full 0000–0019 chain applies in the runner's single transaction, the data maps as specified, all six adversarial CHECK probes behave correctly, and the composite FK rejects an orphan grant and cascades grants away with the membership.

## 6. Pre-existing holes closed in the same change

The role work made each of these worse, since a role that lacks a capability still slips through an unguarded path.

1. **`markStrategyActive`** (`src/app/(dashboard)/strategy/actions.ts`) had **no authorization whatsoever** — no session check, no ownership check. Server actions are reachable POST endpoints, so any caller could flip any strategy id to active. Now authorizes exactly like its sibling `loadStrategy`. Its regression tests fail against the old code.
2. **`DELETE /api/design-tickets/[id]`** authorized on row ownership alone, routing around the capability model. Owning a row is not enough once you have been removed from the workspace or narrowed out of the brand.
3. **`workspace-card.tsx`** gated Workspace Settings on `role === "owner"`, which silently locked admins out of settings they are entitled to.
4. **`/api/upload` and `/api/brand/suggest`** were session-only — an object-storage write and a model-token spend with no workspace scope.

Also corrected: a comment in `brand/actions.ts` asserting the edit path was "safe without checkBrandAccess … every role holds manage_content". That assumption is exactly what this feature dismantles; the write is now authorized explicitly.

## 7. Empty states

`requireBrand()` previously redirected any brandless user to `/brand/create`. A contributor invited before any brand is assigned to them would be bounced to a page they are now forbidden from, with no way out. The redirect branches on `create_brand`; everyone else lands on `/no-brands`, which explains the situation and does **not** call `requireBrand()` (that would loop).

## 8. Testing

Gate lane only — RBAC is entirely deterministic (same role, same capability, same answer, no model in the loop), so per the latent/deterministic split in CLAUDE.md the right artifact is an exhaustive matrix, not an LLM eval. No eval suite was added and `pnpm eval:design` is untouched.

- Full 4 × 12 capability grid, plus role-ordering and privilege-monotonicity invariants.
- `evaluateBrandAccess`: the empty-assignment case (the escalation regression) is the single most important test in the change.
- Exhaustive actor × target × next-role matrix for role changes, plus removal authority.
- Invitation rules: role and brands survive a resend; a brand manager cannot invite an admin, cannot share a brand they don't hold, and cannot produce a workspace-wide member.
- Route matrices for the new PATCH and the changed DELETE.
- One regression test per hole in §6. The `markStrategyActive` tests were confirmed to fail against the buggy code and pass against the fix.

## 9. Out of scope

Ownership transfer; billing surfaces; per-brand *role* differences (a brand manager holds the same capabilities on every brand they are assigned); Postgres RLS.
