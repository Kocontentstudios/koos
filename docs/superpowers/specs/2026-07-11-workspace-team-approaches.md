<title>KO OS — Workspaces & Team: Implementation Approaches</title>

# Workspaces & Team — Implementation Approaches

**KO OS** · Options paper for deliberation · 11 July 2026 · Status: awaiting decision

---

## 1. Background — where the product is today

Every Brand in KO OS is owned by exactly one user account. The entire content tree — brand profile, strategies, calendars, chat conversations, design tickets, generation jobs — hangs off the Brand, and access is decided by a single question: *does this Brand belong to the signed-in user?*

That model has no concept of a team. The goal of this feature is: **the person who created the account (the Owner) can invite teammates or staff to manage the Workspace with them** — without giving away the account password, and without losing control.

A second, platform-level role system already exists (`user / designer / admin`) for KO OS staff. That axis is unrelated to this feature and stays untouched: platform roles say what you can do *on KO OS*; Workspace roles say what you can do *inside one customer's Workspace*.

## 2. The UI contract — what the prototype defines

The interactive prototype in `docs/ko-os-workspace-team/` fixes the product vocabulary and the v1 surface. All approaches below are described in its language.

| Concept | What the prototype shows |
|---|---|
| **Workspace** | The unit a team joins. Brands live inside a Workspace. |
| **Workspace Card** | Replaces the profile card in the sidebar: avatar, Workspace name, your role. |
| **Workspace Switcher** | One person can belong to several Workspaces with different roles (Owner of "KO Content Studio", Member of "CropCura" and "Growcle"). Switching reloads the whole context. |
| **Roles** | Two visible: **Owner** and **Member**. The invite form has no role picker — an invitee becomes a Member. |
| **Team page** | All Members / Pending tabs; rows show avatar, name, email, status badge; actions are Remove and Resend. |
| **Invite flow** | Email-only invite → validation (invalid format / already invited / already a Member) → Pending → email link → sign in or create account → Workspace auto-attached. |
| **Remove flow** | Confirmation modal; the removed Member "immediately loses access to all Workspace data." |
| **Workspace Settings** | Name, logo, notification toggles, Danger Zone (delete Workspace). |
| **Access scope** | Workspace-wide. A Member sees every Brand in the Workspace; there is no per-Brand picker anywhere. |

## 3. Decisions already taken

1. **Workspaces own Brands.** Membership is at the Workspace level, with per-Brand scoping available as a concept (see open question Q2).
2. **Fixed roles**, defined in code — not owner-configurable permission matrices.
3. **Every user gets a Workspace.** Migration creates a personal Workspace per existing user and moves their Brands into it. One ownership model everywhere; solo users never notice.
4. **Default-open scope.** Joining a Workspace grants access to all its Brands; restriction is the exception, not the setup chore.

These hold across all four approaches. The approaches differ on **where access is enforced and how much of the model ships in v1**.

---

## 4. Approach A — Workspace membership enforced in the app

*The conventional SaaS foundation: membership tables + one guard function.*

**How it works.** Three new tables: **Workspaces** (name, logo, owner reference), **Workspace Members** (workspace + user + role, one row per membership, unique per pair), and **Workspace Invitations** (email, role, hashed single-use token, expiry — the same never-store-the-secret pattern as sessions and password-reset tokens). Brands point to a Workspace instead of a user (keeping a "created by" reference for attribution). Optionally a fourth table, **Member Brand Access**, lists specific Brands a restricted Member may touch; no rows means all Brands (the default-open rule).

Every API route answers one question before doing anything: *may this user perform this capability on this Workspace (or this Brand)?* That check is a single helper backed by one indexed lookup on Workspace Members, and it lives inside the shared query layer — so a future endpoint cannot fetch a Brand without passing through it. What each role may do is a small capability table in code (e.g. Member: manage content; Owner: also manage Team, Workspace Settings, deletion).

**Scalability & efficiency.** Every access decision is O(1) against an indexed pair; content queries add one `workspace` filter. No new infrastructure. This is the shape Linear, Vercel and Notion ran on for years.

**Effort.** Moderate: migration, four tables, guard refactor, invite emails, Team page, Workspace Card/Switcher.

**Risks.** Enforcement is by convention — a route that skips the guard is a hole. Mitigated by putting the guard in the query layer and testing it there.

**Choose if:** you want the full model from section 3 in the schema on day one, with room for more roles and per-Brand scope without another migration.

## 5. Approach B — Database-enforced isolation (Postgres Row-Level Security)

*Same tables as A; the database itself refuses to return another Workspace's rows.*

**How it works.** Row-Level Security policies on every Brand-child table: each request tells Postgres which Workspace it acts for, and the database filters every query — even a buggy one — to that Workspace's rows. The app still needs A's role logic for *what* a Member may do; RLS covers *whose data is visible*.

**Scalability & efficiency.** Same query costs as A plus policy evaluation (negligible when policies are simple equality checks).

**Effort.** A's effort **plus** policy authoring per table, plus solving a real friction: setting the per-request Workspace on pooled serverless connections (Vercel + pooled Aiven Postgres) is awkward, and "why is this row invisible" becomes a recurring debugging tax with Drizzle.

