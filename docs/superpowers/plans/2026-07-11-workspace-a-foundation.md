# Workspace & Team — Plan A: Foundation (schema, guard, refactor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user gets a personal Workspace; Brands belong to Workspaces; all Brand access flows through one capability-checked guard — with zero visible behavior change.

**Architecture:** Additive migration (workspaces / workspace_members / workspace_invitations / member_brand_access + `brands.workspace_id`) with an in-migration backfill; a pure capability module (`can`, `evaluateBrandAccess`); a workspace query module whose `checkBrandAccess` is the single fetch-and-authorize choke point; then a mechanical refactor of every inline `brand.userId !== dbUser.id` check onto it. After this plan, each existing user is the sole owner-member of their personal workspace, so any behavior diff is a bug.

**Tech Stack:** Next.js 15 (App Router), Drizzle ORM + postgres.js, hand-written SQL migrations via `scripts/migrate.mjs`, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-07-11-workspace-team-design.md` (sections 1–2). Plans B (invites + Team page) and C (switcher + settings) build on the interfaces defined here.

## Global Constraints

- **Always `corepack pnpm`**, never bare `pnpm` (PATH pnpm is a Windows binary that crashes under WSL) and never npm.
- Migrations are **hand-written SQL** in `drizzle/NNNN_name.sql`, applied by `corepack pnpm db:migrate` (`scripts/migrate.mjs` ledger). Never `db:push`. Statements separated by `--> statement-breakpoint`.
- Work on branch `feat/workspace`. Commit after every task (steps say when).
- Roles vocabulary (from the prototype): **Workspace, Team, Members, Owner/Member**. Workspace roles are a separate axis from platform roles (`user/designer/admin`) — never mix them.
- Verification commands: `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`.
- `brands.user_id` is now **attribution only** ("created by"). No access decision may read it after this plan.

---

### Task 1: Schema + migration 0010 (tables, backfill, brands.workspace_id)

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `usageEvents`, plus one column in `brands`)
- Create: `drizzle/0010_workspaces.sql`

**Interfaces:**
- Produces: Drizzle tables `workspaces`, `workspaceMembers`, `workspaceInvitations`, `memberBrandAccess`, enum `workspaceRoleEnum`, and `brands.workspaceId` (not null). Every later task imports these from `@/lib/db/schema`.

- [ ] **Step 1: Add tables to `src/lib/db/schema.ts`**

Add `"use strict"`-free plain additions. First the enum, next to the other enums (after `userRoleEnum`):

```ts
export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "member"]);
```

Add to the `brands` table definition (after `userId`; `userId` stays — it is attribution only from now on):

```ts
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
```

Because `workspaces` is declared after `brands` in the file, declare the new tables ABOVE `brands` (directly after `passwordResetTokens`) to avoid use-before-declaration:

```ts
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.userId), index().on(t.userId)],
);

// Single-use invitation tokens. Stores only the SHA-256 hash of the raw token
// emailed to the invitee (same never-store-the-secret rule as sessions).
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId)],
);

/* Per-brand restriction rows. ALWAYS EMPTY in v1 (no UI writes here).
   Default-open rule: a member with no rows sees every brand in the
   workspace; a member with rows sees only those brands. */
