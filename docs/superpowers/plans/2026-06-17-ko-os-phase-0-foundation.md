# KO OS Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the foundation that unblocks every KO OS feature phase — test tooling, the exact dark-mode design system, the pivoted data model, the app shell/navigation, and removal of off-spec legacy features.

**Architecture:** This is the first of six phase plans derived from `docs/superpowers/specs/2026-06-17-ko-os-mvp-design.md`. Phase 0 changes no user-facing feature behavior on its own; it leaves the app building, linting, type-checking, and navigable with the new shell, ready for Phase 1 (Front door). We reuse the existing Next.js 16 / Supabase / Drizzle / shadcn stack and pivot it toward the v1.1 UI Specification.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Drizzle ORM + Postgres (Supabase), Vitest + @testing-library/react (new), Biome, lucide-react.

**Phase map (this plan = Phase 0):**
- **Phase 0 — Foundation** (this document)
- Phase 1 — Front door (entry, auth, Brand Profile, legal)
- Phase 2 — AI core (strategy chat → structured strategy)
- Phase 3 — Content Calendar
- Phase 4 — Design Tickets + designer admin fulfillment
- Phase 5 — Dashboard + hardening

Each later phase gets its own detailed plan written when reached, so it reflects the real evolving codebase.

---

## File Structure (created/modified in Phase 0)

**Create:**
- `vitest.config.ts` — Vitest configuration (jsdom, path alias).
- `vitest.setup.ts` — Testing Library matchers setup.
- `src/lib/ticket-number.ts` — `formatTicketNumber()` helper (pure, unit-tested).
- `src/lib/ticket-number.test.ts` — its test.
- `src/components/ui/status-badge.tsx` — status pill mapped to design-system status colors.
- `src/components/ui/status-badge.test.tsx` — its test.
- `src/components/ui/segmented-control.tsx` — calendar/filter view toggle (used Phase 3/4).
- `src/components/ui/segmented-control.test.tsx` — its test.
- `src/lib/storage.ts` — Supabase Storage bucket constants + signed-URL helper.
- `src/lib/nav.ts` — single source of truth for sidebar nav items.

**Modify:**
- `package.json` — add test scripts + dev deps.
- `src/app/globals.css` — replace token values with exact KO OS dark tokens; add typography/motion utilities.
- `src/app/layout.tsx` — add Manrope font; update metadata; toaster position.
- `src/lib/db/schema.ts` — pivot the data model (new enums/tables, drops).
- `src/components/layout/app-sidebar.tsx` — nav items + collapse to spec.
- `src/components/layout/top-header.tsx` — notification bell + avatar dropdown.
- `src/components/ui/button.tsx` — variants aligned to design system (primary/secondary/ghost/icon).
- `src/components/ui/button.test.tsx` — its test (create).

**Delete (off-spec legacy):**
- `src/app/(dashboard)/knowledge/` (whole dir), `src/app/(dashboard)/requests/` (whole dir).
- `src/app/(dashboard)/campaigns/` (whole dir — replaced by `/strategy` + `/calendar` in later phases).
- `src/components/onboarding/onboarding-wizard.tsx`.
- `src/lib/ai/campaign-generator.ts`, `src/lib/ai/prompts/campaign.ts`.

---

## Task 1: Set up Vitest test framework

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: packages added to `devDependencies`, lockfile updated.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add test scripts to `package.json`**

Add to the `"scripts"` object:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write a temporary smoke test**