**Risks.** Operational complexity lands on a two-person team now, for a guarantee that matters most when many engineers ship routes independently. RLS is additive — it can be layered onto A's schema later without redesign.

**Choose if:** cross-tenant leakage would be existential (compliance, enterprise contracts) and you accept the operational tax today.

## 6. Approach C — Dedicated authorization service

*Relationships ("X is Member of Workspace Z, Z contains Brand Y") stored in a purpose-built system such as SpiceDB (Google Zanzibar model).*

**How it works.** The app asks an external service every permission question and keeps it in sync with Postgres on every membership or Brand change. Unlocks arbitrarily deep sharing graphs: nested teams, per-item guests, cross-Workspace collaborators.

**Scalability & efficiency.** Effectively unbounded — this is Google Docs-scale machinery.

**Effort & risks.** An entire extra service to deploy, monitor and keep consistent (dual-write between Postgres and the authz store is the classic failure mode). Nothing in the prototype needs a relationship graph.

**Choose if:** the roadmap firmly includes deep nested sharing at large scale. Not before.

## 7. Approach D — The prototype, verbatim (minimal cut)

*Ship exactly the surface the sample app shows — nothing that isn't on screen.*

**How it works.** Same enforcement style as A (app-layer guard), but the model is trimmed to what the prototype renders:

- Roles are **Owner and Member only** — a two-value field, no capability table beyond "Owner can manage Team/Settings, Member can manage content."
- Access is **Workspace-wide only** — no Member Brand Access table, no restriction concept.
- Tables: Workspaces, Workspace Members, Workspace Invitations. That's all.
- Every prototype flow maps 1:1 — Invite Team modal (email only), Pending/Resend/Remove, Workspace Switcher, Settings with Danger Zone.

**Scalability & efficiency.** Identical runtime profile to A — same indexed lookups. What it trades away is *schema headroom*, not performance.

**Effort.** The smallest of the four; the UI is already fully specified, so build time is mostly wiring.

**Risks.** Two futures require follow-up migrations: adding Admin/Viewer roles (cheap: extend the role field and capability logic) and per-Brand scoping (moderate: new table + guard change). Neither is surgery, because Workspace ownership — the expensive part — is already in place.

**Choose if:** speed to a working Team feature matters more than schema headroom, and the agency/per-Brand story can wait for real demand.

---

## 8. Side-by-side

| | A — App guard | B — RLS | C — Authz service | D — Prototype verbatim |
|---|---|---|---|---|
| Where access is enforced | App (query layer) | Database + app | External service | App (query layer) |
| Roles in v1 | Owner/Member UI, 4-role-ready schema | same as A | any | Owner/Member only |
| Per-Brand scope | Schema ready, UI later | same as A | native | none |
| New infrastructure | none | none (policies) | new service | none |
| Per-request cost | 1 indexed lookup | same + policy eval | network hop (cached) | 1 indexed lookup |
| Build effort | ●●○○ | ●●●○ | ●●●● | ●○○○ |
| Leak-proofing | by convention + tests | by database | by service | by convention + tests |
| Fits Vercel + pooled Aiven | cleanly | awkward (per-request context on pooled connections) | adds latency & ops | cleanly |
| Future migrations needed | rarely | rarely | n/a | roles (cheap), scoping (moderate) |

## 9. Recommendation — D's surface on A's foundation

Ship **Approach D's user experience** — it is exactly what the prototype promises, and the fastest honest path to teams using the feature — but lay **Approach A's schema** underneath: a role field with room for more than two values, and the guard written against a capability table even while that table only distinguishes Owner from Member.

The reasoning: UI is a cheap contract to change; a production ownership model is not. Everything expensive about A (Workspace tables, Brand re-parenting, the migration, the guard choke point) is *also required by D*, so the delta for A's headroom is nearly free — while B stays available as a later hardening layer and C stays correctly unbuilt.

## 10. Open questions for deliberation

1. **Role set for v1** — Owner + Member as shipped UI with a role-ready schema (recommended)? Full Owner/Admin/Member/Viewer with a role picker now? Or two roles, hard?
2. **Per-Brand scoping** — schema-ready but no UI (recommended)? Fully built restriction UI in v1? Or dropped until an agency customer asks?
3. **Member powers** — content only: create/edit Brands, strategies, calendars, tickets, but no inviting, no Settings, no deletions (recommended)? Or may Members also invite?
4. **Smaller defaults to veto** — invitations expire after 7 days; one email per invite (matching the modal); personal Workspaces are named "*FirstName*'s Workspace" at migration; ownership transfer and per-seat billing are explicitly out of v1 scope; deleting a Workspace deletes its Brands after a typed confirmation.

## 11. Migration path (common to every approach)

1. Create the Workspace tables (additive — nothing breaks).
2. Backfill: one personal Workspace per existing user; an Owner membership row; re-parent their Brands to it.
3. Switch reads and guards to Workspace membership; keep the old owner column until verified, then drop it in a later migration.
4. Ship the Team page, Workspace Card/Switcher and invite flow on top.

Runs through the existing `scripts/migrate.mjs` ledger, staging first (staging now has its own database, so the backfill is rehearsed on real-shaped data before production).

---

*Prototype reference: `docs/ko-os-workspace-team/` — index.html, USER_FLOWS.md, COMPONENTS.md.*