export const memberBrandAccess = pgTable(
  "member_brand_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.workspaceId, t.userId, t.brandId)],
);
```

`memberBrandAccess` references `brands`, which is declared later — move `memberBrandAccess` to AFTER the `brands` table instead (order: `workspaces`, `workspaceMembers`, `workspaceInvitations` before `brands`; `memberBrandAccess` after `brands`). Extend the existing drizzle-orm import with `index` and `unique`.

- [ ] **Step 2: Verify the schema compiles**

Run: `corepack pnpm exec tsc --noEmit`
Expected: exit 0. (Callers of `createBrand` don't break — `$inferInsert` gains a required key but no caller is type-checked against the old shape until Task 6 updates them; if tsc DOES flag `createBrand` call sites in `src/app/(dashboard)/brand/actions.ts`, note the error and continue — Task 6 fixes them, and the intermediate commit at the end of THIS task must still typecheck, so in that case add `workspaceId` there in this task using `getOrCreatePersonalWorkspaceId` — see Task 6 Step 3 — and say so in the commit message.)

- [ ] **Step 3: Write `drizzle/0010_workspaces.sql`**

```sql
CREATE TYPE "workspace_role" AS ENUM ('owner', 'member');
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "workspace_members" ("user_id");
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" citext NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_id_index" ON "workspace_invitations" ("workspace_id");
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "workspace_id" uuid;
--> statement-breakpoint
INSERT INTO "workspaces" ("name", "owner_id")
SELECT "first_name" || '''s Workspace', "id" FROM "users";
--> statement-breakpoint
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
SELECT w."id", w."owner_id", 'owner' FROM "workspaces" w;
--> statement-breakpoint
UPDATE "brands" b SET "workspace_id" = w."id"
FROM "workspaces" w WHERE w."owner_id" = b."user_id";
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "brands_workspace_id_index" ON "brands" ("workspace_id");
--> statement-breakpoint
CREATE TABLE "member_brand_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "member_brand_access_workspace_id_user_id_brand_id_unique" UNIQUE("workspace_id","user_id","brand_id")
);
--> statement-breakpoint
ALTER TABLE "member_brand_access" ADD CONSTRAINT "member_brand_access_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_brand_access" ADD CONSTRAINT "member_brand_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_brand_access" ADD CONSTRAINT "member_brand_access_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
```

The backfill runs inside the same transaction as the DDL (the migration runner wraps each file in `sql.begin`), so a failure rolls back everything — no half-migrated state. The workspaces INSERT relies on `owner_id` being unique at backfill time (one personal workspace per user), which makes the members INSERT and brands UPDATE joins deterministic.

- [ ] **Step 4: Apply the migration locally**

Run: `corepack pnpm db:migrate`
Expected output: `✓ applied 0010_workspaces.sql (23 statement(s))` then `✓ Migrations up to date.`

- [ ] **Step 5: Verify the backfill**

Run:

```bash
node --input-type=module -e "
process.loadEnvFile('.env');
import postgres from 'postgres';
const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const [r] = await sql\`select
  (select count(*) from users) as users,
  (select count(*) from workspaces) as workspaces,
  (select count(*) from workspace_members where role = 'owner') as owners,
  (select count(*) from brands where workspace_id is null) as orphan_brands\`;
console.log(r);
if (r.users !== r.workspaces || r.users !== r.owners || r.orphan_brands !== 0n && r.orphan_brands !== 0) process.exit(1);
await sql.end();
"
```

Expected: printed counts with `users === workspaces === owners` and `orphan_brands` 0, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0010_workspaces.sql
git commit -m "feat(db): workspace tables + personal-workspace backfill (migration 0010)"
```

---

### Task 2: Capability model — pure module (TDD)

**Files:**
- Create: `src/lib/auth/workspace-access.ts`
- Test: `src/lib/auth/workspace-access.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4–7 and Plans B/C):

```ts
export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type Capability =
  | "manage_content" | "delete_content" | "manage_team"
  | "manage_settings" | "delete_workspace";
export function isWorkspaceRole(value: unknown): value is WorkspaceRole;
export function can(role: WorkspaceRole, capability: Capability): boolean;
export type AccessDecision =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string };
export function evaluateBrandAccess(input: {
  membership: { role: WorkspaceRole } | null;
  capability: Capability;
  brandId: string;
  /** brand ids from member_brand_access for this member; empty = default open */
  restrictedBrandIds: string[];
}): AccessDecision;
```

- [ ] **Step 1: Write the failing test**

`src/lib/auth/workspace-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  can,
  evaluateBrandAccess,
  isWorkspaceRole,
  type Capability,
} from "./workspace-access";

const ALL: Capability[] = [
  "manage_content",
  "delete_content",
  "manage_team",
  "manage_settings",
  "delete_workspace",
];

describe("can", () => {
  it("owner has every capability", () => {
    for (const c of ALL) expect(can("owner", c)).toBe(true);
  });

  it("member has manage_content and nothing else", () => {
    expect(can("member", "manage_content")).toBe(true);
    for (const c of ALL.filter((c) => c !== "manage_content")) {
      expect(can("member", c)).toBe(false);
    }
  });
});

describe("isWorkspaceRole", () => {
  it("accepts owner/member, rejects everything else", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("member")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
  });
});

describe("evaluateBrandAccess", () => {
  const base = { brandId: "b1", restrictedBrandIds: [] as string[] };

  it("non-member gets 404 (no existence leak)", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: null,
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("member with manage_content is allowed (default open)", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: true });
  });

  it("member lacking the capability gets 403", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: { role: "member" },
      capability: "delete_content",
    });
    expect(d).toEqual({
      ok: false,
      status: 403,
      error: "You don't have permission to do that in this workspace.",
    });
  });

  it("member restricted to other brands gets 404 for this one", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b2", "b3"],
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("member restricted to a list that includes this brand is allowed", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b1", "b3"],
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: true });
  });

  it("owner ignores restriction rows entirely", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b2"],
      membership: { role: "owner" },
      capability: "delete_content",
    });
    expect(d).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run src/lib/auth/workspace-access.test.ts`
Expected: FAIL — cannot resolve `./workspace-access`.

- [ ] **Step 3: Write the implementation**

`src/lib/auth/workspace-access.ts`:

```ts
/**
 * Workspace capability model. Fixed roles, defined in code — the guard is
 * written against this table even while only two roles exist, so adding a
 * role later is a row here, not a route audit.
 *
 * Workspace roles are a separate axis from platform roles (user/designer/
 * admin in src/lib/auth/roles.ts): platform roles say what you can do ON
 * KO OS; workspace roles say what you can do inside one customer's
 * workspace.
 */

export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type Capability =
  | "manage_content"
  | "delete_content"
  | "manage_team"
  | "manage_settings"
  | "delete_workspace";

const GRANTS: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  owner: new Set([
    "manage_content",
    "delete_content",
    "manage_team",
    "manage_settings",
    "delete_workspace",
  ]),
  member: new Set(["manage_content"]),
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return GRANTS[role].has(capability);
}

export type AccessDecision =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string };

const NOT_FOUND: AccessDecision = {
  ok: false,
  status: 404,
  error: "Brand not found",
};

const FORBIDDEN: AccessDecision = {
  ok: false,
  status: 403,
  error: "You don't have permission to do that in this workspace.",
};

/**
 * Pure access decision for one brand. Non-membership and restriction both
 * yield 404 (not 403) so responses never reveal that a brand exists.
 * Restriction rows (member_brand_access) only bind members: empty list =
 * default open; owners are never restricted.
 */
export function evaluateBrandAccess(input: {
  membership: { role: WorkspaceRole } | null;
  capability: Capability;
  brandId: string;
  restrictedBrandIds: string[];
}): AccessDecision {
  const { membership, capability, brandId, restrictedBrandIds } = input;
  if (!membership) return NOT_FOUND;
  if (!can(membership.role, capability)) return FORBIDDEN;
  if (
    membership.role !== "owner" &&
    restrictedBrandIds.length > 0 &&
    !restrictedBrandIds.includes(brandId)
  ) {
    return NOT_FOUND;
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run src/lib/auth/workspace-access.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/workspace-access.ts src/lib/auth/workspace-access.test.ts
git commit -m "feat(auth): workspace capability model (owner/member × capabilities)"
```

---

### Task 3: Workspace query module + `checkBrandAccess` choke point

**Files:**
- Create: `src/lib/db/queries/workspaces.ts`
- Modify: `src/lib/db/queries/index.ts` (one re-export line at the bottom)

**Interfaces:**
- Consumes: `evaluateBrandAccess`, `Capability`, `WorkspaceRole` from Task 2; drizzle tables from Task 1.
- Produces (all re-exported through `@/lib/db/queries`; Plans B/C call these):

```ts
export type WorkspaceMembership = {
  workspaceId: string; role: WorkspaceRole;
  workspace: { id: string; name: string; logoUrl: string | null; ownerId: string };
};
export async function getMembership(workspaceId: string, userId: string):
  Promise<{ id: string; role: WorkspaceRole } | null>;
export async function getWorkspacesForUser(userId: string): Promise<WorkspaceMembership[]>;
export type BrandAccess =
  | { ok: true; brand: typeof brands.$inferSelect }
  | { ok: false; status: 403 | 404; error: string };
export async function checkBrandAccess(userId: string, brandId: string, capability: Capability): Promise<BrandAccess>;
export async function getBrandsForMember(workspaceId: string, userId: string): Promise<Brand[]>;
export async function getActiveBrandForMember(workspaceId: string, userId: string): Promise<Brand | null>;
export async function getOrCreatePersonalWorkspaceId(userId: string, firstName: string): Promise<string>;
```

- [ ] **Step 1: Write `src/lib/db/queries/workspaces.ts`**

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  type Capability,
  evaluateBrandAccess,
  type WorkspaceRole,
} from "@/lib/auth/workspace-access";
import { db } from "@/lib/db/client";
import {
  brands,
  memberBrandAccess,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

// ── Memberships ──────────────────────────────────────────────────────

export async function getMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
  workspace: {
    id: string;
    name: string;
    logoUrl: string | null;
    ownerId: string;
  };
}

/** Every workspace this user belongs to, owner memberships first. */
export async function getWorkspacesForUser(
  userId: string,
): Promise<WorkspaceMembership[]> {
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        logoUrl: workspaces.logoUrl,
        ownerId: workspaces.ownerId,
      },
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    // Ascending enum order: workspace_role declares ('owner','member'),
    // so owner sorts first.
    .orderBy(workspaceMembers.role, workspaces.createdAt);
  return rows;
}

/**
 * Personal-workspace fallback for accounts created before this feature's
 * signup hook ran (or by Google OAuth paths added later). Idempotent.
 */
export async function getOrCreatePersonalWorkspaceId(
  userId: string,
  firstName: string,
): Promise<string> {
  const existing = await getWorkspacesForUser(userId);
  if (existing.length > 0) return existing[0].workspaceId;
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `${firstName}'s Workspace`, ownerId: userId })
    .returning({ id: workspaces.id });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId, role: "owner" })
    .onConflictDoNothing();
  return ws.id;
}

// ── Brand access (THE choke point) ───────────────────────────────────

export type BrandAccess =
  | { ok: true; brand: typeof brands.$inferSelect }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Fetch-and-authorize in one call. Every code path that touches a brand on
 * behalf of a user goes through here — routes must not fetch a brand and
 * check ownership themselves. 404 for "not yours" (no existence leak),
 * 403 for "yours but capability denied".
 */
export async function checkBrandAccess(
  userId: string,
  brandId: string,
  capability: Capability,
): Promise<BrandAccess> {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) {
    return { ok: false, status: 404, error: "Brand not found" };
  }
  const membership = await getMembership(brand.workspaceId, userId);
  const restrictions = membership
    ? await db
        .select({ brandId: memberBrandAccess.brandId })
        .from(memberBrandAccess)
        .where(
          and(
            eq(memberBrandAccess.workspaceId, brand.workspaceId),
            eq(memberBrandAccess.userId, userId),
          ),
        )
    : [];
  const decision = evaluateBrandAccess({
    membership,
    capability,
    brandId,
    restrictedBrandIds: restrictions.map((r) => r.brandId),
  });
  if (!decision.ok) return decision;
  return { ok: true, brand };
}

// ── Workspace-scoped brand queries ───────────────────────────────────

/** Brands this member may see, honoring member_brand_access default-open. */
export async function getBrandsForMember(workspaceId: string, userId: string) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) return [];
  const restrictions = await db
    .select({ brandId: memberBrandAccess.brandId })
    .from(memberBrandAccess)
    .where(
      and(
        eq(memberBrandAccess.workspaceId, workspaceId),
        eq(memberBrandAccess.userId, userId),
      ),
    );
  const restricted =
    membership.role !== "owner" && restrictions.length > 0
      ? restrictions.map((r) => r.brandId)
      : null;
  return db
    .select()
    .from(brands)
    .where(
      restricted
        ? and(eq(brands.workspaceId, workspaceId), inArray(brands.id, restricted))
        : eq(brands.workspaceId, workspaceId),
    )
    .orderBy(desc(brands.updatedAt));
}

/** Workspace-scoped replacement for getActiveBrandForUser. */
export async function getActiveBrandForMember(
  workspaceId: string,
  userId: string,
) {
  const list = await getBrandsForMember(workspaceId, userId);
  return list[0] ?? null;
}
```

- [ ] **Step 2: Re-export from the query index**

At the bottom of `src/lib/db/queries/index.ts` add:

```ts
export * from "./workspaces";
```

(The codebase imports everything from `@/lib/db/queries`; this keeps that convention without growing the 880-line index.)

- [ ] **Step 3: Typecheck and lint**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/queries/workspaces.ts src/lib/db/queries/index.ts
git commit -m "feat(db): workspace query module with checkBrandAccess choke point"
```

---

### Task 4: Active-workspace resolution (cookie + fallback, TDD)

**Files:**
- Modify: `src/lib/auth/constants.ts` (one line)
- Create: `src/lib/auth/active-workspace.ts` (pure chooser)
- Test: `src/lib/auth/active-workspace.test.ts`
- Create: `src/lib/auth/workspace.ts` (request-scoped resolver + cookie helpers)

**Interfaces:**
- Consumes: `getWorkspacesForUser`, `getOrCreatePersonalWorkspaceId`, `WorkspaceMembership` (Task 3); `getAuthUser` (existing).
- Produces:

```ts
// constants.ts
export const WORKSPACE_COOKIE = "ko_workspace";
// active-workspace.ts (pure)
export function chooseActiveWorkspace(
  memberships: WorkspaceMembership[],
  cookieWorkspaceId: string | undefined,
): WorkspaceMembership | null;
// workspace.ts
export const getActiveWorkspace: () => Promise<
  | { dbUser: null; workspace: null; role: null }
  | { dbUser: User; workspace: WorkspaceMembership["workspace"]; role: WorkspaceRole }
>;
export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void>;
```

- [ ] **Step 1: Add the cookie name to `src/lib/auth/constants.ts`**

```ts
export const WORKSPACE_COOKIE = "ko_workspace";
```

- [ ] **Step 2: Write the failing test**

`src/lib/auth/active-workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";
import { chooseActiveWorkspace } from "./active-workspace";

function m(id: string, role: "owner" | "member"): WorkspaceMembership {
  return {
    workspaceId: id,
    role,
    workspace: { id, name: `ws-${id}`, logoUrl: null, ownerId: "u0" },
  };
}

describe("chooseActiveWorkspace", () => {
  it("honors a cookie that matches a membership", () => {
    const picked = chooseActiveWorkspace([m("a", "owner"), m("b", "member")], "b");
    expect(picked?.workspaceId).toBe("b");
  });

  it("falls back to the first owner membership on a stale cookie", () => {
    const picked = chooseActiveWorkspace(
      [m("a", "member"), m("b", "owner")],
      "gone",
    );
    expect(picked?.workspaceId).toBe("b");
  });

  it("falls back to the first membership when user owns nothing", () => {
    const picked = chooseActiveWorkspace(
      [m("a", "member"), m("b", "member")],
      undefined,
    );
    expect(picked?.workspaceId).toBe("a");
  });

  it("returns null for no memberships", () => {
    expect(chooseActiveWorkspace([], "x")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm exec vitest run src/lib/auth/active-workspace.test.ts`
Expected: FAIL — cannot resolve `./active-workspace`.

- [ ] **Step 4: Implement the pure chooser**

`src/lib/auth/active-workspace.ts`:

```ts
import type { WorkspaceMembership } from "@/lib/db/queries/workspaces";

/**
 * The workspace cookie is a POINTER, not a credential: it is only honored
 * when it matches a real membership. Stale/missing cookie falls back to the
 * first owner membership (usually the personal workspace), then any
 * membership — so a removed member silently lands somewhere safe.
 */
export function chooseActiveWorkspace(
  memberships: WorkspaceMembership[],
  cookieWorkspaceId: string | undefined,
): WorkspaceMembership | null {
  if (cookieWorkspaceId) {
    const match = memberships.find((m) => m.workspaceId === cookieWorkspaceId);
    if (match) return match;
  }
  return (
    memberships.find((m) => m.role === "owner") ?? memberships[0] ?? null
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm exec vitest run src/lib/auth/active-workspace.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the request-scoped resolver**

`src/lib/auth/workspace.ts`:

```ts
import { cookies } from "next/headers";
import { cache } from "react";
import {
  getOrCreatePersonalWorkspaceId,
  getWorkspacesForUser,
} from "@/lib/db/queries";
import { chooseActiveWorkspace } from "./active-workspace";
import { WORKSPACE_COOKIE } from "./constants";
import { getAuthUser } from "./get-user";

/**
 * Resolve the signed-in user's active workspace. Wrapped in React cache()
 * (like getAuthUser) so layout + page share one lookup per request.
 * Self-heals accounts with no workspace (pre-migration stragglers).
 */
export const getActiveWorkspace = cache(async () => {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return { dbUser: null, workspace: null, role: null } as const;

  let memberships = await getWorkspacesForUser(dbUser.id);
  if (memberships.length === 0) {
    await getOrCreatePersonalWorkspaceId(dbUser.id, dbUser.firstName);
    memberships = await getWorkspacesForUser(dbUser.id);
  }

  const store = await cookies();
  const picked = chooseActiveWorkspace(
    memberships,
    store.get(WORKSPACE_COOKIE)?.value,
  );
  // memberships is non-empty here, so picked is never null.
  if (!picked) throw new Error("no workspace for authenticated user");
  return { dbUser, workspace: picked.workspace, role: picked.role } as const;
});

export async function setActiveWorkspaceCookie(
  workspaceId: string,
): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

- [ ] **Step 7: Typecheck, then commit**

Run: `corepack pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/lib/auth/constants.ts src/lib/auth/active-workspace.ts src/lib/auth/active-workspace.test.ts src/lib/auth/workspace.ts
git commit -m "feat(auth): active-workspace resolution with pointer cookie + owner-first fallback"
```

---

### Task 5: Refactor API routes onto `checkBrandAccess`

**Files (modify only — no new files):**
- `src/app/api/chat/route.ts:64`
- `src/app/api/chat/ensure-conversation.ts:47`
- `src/app/api/chat/conversations/[id]/route.ts:24`
- `src/app/api/strategy/generate/route.ts:54`
- `src/app/api/calendar/generate/route.ts:53`
- `src/app/api/design-brief/generate/route.ts:47`
- `src/app/api/design-tickets/route.ts:47`
- `src/app/api/design-tickets/[id]/review/route.ts:28,33`
- `src/app/api/design-tickets/[id]/deliverables/zip/route.ts:22`
- `src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.ts:20`

**Interfaces:**
- Consumes: `checkBrandAccess` (Task 3).
- Explicitly NOT changed: `src/app/api/jobs/[id]/route.ts` — generation jobs are polled only by their creator (the id is returned to whoever started the job), so `job.userId !== dbUser.id` remains correct. Leave it.

Every brand-owning route follows one pattern. The old shape:

```ts
const brand = await getBrandById(brandId);
if (!brand || brand.userId !== dbUser.id) {
  return Response.json({ error: "Brand not found" }, { status: 404 });
}
```

becomes:

```ts
const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
if (!access.ok) {
  return Response.json({ error: access.error }, { status: access.status });
}
const brand = access.brand;
```

Import `checkBrandAccess` from `@/lib/db/queries` in each file and drop `getBrandById` from the import when it becomes unused.

- [ ] **Step 1: Refactor the five brand-body routes**

Apply the pattern above (capability `"manage_content"`) in:

1. `src/app/api/chat/route.ts` — replace lines 63–66 (`const brand = await getBrandById…404`).
2. `src/app/api/strategy/generate/route.ts` — replace lines 53–56.
3. `src/app/api/calendar/generate/route.ts` — replace lines 52–55.
4. `src/app/api/design-brief/generate/route.ts` — replace lines 46–49.
5. `src/app/api/design-tickets/route.ts` — replace lines 46–49.

Line numbers are as of commit `4b67da6` — locate by the `brand.userId !== dbUser.id` expression, not by counting.

- [ ] **Step 2: Refactor the conversation route**

`src/app/api/chat/conversations/[id]/route.ts` guards by `conversation.userId`. Chat history is workspace content (spec: members see every brand's content), so authorize via the conversation's brand instead:

```ts
const conversation = await getConversationById(id);
if (!conversation) {
  return Response.json({ error: "Conversation not found" }, { status: 404 });
}
const access = await checkBrandAccess(
  dbUser.id,
  conversation.brandId,
  "manage_content",
);
if (!access.ok) {
  return Response.json(
    { error: "Conversation not found" },
    { status: access.status },
  );
}
```

(Keep the response text "Conversation not found" — this route's resource is the conversation. Apply to every handler in the file that had the userId check.)

Also `src/app/api/chat/ensure-conversation.ts` (line ~47): it rejects when `existing.userId !== userId`. Chat conversations are workspace content, so a teammate resuming a brand's conversation is legitimate. Replace that check with the same brand-based authorization: the helper already knows the `brandId` it is ensuring a conversation for — verify the existing conversation belongs to that brand (`existing.brandId === brandId`) instead of comparing user ids, and let the caller's own `checkBrandAccess` (added in Step 1 to `chat/route.ts`) remain the access gate. If the helper is also called from somewhere that does NOT guard the brand first, add a `checkBrandAccess` call inside the helper instead — read its call sites and pick accordingly.

- [ ] **Step 3: Refactor the ticket-scoped routes**

The three ticket routes gate on `ticket.userId === dbUser.id` with designer/admin alternates. Requester-ship becomes workspace access via the ticket's brand. In each file compute:

```ts
const access = await checkBrandAccess(dbUser.id, ticket.brandId, "manage_content");
const isWorkspaceMember = access.ok;
```

then substitute `isWorkspaceMember` wherever `isOwner` (`ticket.userId === dbUser.id`) was used in the allow condition, keeping the existing designer/admin branches exactly as they are:

1. `src/app/api/design-tickets/[id]/deliverables/zip/route.ts` (line ~22)
2. `src/app/api/design-tickets/[id]/deliverables/[deliverableId]/route.ts` (line ~20)
3. `src/app/api/design-tickets/[id]/review/route.ts` — this one checks ticket ownership AND brand ownership (lines ~28 and ~33); collapse both into the single `checkBrandAccess` call on `ticket.brandId` (delete the separate `getBrandById` check; keep using `access.brand` if the handler needs the brand row).

- [ ] **Step 4: Verify no inline check survives**

Run: `grep -rn "userId !== dbUser.id\|\.userId === dbUser.id\|userId !== userId\|\.userId !== " src/app/api`
Expected: the only surviving ownership comparison is in `src/app/api/jobs/[id]/route.ts` (deliberately kept — jobs are polled by their creator).

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass. (Route test files that mocked `getBrandById` ownership — check `src/app/api/strategy/generate/` for colocated tests — must be updated to mock `checkBrandAccess` returning `{ ok: true, brand }`; if a test fails naming `getBrandById`, that's the fix.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api
git commit -m "refactor(api): route all brand access through checkBrandAccess guard"
```

---

### Task 6: Workspace-scope the pages, `requireBrand`, and brand creation

**Files:**
- Modify: `src/lib/auth/require-brand.ts`
- Modify: `src/app/(dashboard)/brand/actions.ts`
- Modify: `src/app/(dashboard)/brand/page.tsx:77`
- Modify: `src/app/(dashboard)/brand/create/page.tsx:11`
- Modify: `src/app/(auth)/actions.ts` (signup creates the personal workspace)

**Interfaces:**
- Consumes: `getActiveWorkspace` (Task 4), `getActiveBrandForMember`, `getOrCreatePersonalWorkspaceId` (Task 3).
- Produces: `requireBrand()` now returns `{ dbUser, workspace, role, brand }` — Plans B/C rely on `workspace` and `role` being available wherever `requireBrand()` is already called.

- [ ] **Step 1: Rewrite `src/lib/auth/require-brand.ts`**

```ts
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForMember } from "@/lib/db/queries";

export async function requireBrand() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");
  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (!hasCompletedBrand(brand?.onboardingStatus)) redirect("/brand/create");
  return { dbUser, workspace, role, brand };
}
```

Existing callers destructure `{ dbUser, brand }` — both keys survive, so no caller changes are required.

- [ ] **Step 2: Workspace-scope the brand pages**

In `src/app/(dashboard)/brand/page.tsx` and `src/app/(dashboard)/brand/create/page.tsx`, replace

```ts
const brand = await getActiveBrandForUser(dbUser.id);
```

with

```ts
const { workspace } = await getActiveWorkspace();
const brand = workspace
  ? await getActiveBrandForMember(workspace.id, dbUser.id)
  : null;
```

adjusting imports (`getActiveWorkspace` from `@/lib/auth/workspace`, `getActiveBrandForMember` from `@/lib/db/queries`). Where the page already redirects unauthenticated users before this point, `workspace` is always non-null — keep the guard anyway; it's cheap and typesafe.

- [ ] **Step 3: Brand creation sets `workspaceId`**

In `src/app/(dashboard)/brand/actions.ts`: replace the `getActiveBrandForUser(dbUser.id)` lookup (line ~58) the same way as Step 2, and wherever the action calls `createBrand({ userId: dbUser.id, … })`, add the workspace:

```ts
const { workspace } = await getActiveWorkspace();
if (!workspace) redirect("/login");
// …
const brand = await createBrand({
  userId: dbUser.id, // attribution only ("created by")
  workspaceId: workspace.id,
  // …existing fields unchanged
});
```

- [ ] **Step 4: Signup creates the personal workspace**

The migration backfilled existing users; new users need one at signup. In `src/app/(auth)/actions.ts` `signup()`, after `const user = await createUser({...})` add:

```ts
await getOrCreatePersonalWorkspaceId(user.id, user.firstName);
```

(import from `@/lib/db/queries`). Do the same in the Google OAuth callback `src/app/(auth)/auth/callback/route.ts` right after its `createUser` call for first-time Google users (locate the user-creation branch; do NOT add it after `startSession` for returning users — `getActiveWorkspace` self-heals those anyway).

- [ ] **Step 5: Verify the invariant grep**

Run: `grep -rn "getActiveBrandForUser\|getBrandsByUserId" src/app src/lib --include=*.ts --include=*.tsx | grep -v "queries/index.ts"`
Expected: no hits outside `src/lib/db/queries/index.ts` (the old functions stay exported for now; nothing calls them).

- [ ] **Step 6: Typecheck, lint, tests**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm lint && corepack pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/require-brand.ts "src/app/(dashboard)/brand" "src/app/(auth)"
git commit -m "refactor(app): workspace-scope pages, requireBrand, brand creation, signup"
```

---

### Task 7: End-to-end behavior verification (no visible change)

**Files:** none created — verification only.

- [ ] **Step 1: Full quality gate**

Run: `corepack pnpm test && corepack pnpm lint && corepack pnpm exec tsc --noEmit`
Expected: all pass, zero errors.

- [ ] **Step 2: Drive the app**

Run: `corepack pnpm dev` and exercise with an existing local account:

1. Log in → dashboard renders (workspace resolution + fallback worked).
2. Brand page shows the same brand as before the migration.
3. Send a chat message (guard on `manage_content` allows it).
4. Create a design ticket from a calendar item (ticket route guard works).
5. In a second browser profile, log in as a DIFFERENT user and request the first user's brand id via `curl -b <cookie> http://localhost:3000/api/chat -d '{"brandId":"<first user's brand id>", ...}'` → expect `404 {"error":"Brand not found"}` (cross-workspace leak check).

Expected: identical UX to pre-migration; cross-workspace access denied with 404.

- [ ] **Step 3: Commit any fixes, then close out the plan**

```bash
git add -A && git commit -m "test(workspace): foundation verification fixes" # only if fixes were needed
```

Plan A leaves `main`-visible behavior unchanged. Plan B (`2026-07-11-workspace-b-invites-team.md`) builds the invite flow and Team page on these interfaces.