Create `src/lib/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("runs the test framework", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test suite**

Run: `pnpm test`
Expected: 1 passing test.

- [ ] **Step 7: Delete the smoke test and commit**

```bash
rm src/lib/smoke.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts vitest.setup.ts
git commit -m "chore: set up Vitest + Testing Library"
```

---

## Task 2: Apply exact KO OS dark design tokens

**Files:**
- Modify: `src/app/globals.css`

These values come directly from the UI Specification §9.2. This is verified by build + visual check, not a unit test (pure CSS).

- [ ] **Step 1: Replace the `:root` token block in `src/app/globals.css`**

Replace the existing `:root { ... }` block (lines ~9-52) with:
```css
:root {
  /* Backgrounds & surfaces (UI Spec §9.2) */
  --background: #000d20; /* Base */
  --surface-1: #00162e;
  --surface-2: #001f3d;
  --nav: #00204f;

  /* Action & accent */
  --primary: #138bc8;
  --primary-hover: #0f7eb8;
  --primary-active: #0c5f8a;
  --primary-disabled: #1a3a4a;
  --primary-foreground: #ffffff;
  --accent-glow: rgba(19, 139, 200, 0.15);

  /* Text */
  --foreground: #ffffff;
  --text-secondary: #a7b6c7;
  --text-muted: #6f8599;

  /* Status */
  --status-draft-bg: rgba(255, 255, 255, 0.06);
  --status-draft-fg: #a7b6c7;
  --status-progress-bg: rgba(19, 139, 200, 0.15);
  --status-progress-fg: #85b7eb;
  --status-ready-bg: rgba(99, 153, 34, 0.18);
  --status-ready-fg: #97c459;
  --status-pending-bg: rgba(212, 169, 84, 0.15);
  --status-pending-fg: #d4a954;
  --status-error-bg: rgba(212, 117, 117, 0.08);
  --status-error-fg: #d47575;

  /* Borders / dividers / effects */
  --border: rgba(255, 255, 255, 0.06);
  --border-hover: rgba(255, 255, 255, 0.1);
  --border-accent: rgba(19, 139, 200, 0.4);
  --divider: rgba(255, 255, 255, 0.08);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.5);
  --shadow-toast: 0 4px 16px rgba(0, 0, 0, 0.3);
  --backdrop: rgba(0, 0, 0, 0.6);

  /* Aliases kept for shadcn components already in the tree */
  --card: var(--surface-1);
  --card-foreground: var(--foreground);
  --popover: var(--surface-2);
  --popover-foreground: var(--foreground);
  --muted: var(--surface-1);
  --muted-foreground: var(--text-muted);
  --input: var(--border);
  --ring: var(--primary);
  --radius: 0.625rem; /* 10px per spec button/input radius */
  --error: var(--status-error-fg);
  --success: var(--status-ready-fg);
  --warning: var(--status-pending-fg);

  /* Fonts */
  --font-display: var(--font-bricolage-grotesque);
  --font-ui: var(--font-manrope);
}
```

- [ ] **Step 2: Update the `@theme inline` block to expose the new tokens**

Replace the `@theme inline { ... }` block so each token has a `--color-*` mapping. Include at minimum:
```css
@theme inline {
  --color-background: var(--background);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-nav: var(--nav);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-active: var(--primary-active);
  --color-primary-foreground: var(--primary-foreground);
  --color-foreground: var(--foreground);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 6px); /* 16px modals/drawers */
  --font-sans: var(--font-manrope);
  --font-display: var(--font-bricolage-grotesque);
}
```

- [ ] **Step 3: Replace the `body`/heading font rules**

Change the `body` rule's `font-family` to `var(--font-ui)` and the `h1..h6` rule's `font-family` to `var(--font-display)`:
```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-ui), system-ui, -apple-system, sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-ui), system-ui, sans-serif;
}

.font-display {
  font-family: var(--font-display), system-ui, sans-serif;
}
```
(Per the spec: app UI is Manrope; Bricolage is reserved for the entry-page display headline, applied via the `.font-display` utility there.)

- [ ] **Step 4: Add the motion + reduced-motion utilities at the end of the file**

```css
:root {
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.2, 0, 0, 1.2);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 5: Verify the app builds and renders**

Run: `pnpm lint && pnpm build`
Expected: build succeeds (no CSS/TS errors). If `build` requires a DB connection via `scripts/check-db.mjs`, run `pnpm exec next build` to skip the DB check, or ensure `.env` has a DATABASE_URL.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: apply exact KO OS dark-mode design tokens"
```

---

## Task 3: Add Manrope font and update root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Import and configure Manrope**

In `src/app/layout.tsx`, change the font import line to add Manrope:
```ts
import { Bricolage_Grotesque, Manrope, Montserrat } from "next/font/google";
```
Add after the existing font declarations:
```ts
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
```

- [ ] **Step 2: Add the Manrope variable to the `<html>` className**

```tsx
<html
  lang="en"
  className={`${bricolageGrotesque.variable} ${montserrat.variable} ${manrope.variable} h-full antialiased`}
