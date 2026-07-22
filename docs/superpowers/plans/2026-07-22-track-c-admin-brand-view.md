# Track C — Admin Brand View and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins browse every brand, read its full profile, and download the logo and a JSON export.

**Architecture:** A new admin-only `Brands` section mirroring the existing `Users` section: a list page backed by one query, a detail page rendering the profile read-only with print styles, and two API routes for downloads. A pure `toBrandExport` module shapes the JSON so it is unit-testable without a database.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Vitest, Biome.

## Global Constraints

- Package manager is `corepack pnpm` — the PATH `pnpm` is a Windows binary and crashes installs. Never use `npm install`.
- Tests: `corepack pnpm test`. Lint: `corepack pnpm lint`. Both must pass before every commit.
- Comment norms (`CLAUDE.md`): no "what" comments, only "why" comments. Never comment out old code — delete it.
- Dark-first app. Use adaptive CSS custom properties. Never hardcode light-mode hexes or `text-white` on theme surfaces.
- Admin-only. Every page uses `requireRole(["admin"])`; every API route re-checks `dbUser?.role !== "admin"` independently — the layout guard is not authorization for routes.
- No database migration. `brand_assets` stays unused.
- No new dependencies. PDF output is the browser's print-to-PDF, not a library.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/admin/brand-export.ts` | Pure: shape a brand row into the export payload |
| `src/lib/admin/brand-export.test.ts` | Unit tests for the above |
| `src/lib/db/queries/index.ts` | Add `listBrandsForAdmin`, `getBrandForAdmin` |
| `src/app/admin/brands/page.tsx` | List page (server) |
| `src/app/admin/brands/brands-table.tsx` | List table with search (client) |
| `src/app/admin/brands/[id]/page.tsx` | Detail page (server), print-friendly |
| `src/app/api/admin/brands/[id]/export/route.ts` | JSON attachment |
| `src/app/api/admin/brands/[id]/logo/route.ts` | Logo attachment |
| `src/app/admin/layout.tsx` | Modify: add the Brands nav link |

---

### Task 1: Pure brand-export module

**Files:**
- Create: `src/lib/admin/brand-export.ts`
- Test: `src/lib/admin/brand-export.test.ts`

**Interfaces:**
- Produces: `BrandExport` (interface), `toBrandExport(brand: BrandRow): BrandExport`, `brandExportFilename(brand: { name: string }): string`

`BrandRow` here means `typeof brands.$inferSelect`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/brand-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { brandExportFilename, toBrandExport } from "./brand-export";