>
```

- [ ] **Step 3: Update metadata to KO OS**

```ts
export const metadata: Metadata = {
  title: "KO OS — Your Brand Brain, powered by KO",
  description:
    "AI-powered content strategies and calendars. Human designers bring them to life.",
};
```

- [ ] **Step 4: Set toaster position per spec (bottom-right desktop)**

Change the `<Toaster>` props:
```tsx
<Toaster position="bottom-right" richColors closeButton />
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.
```bash
git add src/app/layout.tsx
git commit -m "feat: add Manrope font and KO OS metadata"
```

---

## Task 4: Remove off-spec legacy features

This precedes the schema changes so dropping tables won't leave dangling imports. After this task the app must still type-check and build.

**Files:**
- Delete: `src/app/(dashboard)/knowledge/`, `src/app/(dashboard)/requests/`, `src/app/(dashboard)/campaigns/`, `src/components/onboarding/onboarding-wizard.tsx`, `src/lib/ai/campaign-generator.ts`, `src/lib/ai/prompts/campaign.ts`
- Modify: any file importing the deleted modules (resolved in Step 2).

- [ ] **Step 1: Delete the legacy directories and files**

```bash
git rm -r "src/app/(dashboard)/knowledge" "src/app/(dashboard)/requests" "src/app/(dashboard)/campaigns"
git rm src/components/onboarding/onboarding-wizard.tsx
git rm src/lib/ai/campaign-generator.ts src/lib/ai/prompts/campaign.ts
```

- [ ] **Step 2: Find and fix dangling references**

Run: `pnpm exec tsc --noEmit`
Expected: errors only in files that imported the deleted modules. For each error, remove the import and the dead usage (e.g., dashboard quick-action links to `/campaigns`, `/knowledge`, `/requests`; the `requests` server action; query helpers referencing campaigns). Re-run until clean. Leave placeholder links pointing to `/dashboard` where a nav target was removed but the surrounding component must keep rendering.

- [ ] **Step 3: Verify lint + types + build**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove off-spec legacy features (knowledge, requests, campaign generator, onboarding wizard)"
```

---

## Task 5: Pivot the data model (schema)

**Files:**
- Modify: `src/lib/db/schema.ts`

Verified by `drizzle-kit generate` (produces migration SQL) + `tsc`. No runtime DB test in Phase 0 (deferred to feature phases that need a test database).

- [ ] **Step 1: Add new enums**

In `src/lib/db/schema.ts`, after the existing enum declarations, add:
```ts
export const userRoleEnum = pgEnum("user_role", ["user", "designer", "admin"]);

export const strategyStatusEnum = pgEnum("strategy_status", [
  "draft",
  "active",
  "archived",
]);

export const calendarItemStatusEnum = pgEnum("calendar_item_status", [
  "draft",
  "in_progress",
  "ready",
  "published",
]);

export const designTicketStatusEnum = pgEnum("design_ticket_status", [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "design_ready",
  "ticket_status",
  "system",
]);

export const usageKindEnum = pgEnum("usage_kind", [
  "strategy_generated",
  "calendar_generated",
  "design_ticket_created",
]);
```

- [ ] **Step 2: Add `role` to `users`**

In the `users` table definition, add before `createdAt`:
```ts
  role: userRoleEnum("role").notNull().default("user"),
```

- [ ] **Step 3: Add Brand Profile columns to `brands`**

In the `brands` table definition, add before `createdAt`:
```ts
  overview: text("overview"),
  businessType: text("business_type"),
  stage: text("stage"),
  targetAudience: text("target_audience"),
  offer: text("offer"),
  tone: text("tone"),
  primaryGoal: text("primary_goal"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  additionalColors: text("additional_colors").array(),
  logoUrl: text("logo_url"),
```

- [ ] **Step 4: Add the `strategies` table**

After the `brands`-related tables, add:
```ts
export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(
    () => chatConversations.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  structured: jsonb("structured"),
  status: strategyStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 5: Add the `calendars` and `calendar_items` tables**

```ts
export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => strategies.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const calendarItems = pgTable("calendar_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  time: text("time"),
  platform: text("platform").notNull(),
  contentType: text("content_type").notNull(),
  title: text("title").notNull(),
  brief: text("brief"),
  designRequired: boolean("design_required").notNull().default(false),
  designType: text("design_type"),
  dimensions: text("dimensions"),
  status: calendarItemStatusEnum("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 6: Add the `design_tickets` and `design_deliverables` tables**

```ts
export const designTickets = pgTable("design_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketNumber: integer("ticket_number").notNull().unique(),
  calendarItemId: uuid("calendar_item_id").references(
    () => calendarItems.id,
    { onDelete: "set null" },
  ),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedDesignerId: uuid("assigned_designer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  designType: text("design_type").notNull(),
  dimensions: text("dimensions"),
  slides: integer("slides"),
  brief: text("brief").notNull(),
  notes: text("notes"),
  dueDate: timestamp("due_date"),
  status: designTicketStatusEnum("status").notNull().default("submitted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const designDeliverables = pgTable("design_deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => designTickets.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  slideIndex: integer("slide_index"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 7: Add the `notifications` and `usage_events` tables**

```ts
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payload: jsonb("payload"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "set null",
  }),
  kind: usageKindEnum("kind").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 8: Remove dropped tables and the campaign enums**

Delete these table definitions from the file: `campaigns`, `professionalRequests`, `productsServices`, `offers`. Delete the now-unused enums: `campaignTypeEnum`, `campaignDurationEnum`, `campaignStatusEnum`, `productServiceTypeEnum`, `requestStatusEnum`. Keep `chatConversations`, `chatMessages`, `brandAssets`, `assetTypeEnum`, `messageRoleEnum`, `onboardingTypeEnum`, `onboardingStatusEnum`, `brandContextSectionEnum`, `brandContexts`.

- [ ] **Step 9: Type-check the schema**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (Any error here means a deleted table/enum is still referenced — fix the reference, it should have been removed in Task 4.)

- [ ] **Step 10: Generate the migration**

Run: `pnpm db:generate`
Expected: a new SQL file appears under `drizzle/` containing `CREATE TABLE` for the new tables, `ALTER TABLE` for `users`/`brands`, and `DROP TABLE` for the removed tables. Inspect it to confirm it matches the intended changes.

- [ ] **Step 11: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: pivot data model to KO OS schema (strategies, calendars, design tickets, notifications, usage events)"
```

---

## Task 6: Ticket-number helper (TDD)

**Files:**
- Create: `src/lib/ticket-number.ts`, `src/lib/ticket-number.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/ticket-number.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatTicketNumber } from "./ticket-number";

describe("formatTicketNumber", () => {
  it("zero-pads to 5 digits with a DT- prefix", () => {
    expect(formatTicketNumber(124)).toBe("DT-00124");
  });

  it("does not truncate numbers longer than 5 digits", () => {
    expect(formatTicketNumber(123456)).toBe("DT-123456");
  });

  it("handles 1 as DT-00001", () => {
    expect(formatTicketNumber(1)).toBe("DT-00001");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/ticket-number.test.ts`
Expected: FAIL — `formatTicketNumber` is not defined / module not found.

- [ ] **Step 3: Implement the helper**

`src/lib/ticket-number.ts`:
```ts
/** Formats a ticket sequence number as a human-readable id, e.g. DT-00124. */
export function formatTicketNumber(n: number): string {
  return `DT-${String(n).padStart(5, "0")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/ticket-number.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ticket-number.ts src/lib/ticket-number.test.ts
git commit -m "feat: add formatTicketNumber helper"
```

---

## Task 7: Storage helper

**Files:**
- Create: `src/lib/storage.ts`

No unit test (thin wrapper over Supabase client); verified by `tsc`.

- [ ] **Step 1: Create the storage helper**

`src/lib/storage.ts`:
```ts
import { createClient } from "@/lib/supabase/server";

export const STORAGE_BUCKETS = {
  logos: "logos",
  referenceImages: "reference-images",
  deliverables: "deliverables",
} as const;

export type StorageBucket =
  (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Returns a time-limited signed URL for a private object. */
export async function getSignedUrl(
  bucket: StorageBucket,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
```bash
git add src/lib/storage.ts
git commit -m "feat: add Supabase Storage bucket helper"
```

> **Manual setup note (not code):** In the Supabase dashboard, create three private buckets: `logos`, `reference-images`, `deliverables`. RLS policies are added in the phase that first writes to each bucket (logos → Phase 1).

---

## Task 8: Nav source of truth

**Files:**
- Create: `src/lib/nav.ts`

- [ ] **Step 1: Create the nav module**

`src/lib/nav.ts` (icons are `lucide-react` component names, resolved by the sidebar in Task 10):
```ts
import {
  Calendar,
  LayoutDashboard,
  Lightbulb,
  Palette,
  Ticket,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** Primary sidebar items, in the exact order from UI Spec §7.1. */
export const MAIN_NAV: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Brands", href: "/brand", icon: Palette },
  { title: "Campaigns", href: "/strategy", icon: Lightbulb },
  { title: "Calendar", href: "/calendar", icon: Calendar },
  { title: "Design Tickets", href: "/design-request", icon: Ticket },
];
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
```bash
git add src/lib/nav.ts
git commit -m "feat: add sidebar nav source of truth"
```

---

## Task 9: Button variants aligned to the design system (TDD)

**Files:**
- Modify: `src/components/ui/button.tsx`
- Create: `src/components/ui/button.test.tsx`

The existing `button.tsx` is shadcn/CVA-based. We align its variant classes to the spec (§10.1) and add a `ghost`/`icon` variant if missing. The test asserts variant→class mapping via rendered output.

- [ ] **Step 1: Inspect current variants**

Run: `pnpm exec cat src/components/ui/button.tsx` (or open it). Note the existing `variant` keys and the `cva` base. Keep the component API (`variant`, `size`, `asChild`) stable.

- [ ] **Step 2: Write the failing test**

`src/components/ui/button.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Start Creating</Button>);
    expect(
      screen.getByRole("button", { name: "Start Creating" }),
    ).toBeInTheDocument();
  });

  it("applies the primary background by default", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className).toMatch(
      /bg-primary/,
    );
  });

  it("renders a secondary (outline) variant with a border", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const cls = screen.getByRole("button", { name: "Cancel" }).className;
    expect(cls).toMatch(/border/);
    expect(cls).not.toMatch(/bg-primary\b/);
  });

  it("renders a ghost variant with a transparent background", () => {
    render(<Button variant="ghost">More</Button>);
    expect(screen.getByRole("button", { name: "More" }).className).not.toMatch(
      /bg-primary\b/,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/components/ui/button.test.tsx`
Expected: FAIL on the variant assertions if current classes differ from the spec (or PASS on the render test only).

- [ ] **Step 4: Align the variant classes**

In `src/components/ui/button.tsx`, set the `cva` variant map to the design system (radius 10px = `rounded-[10px]`, height 40/44, font 13px/600):
```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:bg-[var(--primary-disabled)] disabled:text-[var(--text-muted)]",
        secondary:
          "bg-transparent text-foreground border border-[var(--border-accent)] hover:bg-[rgba(19,139,200,0.08)] hover:border-[rgba(19,139,200,0.6)]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground",
        icon: "bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground rounded-lg",
      },
      size: {
        default: "h-11 px-5 md:h-10",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-12 px-7",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```
Keep the rest of the component (the `Button` function, `asChild`/Slot handling, exports) unchanged. If a consumer used a removed variant name (e.g. `destructive`/`outline`), update those call sites to `secondary`/`ghost` and re-run `tsc`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/ui/button.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify nothing else broke**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/button.tsx src/components/ui/button.test.tsx
git commit -m "feat: align Button variants to KO OS design system"
```

---

## Task 10: Status badge component (TDD)

**Files:**
- Create: `src/components/ui/status-badge.tsx`, `src/components/ui/status-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/ui/status-badge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the label text", () => {
    render(<StatusBadge status="ready">Ready</StatusBadge>);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("applies a status-specific class for pending", () => {
    render(<StatusBadge status="pending">Pending</StatusBadge>);
    expect(screen.getByText("Pending").className).toMatch(/status-pending/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/ui/status-badge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add status-pill utility classes to `globals.css`**

Append to `src/app/globals.css`:
```css
.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
}
.status-draft { background: var(--status-draft-bg); color: var(--status-draft-fg); }
.status-in_progress { background: var(--status-progress-bg); color: var(--status-progress-fg); }
.status-ready { background: var(--status-ready-bg); color: var(--status-ready-fg); }
.status-published { background: var(--status-progress-bg); color: var(--status-progress-fg); }
.status-pending { background: var(--status-pending-bg); color: var(--status-pending-fg); }
.status-error { background: var(--status-error-bg); color: var(--status-error-fg); }
```

- [ ] **Step 4: Implement the component**

`src/components/ui/status-badge.tsx`:
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "draft"
  | "in_progress"
  | "ready"
  | "published"
  | "pending"
  | "error";

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: BadgeStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("status-badge", `status-${status}`, className)}>
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/ui/status-badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/status-badge.tsx src/components/ui/status-badge.test.tsx src/app/globals.css
git commit -m "feat: add StatusBadge component with design-system status colors"
```

---

## Task 11: Segmented control component (TDD)

**Files:**
- Create: `src/components/ui/segmented-control.tsx`, `src/components/ui/segmented-control.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/ui/segmented-control.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
];

describe("SegmentedControl", () => {
  it("marks the active option with aria-pressed", () => {
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/ui/segmented-control.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`src/components/ui/segmented-control.tsx`:
```tsx
"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-lg bg-[rgba(255,255,255,0.04)] p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors duration-150",
              active
                ? "bg-surface-2 text-foreground"
                : "text-[var(--text-secondary)] hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/ui/segmented-control.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/segmented-control.tsx src/components/ui/segmented-control.test.tsx
git commit -m "feat: add SegmentedControl component"
```

---

## Task 12: Restructure the app sidebar to spec

**Files:**
- Modify: `src/components/layout/app-sidebar.tsx`

Replaces hardcoded nav (and Material Symbols) with `MAIN_NAV` + lucide icons, the KO OS nav background (`#00204F`), 240/72px collapse, and the active-item 2px blue indicator. The existing avatar/logout block is retained.

- [ ] **Step 1: Replace the nav data + icon rendering**

In `src/components/layout/app-sidebar.tsx`, remove the local `mainNavItems`/`bottomNavItems` arrays and the `MaterialIcon` helper. Import the shared nav and lucide:
```tsx
import { MAIN_NAV } from "@/lib/nav";
import { Settings, LogOut } from "lucide-react";
```

- [ ] **Step 2: Update the `<aside>` shell and nav rendering**

Set the sidebar background to `bg-nav` and render `MAIN_NAV` with the active indicator bar:
```tsx
<nav className="flex-1 space-y-1 px-3">
  {MAIN_NAV.map((item) => {
    const Icon = item.icon;
    const isActive =
      item.href === "/dashboard"
        ? pathname === "/dashboard"
        : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors ${
          isActive
            ? "text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
            : "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"
        }`}
      >
        <Icon size={20} strokeWidth={1.75} />
        <span>{item.title}</span>
      </Link>
    );
  })}
</nav>
```
Change the outer `<aside>` className background from `bg-surface` to `bg-nav`, and update the logo subtitle text from "Marketing Intelligence" to "KO OS". Replace the Material Symbols icons in the bottom/logout block with lucide `<Settings size={20} />` and `<LogOut size={20} />`. Remove the "Generate Campaign" CTA button block (the create action moves into the Strategy workspace in Phase 2).

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/app-sidebar.tsx
git commit -m "feat: restructure app sidebar to KO OS nav spec"
```

---

## Task 13: Top bar — notification bell + avatar dropdown

**Files:**
- Modify: `src/components/layout/top-header.tsx`

Adds a notification bell (with unread-dot slot) and an avatar dropdown (Account Settings [disabled], Privacy Policy, Logout) using the existing `dropdown-menu` UI primitive. Page title + active brand name are passed as props (already or newly).

- [ ] **Step 1: Inspect current top-header props**

Open `src/components/layout/top-header.tsx`. Note what props it accepts (title, user). Keep them; add an optional `brandName?: string`.

- [ ] **Step 2: Add the notification bell and avatar dropdown**

Render, on the right side of the bar:
```tsx
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

// ...inside the right section of the header:
<button
  type="button"
  aria-label="Notifications"
  className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
>
  <Bell size={20} />
  {/* Unread dot wired up in Phase 4 */}
</button>

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button
      type="button"
      aria-label="Account menu"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-nav text-[13px] font-semibold text-foreground hover:ring-1 hover:ring-[var(--border-accent)]"
    >
      {initials}
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-[200px]">
    <DropdownMenuItem disabled>Account Settings</DropdownMenuItem>
    <DropdownMenuItem asChild>
      <Link href="/privacy">Privacy Policy</Link>
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        className="w-full px-2 py-1.5 text-left text-[13px] text-[var(--text-secondary)] hover:text-[#d47575]"
      >
        Logout
      </button>
    </form>
  </DropdownMenuContent>
</DropdownMenu>
```
Compute `initials` from the user prop (e.g., `(user.firstName[0] ?? "") + (user.lastName[0] ?? "")`). If `top-header.tsx` does not currently receive `user`, thread it from `src/app/(dashboard)/layout.tsx`.

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/top-header.tsx "src/app/(dashboard)/layout.tsx"
git commit -m "feat: add notification bell and account dropdown to top bar"
```

---

## Task 14: Phase 0 verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors (or only pre-existing warnings unrelated to Phase 0).

- [ ] **Step 3: Test suite**

Run: `pnpm test`
Expected: all tests pass (ticket-number, button, status-badge, segmented-control).

- [ ] **Step 4: Build**

Run: `pnpm exec next build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke (run the app)**

Run: `pnpm dev`, log in, and confirm: the dashboard shell renders with the new dark tokens, the sidebar shows Dashboard / Brands / Campaigns / Calendar / Design Tickets, the active item shows the blue indicator bar, and the avatar dropdown opens with Privacy Policy + Logout. Routes `/strategy`, `/calendar`, `/design-request` will 404 until their phases — that is expected.

- [ ] **Step 6: Tag the phase complete**

```bash
git tag phase-0-foundation
```

---

## Self-Review Notes (author)

**Spec coverage (Phase 0 portion of the design spec §2, §3, §5):** test tooling ✓ (Task 1); exact dark tokens + fonts + motion ✓ (Tasks 2-3); full schema pivot incl. roles, new tables, drops, billing-readiness `usage_events` ✓ (Task 5); storage buckets ✓ (Task 7); route/nav restructure ✓ (Tasks 8, 12, 13); off-spec removal ✓ (Task 4); foundational components ✓ (Tasks 9-11). Feature screens (entry, auth, brand, strategy, calendar, tickets, admin, dashboard, notifications wiring) are intentionally out of Phase 0 and covered by Phases 1-5.

**Placeholder scan:** no TBD/TODO steps; every code step contains complete code; the only deferred item is the unread-dot wiring (explicitly Phase 4) and bucket RLS (explicitly the phase that first writes each bucket) — both are real sequencing decisions, not gaps.

**Type consistency:** `formatTicketNumber` (Task 6) ↔ `designTickets.ticketNumber: integer` (Task 5) align. `MAIN_NAV` (Task 8) ↔ sidebar consumer (Task 12) align. `BadgeStatus` values match `calendarItemStatusEnum`/status tokens. `STORAGE_BUCKETS` keys match the spec's three buckets.
```