const brand = {
  id: "b1",
  name: "Ada Bakes",
  onboardingStatus: "completed",
  completionPercentage: 100,
  overview: "Artisan sourdough bakery",
  businessType: "Retail",
  stage: "Growth",
  targetAudience: "Home cooks",
  offer: "Weekly bread boxes",
  tone: "Warm",
  primaryGoal: "Grow subscriptions",
  primaryColor: "#8B5E34",
  secondaryColor: null,
  additionalColors: null,
  logoUrl: "https://cdn.example.com/logo.png",
  values: null,
  wordsLove: null,
  wordsAvoid: null,
  hasLogo: true,
  brandStyle: null,
  competitors: null,
  competitorStrengths: null,
  differentiators: null,
  platforms: ["Instagram"],
  primaryPlatform: "Instagram",
  postingFrequency: "3x per week",
  additionalNotes: null,
  helpfulLinks: null,
  createdAt: new Date("2026-01-15T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
} as Parameters<typeof toBrandExport>[0];

describe("toBrandExport", () => {
  it("groups fields into the seven onboarding sections", () => {
    const out = toBrandExport(brand);
    expect(Object.keys(out.sections)).toEqual([
      "basics",
      "audience",
      "personality",
      "visual",
      "competitors",
      "platforms",
      "additional",
    ]);
  });

  it("carries identity and status outside the sections", () => {
    const out = toBrandExport(brand);
    expect(out.id).toBe("b1");
    expect(out.name).toBe("Ada Bakes");
    expect(out.onboardingStatus).toBe("completed");
    expect(out.completionPercentage).toBe(100);
  });

  it("serializes timestamps as ISO strings so the payload is plain JSON", () => {
    const out = toBrandExport(brand);
    expect(out.createdAt).toBe("2026-01-15T00:00:00.000Z");
    expect(out.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("keeps null fields rather than dropping them, so gaps stay visible", () => {
    const out = toBrandExport(brand);
    expect(out.sections.personality.values).toBeNull();
  });

  it("puts the logo url in the visual section", () => {
    expect(toBrandExport(brand).sections.visual.logoUrl).toBe(
      "https://cdn.example.com/logo.png",
    );
  });
});

describe("brandExportFilename", () => {
  it("slugifies the brand name", () => {
    expect(brandExportFilename({ name: "Ada Bakes" })).toBe("ada-bakes-brand.json");
  });

  it("strips characters that are unsafe in a filename", () => {
    expect(brandExportFilename({ name: "A/B: Test!" })).toBe("a-b-test-brand.json");
  });

  it("falls back when the name slugifies to nothing", () => {
    expect(brandExportFilename({ name: "///" })).toBe("brand.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/admin/brand-export.test.ts`
Expected: FAIL — `Failed to resolve import "./brand-export"`

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/brand-export.ts`:

```ts
import type { brands } from "@/lib/db/schema";

type BrandRow = typeof brands.$inferSelect;

export interface BrandExport {
  id: string;
  name: string;
  onboardingStatus: string;
  completionPercentage: number;
  createdAt: string;
  updatedAt: string;
  sections: {
    basics: Pick<BrandRow, "overview" | "businessType" | "stage" | "primaryGoal">;
    audience: Pick<BrandRow, "targetAudience" | "offer" | "tone">;
    personality: Pick<BrandRow, "values" | "wordsLove" | "wordsAvoid">;
    visual: Pick<
      BrandRow,
      | "logoUrl"
      | "hasLogo"
      | "brandStyle"
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
    >;
    competitors: Pick<
      BrandRow,
      "competitors" | "competitorStrengths" | "differentiators"
    >;
    platforms: Pick<
      BrandRow,
      "platforms" | "primaryPlatform" | "postingFrequency"
    >;
    additional: Pick<BrandRow, "additionalNotes" | "helpfulLinks">;
  };
}

/** Shape a brand row for admin export, grouped the same way the onboarding
 * form asks for it so an admin reading the JSON recognizes the structure.
 * Null fields are kept: a missing answer is information. */
export function toBrandExport(brand: BrandRow): BrandExport {
  return {
    id: brand.id,
    name: brand.name,
    onboardingStatus: brand.onboardingStatus,
    completionPercentage: brand.completionPercentage,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
    sections: {
      basics: {
        overview: brand.overview,
        businessType: brand.businessType,
        stage: brand.stage,
        primaryGoal: brand.primaryGoal,
      },
      audience: {
        targetAudience: brand.targetAudience,
        offer: brand.offer,
        tone: brand.tone,
      },
      personality: {
        values: brand.values,
        wordsLove: brand.wordsLove,
        wordsAvoid: brand.wordsAvoid,
      },
      visual: {
        logoUrl: brand.logoUrl,
        hasLogo: brand.hasLogo,
        brandStyle: brand.brandStyle,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        additionalColors: brand.additionalColors,
      },
      competitors: {
        competitors: brand.competitors,
        competitorStrengths: brand.competitorStrengths,
        differentiators: brand.differentiators,
      },
      platforms: {
        platforms: brand.platforms,
        primaryPlatform: brand.primaryPlatform,
        postingFrequency: brand.postingFrequency,
      },
      additional: {
        additionalNotes: brand.additionalNotes,
        helpfulLinks: brand.helpfulLinks,
      },
    },
  };
}

export function brandExportFilename(brand: { name: string }): string {
  const slug = brand.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-brand.json` : "brand.json";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/admin/brand-export.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/admin/brand-export.ts src/lib/admin/brand-export.test.ts
git commit -m "feat: pure brand export shaping for admin"
```

---

### Task 2: Admin brand queries

**Files:**
- Modify: `src/lib/db/queries/index.ts`

**Interfaces:**
- Produces:
  - `listBrandsForAdmin(): Promise<{ brand: BrandRow; ownerEmail: string; workspaceName: string; ticketCount: number }[]>`
  - `getBrandForAdmin(id: string): Promise<{ brand: BrandRow; ownerEmail: string; workspaceName: string } | null>`

**Why no unit test:** these are query compositions with no branching logic; the repo does not unit-test query builders. Task 3's manual verification covers them.

- [ ] **Step 1: Write the implementation**

Add to `src/lib/db/queries/index.ts`. Ensure `count`, `desc`, `eq` and the `brands`, `users`, `workspaces`, `designTickets` tables are imported (most already are):

```ts
/** Every brand in the system for the admin console, newest first. Admin-only
    by construction: no workspace scoping, so callers must gate on role. */
export async function listBrandsForAdmin() {
  const rows = await db
    .select({
      brand: brands,
      ownerEmail: users.email,
      workspaceName: workspaces.name,
      ticketCount: count(designTickets.id),
    })
    .from(brands)
    .innerJoin(users, eq(users.id, brands.userId))
    .innerJoin(workspaces, eq(workspaces.id, brands.workspaceId))
    .leftJoin(designTickets, eq(designTickets.brandId, brands.id))
    .groupBy(brands.id, users.email, workspaces.name)
    .orderBy(desc(brands.createdAt));
  return rows;
}

/** One brand with its owner and workspace, for the admin detail page. */
export async function getBrandForAdmin(id: string) {
  const [row] = await db
    .select({
      brand: brands,
      ownerEmail: users.email,
      workspaceName: workspaces.name,
    })
    .from(brands)
    .innerJoin(users, eq(users.id, brands.userId))
    .innerJoin(workspaces, eq(workspaces.id, brands.workspaceId))
    .where(eq(brands.id, id))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors

- [ ] **Step 3: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/db/queries/index.ts
git commit -m "feat: admin brand queries"
```

---

### Task 3: Brands list page

**Files:**
- Create: `src/app/admin/brands/page.tsx`
- Create: `src/app/admin/brands/brands-table.tsx`
- Modify: `src/app/admin/layout.tsx:29-38`

**Interfaces:**
- Consumes: `listBrandsForAdmin` (Task 2)
- Produces: `BrandsTable` with props `{ brands: BrandListRow[] }` where `BrandListRow = { id: string; name: string; ownerEmail: string; workspaceName: string; status: string; completionPercentage: number; ticketCount: number; createdAt: string }`

- [ ] **Step 1: Write the client table**

Create `src/app/admin/brands/brands-table.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

export interface BrandListRow {
  id: string;
  name: string;
  ownerEmail: string;
  workspaceName: string;
  status: string;
  completionPercentage: number;
  ticketCount: number;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BrandsTable({ brands }: { brands: BrandListRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? brands.filter(
        (b) =>
          b.name.toLowerCase().includes(needle) ||
          b.ownerEmail.toLowerCase().includes(needle),
      )
    : brands;

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        aria-label="Search brands"
        placeholder="Search by brand or owner email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
      />

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Brand</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Tickets</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b) => (
              <tr
                key={b.id}
                className="border-t border-[var(--border)] text-foreground"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/brands/${b.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.ownerEmail}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.workspaceName}
                </td>
                <td className="px-4 py-3">
                  <span className="capitalize text-[var(--text-secondary)]">
                    {b.status}
                  </span>{" "}
                  <span className="text-[var(--text-muted)]">
                    ({b.completionPercentage}%)
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {b.ticketCount}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {formatDate(b.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
            No brands match that search.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the server page**

Create `src/app/admin/brands/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { listBrandsForAdmin } from "@/lib/db/queries";
import { BrandsTable } from "./brands-table";

export default async function AdminBrandsPage() {
  await requireRole(["admin"]);
  const rows = await listBrandsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Brands
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          Every brand on the platform. Open one to read its full profile and
          download its assets.
        </p>
      </div>
      <BrandsTable
        brands={rows.map((r) => ({
          id: r.brand.id,
          name: r.brand.name,
          ownerEmail: r.ownerEmail,
          workspaceName: r.workspaceName,
          status: r.brand.onboardingStatus,
          completionPercentage: r.brand.completionPercentage,
          ticketCount: r.ticketCount,
          createdAt: r.brand.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link**

In `src/app/admin/layout.tsx`, the admin-only nav block currently reads:

```tsx
            {isAdmin && (
              <>
                <Link href="/admin/users" className="hover:text-foreground">
                  Users
                </Link>
```

Insert a Brands link before Users:

```tsx
            {isAdmin && (
              <>
                <Link href="/admin/brands" className="hover:text-foreground">
                  Brands
                </Link>
                <Link href="/admin/users" className="hover:text-foreground">
                  Users
                </Link>
```

- [ ] **Step 4: Run the full suite and lint**

Run: `corepack pnpm test`
Expected: PASS

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/brands/ src/app/admin/layout.tsx
git commit -m "feat: admin brands list"
```

---

### Task 4: Brand detail page

**Files:**
- Create: `src/app/admin/brands/[id]/page.tsx`

**Interfaces:**
- Consumes: `getBrandForAdmin` (Task 2), `toBrandExport` (Task 1)

- [ ] **Step 1: Write the page**

Create `src/app/admin/brands/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { toBrandExport } from "@/lib/admin/brand-export";
import { requireRole } from "@/lib/auth/require-role";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

const SECTION_TITLES: Record<string, string> = {
  basics: "Basics",
  audience: "Audience & Offer",
  personality: "Brand Personality",
  visual: "Visual Identity",
  competitors: "Competitors",
  platforms: "Platforms & Posting",
  additional: "Anything Else",
};

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default async function AdminBrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const row = await getBrandForAdmin(id);
  if (!row) notFound();

  const exported = toBrandExport(row.brand);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {row.brand.name}
          </h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
            {row.ownerEmail} · {row.workspaceName} ·{" "}
            <span className="capitalize">{row.brand.onboardingStatus}</span> (
            {row.brand.completionPercentage}%)
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a
            href={`/api/admin/brands/${row.brand.id}/export`}
            className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-surface-1 px-4 text-[13px] font-semibold text-foreground hover:border-[var(--border-accent)]"
          >
            Download JSON
          </a>
          {row.brand.logoUrl && (
            <a
              href={`/api/admin/brands/${row.brand.id}/logo`}
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-surface-1 px-4 text-[13px] font-semibold text-foreground hover:border-[var(--border-accent)]"
            >
              Download Logo
            </a>
          )}
        </div>
      </header>

      {row.brand.logoUrl && (
        <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Logo
          </h2>
          {/* biome-ignore lint/performance/noImgElement: arbitrary tenant-uploaded host, not a known next/image domain */}
          <img
            src={row.brand.logoUrl}
            alt={`${row.brand.name} logo`}
            className="max-h-32 w-auto"
          />
        </div>
      )}

      {Object.entries(exported.sections).map(([key, fields]) => (
        <section
          key={key}
          className="rounded-xl border border-[var(--border)] bg-surface-1 p-5"
        >
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {SECTION_TITLES[key] ?? key}
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(fields as Record<string, unknown>).map(
              ([field, value]) => (
                <div key={field}>
                  <dt className="text-[12px] text-[var(--text-muted)]">
                    {humanizeKey(field)}
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-[13px] text-foreground">
                    {renderValue(value)}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/brands/[id]/page.tsx"
git commit -m "feat: admin brand detail page"
```

---

### Task 5: Export and logo download routes

**Files:**
- Create: `src/app/api/admin/brands/[id]/export/route.ts`
- Create: `src/app/api/admin/brands/[id]/logo/route.ts`

**Interfaces:**
- Consumes: `getBrandForAdmin` (Task 2), `toBrandExport` and `brandExportFilename` (Task 1)

- [ ] **Step 1: Write the JSON export route**

Create `src/app/api/admin/brands/[id]/export/route.ts`:

```ts
import { brandExportFilename, toBrandExport } from "@/lib/admin/brand-export";
import { getAuthUser } from "@/lib/auth/get-user";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  // Routes authorize independently — the admin layout guard does not cover them.
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }
  const row = await getBrandForAdmin(id);
  if (!row) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  const payload = {
    ...toBrandExport(row.brand),
    owner: row.ownerEmail,
    workspace: row.workspaceName,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${brandExportFilename(row.brand)}"`,
    },
  });
}
```

- [ ] **Step 2: Write the logo download route**

Create `src/app/api/admin/brands/[id]/logo/route.ts`:

```ts
import { getAuthUser } from "@/lib/auth/get-user";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

const EXT_BY_TYPE = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/svg+xml", "svg"],
]);

/**
 * Stream a brand logo as an attachment. Proxied rather than linked directly
 * because logoUrl points at external object storage, where a `download`
 * attribute on an anchor is ignored cross-origin.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }
  const row = await getBrandForAdmin(id);
  if (!row?.brand.logoUrl) {
    return Response.json({ error: "No logo on file" }, { status: 404 });
  }

  const upstream = await fetch(row.brand.logoUrl);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "Could not fetch the logo" }, { status: 502 });
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const ext = EXT_BY_TYPE.get(contentType) ?? "img";
  const slug = row.brand.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${slug || "brand"}-logo.${ext}"`,
    },
  });
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 4: Run the full suite**

Run: `corepack pnpm test`
Expected: PASS

- [ ] **Step 5: Manual verification**

Use the `verify` skill to launch the dev server, then as an admin:
1. Open `/admin` — a **Brands** link appears in the nav.
2. Open `/admin/brands` — every brand lists, search filters by name and owner email.
3. Open a brand — all seven sections render, missing fields show `—`.
4. Click **Download JSON** — a `<slug>-brand.json` file downloads and parses.
5. Click **Download Logo** on a brand that has one — the image downloads.
6. Print the page (Cmd-P) — the download buttons are hidden and the profile is readable.
7. Sign in as a non-admin and request `/api/admin/brands/<id>/export` — 403.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/admin/brands/"
git commit -m "feat: admin brand JSON and logo downloads"
```

---

## Out of scope

- Brand asset uploads beyond the logo; `brand_assets` remains unused.
- Server-side PDF generation — the detail page uses browser print-to-PDF.
- Editing brands from the admin console (read-only by design).
- Surfacing design-ticket deliverables on the brand page.
