# KO OS Phase 1 — Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the public front door and the required first-run experience: the KO OS entry page, polished auth screens, legal pages, the 3 missing UI primitives (color picker, file upload, progress steps), and the forced 3-step Brand Profile (create + view/edit) with a gate that blocks the app until a brand exists.

**Architecture:** Builds on Phase 0 (dark tokens, app shell, schema, nav). Reuses the existing Supabase auth actions (`login`, `signup`, `signInWithGoogle`) and `getAuthUser()`. Adds direct brand-profile persistence (the new `brands.*` columns) alongside the existing `brandContexts` plumbing. Standardizes brand routes on `/brand` + `/brand/create` (per UI spec §6.3 and `MAIN_NAV`), retiring the old `/brands*` pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Drizzle + Postgres (Supabase), @base-ui/react primitives, Vitest + Testing Library, Biome, lucide-react.

**Source of truth:** `docs/superpowers/specs/2026-06-17-ko-os-mvp-design.md` and the UI spec `docs/KO_OS UI.Specification.md` (§8A entry, §8B auth, §8D create brand, §8I privacy, §10.2/10.9 inputs/steps).

**Verification reality (this environment):** No `DATABASE_URL`/Supabase is configured here, so `next build` and runtime/DB flows cannot be executed. Authoritative gates: `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm exec biome check <changed files>`. DB-dependent server actions are built, type-checked, and reviewed but not run-tested; that is expected and called out per task.

**Design tokens available (Phase 0):** surfaces `--background #000D20 / bg-background`, `bg-surface-1 #00162E`, `bg-surface-2 #001F3D`, `bg-nav #00204F`; `bg-primary #138BC8`, `--primary-hover/active/disabled`, `--accent-glow`; text `text-foreground`, `--text-secondary #A7B6C7`, `--text-muted #6F8599`; `--border`, `--border-accent`, `--divider`; `.font-display` utility (Bricolage) for the entry headline. Components: `Button` (default/secondary/ghost/icon), `Input`, `Textarea`, `Label`, `Select`, `Dialog`, `Sheet`, `Tabs`, `StatusBadge`, `SegmentedControl`. `cn` at `@/lib/utils`.

---

## Route decisions (locked)
- **Entry** `/` (public, dark, §8A).
- **Auth** `/login`, `/register` (existing route names kept; UI spec mentions `/auth/login` but the codebase uses `/login` and middleware/links already point there — keep `/login` + `/register`). OAuth callback `/auth/callback` unchanged.
- **Legal** `/privacy`, `/terms` (public).
- **Brand** `/brand` (view/edit active profile) and `/brand/create` (3-step form). **Retire** `/brands`, `/brands/new`, `/brands/[id]`.
- **Forced-brand gate:** authenticated users with no completed brand are redirected to `/brand/create`; the only reachable authed pages until then are `/brand/create` and legal pages.
- Multi-brand: schema supports many brands per user, but Phase 1 treats the most-recently-updated brand as "active." A brand switcher is deferred (Phase 2, per spec §4.2).

---

## File Structure

**Create:**
- `src/components/ui/color-picker.tsx` (+ `.test.tsx`) — swatch + hex input with validation.
- `src/components/ui/file-upload.tsx` (+ `.test.tsx`) — drag/drop + states.
- `src/components/ui/progress-steps.tsx` (+ `.test.tsx`) — horizontal stepper.
- `src/lib/validation/hex.ts` (+ `.test.ts`) — `normalizeHex`/`isValidHex`.
- `src/lib/brand-profile.ts` (+ `.test.ts`) — `BrandProfileInput` type + `brandProfileCompletion()` + `hasCompletedBrand()` pure helper.
- `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/terms/page.tsx` — legal pages (public, dark).
- `src/app/(marketing)/legal-content.tsx` — shared legal section renderer + the privacy/terms copy.
- `src/app/brand/` route group note — brand routes live under `(dashboard)` so they get the app shell: `src/app/(dashboard)/brand/page.tsx` (view/edit), `src/app/(dashboard)/brand/create/page.tsx` (server wrapper), `src/app/(dashboard)/brand/create/create-brand-form.tsx` (client 3-step form), `src/app/(dashboard)/brand/actions.ts` (server actions), `src/app/(dashboard)/brand/brand-profile-form.ts` (shared zod schema + types).

**Modify:**
- `src/app/page.tsx` — replace old landing with KO OS dark entry (§8A).
- `src/lib/db/queries/index.ts` — extend `updateBrand` to accept profile columns; add `getActiveBrandForUser`.
- `src/lib/supabase/middleware.ts` — protected/public route lists.
- `src/app/(dashboard)/layout.tsx` — forced-brand gate + pass active brand name to TopHeader.
- `src/app/(dashboard)/dashboard/page.tsx` — repoint "Create Brand" link to `/brand/create`; brand cards link to `/brand`.
- `src/app/(auth)/login/page.tsx`, `register/page.tsx` — align to §8B, fix a11y issues, "Back to home", Google button.

**Delete:**
- `src/app/(dashboard)/brands/` (whole dir: page, new/, [id]/) — replaced by `/brand`.

---

## Task 1: Hex validation helpers (TDD)

**Files:** Create `src/lib/validation/hex.ts`, `src/lib/validation/hex.test.ts`.

- [ ] **Step 1: Failing test** — `src/lib/validation/hex.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isValidHex, normalizeHex } from "./hex";

describe("normalizeHex", () => {
  it("prefixes a missing #", () => {
    expect(normalizeHex("138BC8")).toBe("#138BC8");
  });
  it("expands 3-char shorthand to 6 and uppercases", () => {
    expect(normalizeHex("#fff")).toBe("#FFFFFF");
  });
  it("returns null for invalid input", () => {
    expect(normalizeHex("nope")).toBeNull();
  });
});

describe("isValidHex", () => {
  it("accepts #RGB and #RRGGBB (any case)", () => {
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#138BC8")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(isValidHex("#12")).toBe(false);
    expect(isValidHex("red")).toBe(false);
  });
});
```
- [ ] **Step 2: Run** `pnpm test src/lib/validation/hex.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/validation/hex.ts`:
```ts
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/** Normalizes to "#RRGGBB" uppercase, or null if invalid. */
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!isValidHex(v)) return null;
  let hex = v.startsWith("#") ? v.slice(1) : v;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
}
```
- [ ] **Step 4: Run** the test → PASS (5).
- [ ] **Step 5: Verify + commit** — `pnpm exec biome check src/lib/validation/hex.ts src/lib/validation/hex.test.ts`; then `git add` both and `git commit -m "feat: add hex color validation helpers"`.

---

## Task 2: Brand-profile types + completion helper (TDD)

**Files:** Create `src/lib/brand-profile.ts`, `src/lib/brand-profile.test.ts`.

Defines the shared brand-profile shape and pure helpers used by the form, server action, and forced-brand gate. `hasCompletedBrand` takes the brand row's `onboardingStatus`.

- [ ] **Step 1: Failing test** — `src/lib/brand-profile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { brandProfileCompletion, hasCompletedBrand } from "./brand-profile";

describe("brandProfileCompletion", () => {
  it("is 100 when all step-1 required fields present", () => {
    expect(
      brandProfileCompletion({
        name: "Killa",
        overview: "Clean skincare for busy people, simple routines.",
        businessType: "ecommerce",
        stage: "pre_launch",
      }),
    ).toBe(100);
  });
  it("is 0 when nothing filled", () => {
    expect(brandProfileCompletion({})).toBe(0);
  });
  it("is partial (50) when half of the 4 required fields present", () => {
    expect(
      brandProfileCompletion({ name: "Killa", overview: "x".repeat(20) }),
    ).toBe(50);
  });
});

describe("hasCompletedBrand", () => {
  it("true only for completed status", () => {
    expect(hasCompletedBrand("completed")).toBe(true);
    expect(hasCompletedBrand("in_progress")).toBe(false);
    expect(hasCompletedBrand("draft")).toBe(false);
    expect(hasCompletedBrand(null)).toBe(false);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/lib/brand-profile.ts`:
```ts
export interface BrandProfileInput {
  name?: string;
  overview?: string;
  businessType?: string;
  stage?: string;
  targetAudience?: string;
  offer?: string;
  tone?: string;
  primaryGoal?: string;
  primaryColor?: string;
  secondaryColor?: string;
  additionalColors?: string[];
  logoUrl?: string;
}

const REQUIRED_FIELDS: (keyof BrandProfileInput)[] = [
  "name",
  "overview",
  "businessType",
  "stage",
];

/** 0-100 based on the 4 step-1 required fields. */
export function brandProfileCompletion(input: BrandProfileInput): number {
  const filled = REQUIRED_FIELDS.filter((f) => {
    const v = input[f];
    return typeof v === "string" && v.trim().length > 0;
  }).length;
  return Math.round((filled / REQUIRED_FIELDS.length) * 100);
}

export function hasCompletedBrand(
  onboardingStatus: string | null | undefined,
): boolean {
  return onboardingStatus === "completed";
}
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Verify + commit** — biome check both; `git commit -m "feat: add brand-profile types and completion helpers"`.

---

## Task 3: Color picker component (TDD)

**Files:** Create `src/components/ui/color-picker.tsx`, `src/components/ui/color-picker.test.tsx`.

Spec §8D color picker: 32px swatch (clicking opens native `type=color`) + hex text input (validates on blur, auto-prefixes `#`, accepts 3/6 char). Invalid → red border + inline error.

**Contract:** `ColorPicker({ value, onChange, label, id }: { value: string; onChange: (hex: string) => void; label?: string; id?: string })`. Uses `normalizeHex`/`isValidHex` from `@/lib/validation/hex`. `"use client"`.

- [ ] **Step 1: Failing test** — `src/components/ui/color-picker.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./color-picker";

describe("ColorPicker", () => {
  it("renders the current hex value in the text input", () => {
    render(<ColorPicker value="#138BC8" onChange={() => {}} label="Primary" />);
    expect(screen.getByLabelText("Primary")).toHaveValue("#138BC8");
  });
  it("normalizes and calls onChange on blur of a valid hex", async () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} label="Primary" />);
    const input = screen.getByLabelText("Primary");
    await userEvent.clear(input);
    await userEvent.type(input, "fff");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("#FFFFFF");
  });
  it("shows an error and does not call onChange for invalid hex", async () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} label="Primary" />);
    const input = screen.getByLabelText("Primary");
    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/valid hex/i)).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/components/ui/color-picker.tsx`. Requirements: local `text` state seeded from `value`; a 32px swatch `<button>` whose background is the current value and which triggers a visually-hidden `<input type="color">` (its `onChange` calls `onChange(normalizeHex(...))` and updates text); a hex `<input>` (labelled via the `label`/`id`, `aria-invalid` when error) that on blur normalizes — if valid calls `onChange(normalized)` and clears error, else sets an inline error `Enter a valid hex color` (`text-[12px] text-[var(--status-error-fg)]`). Use design tokens (swatch `rounded-md border border-[var(--border)]`, input styles consistent with `Input`). Keep it self-contained.
- [ ] **Step 4: Run** → PASS (3).
- [ ] **Step 5: Verify + commit** — tsc, biome check the 2 files; `git commit -m "feat: add ColorPicker component"`.

---

## Task 4: File upload component (TDD)

**Files:** Create `src/components/ui/file-upload.tsx`, `src/components/ui/file-upload.test.tsx`.

Spec §8D file upload states: default (dashed border, upload icon + "Click to upload or drag and drop" + subtext), hover, drag-over, uploaded (thumbnail + name + size + remove), error (bad type/size). MVP scope: handle selection + validation + preview + remove; the actual upload to Supabase Storage is wired by the consumer via the `onFileSelected` callback (keep the component presentational/stateless about transport).

**Contract:** `FileUpload({ accept, maxSizeMb, onFileSelected, onRemove, fileName, previewUrl, error }: { accept?: string; maxSizeMb?: number; onFileSelected: (file: File) => void; onRemove?: () => void; fileName?: string | null; previewUrl?: string | null; error?: string | null })`. `"use client"`. Validates type (against `accept`) and size (`maxSizeMb`, default 5) before calling `onFileSelected`; on violation calls an internal error state with a clear message.

- [ ] **Step 1: Failing test** — `src/components/ui/file-upload.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileUpload } from "./file-upload";

function makeFile(name: string, type: string, sizeBytes: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: sizeBytes });
  return f;
}

describe("FileUpload", () => {
  it("shows the upload prompt by default", () => {
    render(<FileUpload onFileSelected={() => {}} />);
    expect(screen.getByText(/click to upload/i)).toBeInTheDocument();
  });
  it("calls onFileSelected for a valid file", async () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload accept="image/png" maxSizeMb={5} onFileSelected={onFileSelected} />,
    );
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, makeFile("logo.png", "image/png", 1000));
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });
  it("rejects an oversized file with an error and no callback", async () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload accept="image/png" maxSizeMb={1} onFileSelected={onFileSelected} />,
    );
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, makeFile("big.png", "image/png", 5 * 1024 * 1024));
    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/too large|5 ?mb|exceeds/i)).toBeInTheDocument();
  });
  it("shows the filename and a remove button in the uploaded state", async () => {
    const onRemove = vi.fn();
    render(
      <FileUpload onFileSelected={() => {}} fileName="logo.png" onRemove={onRemove} />,
    );
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/components/ui/file-upload.tsx`. Requirements: a label-wrapped dropzone with a visually-hidden `<input type="file" data-testid="file-input" accept={accept}>`; on change/drop, validate type (if `accept` set, file.type must match one of the comma list or its `image/*` wildcard) and size (`file.size <= maxSizeMb*1024*1024`) — on failure set internal error text (`Image is too large (max {maxSizeMb}MB)` / `Unsupported file type`), else clear error and call `onFileSelected(file)`. Drag handlers toggle a drag-over style. When `fileName` is provided, render the uploaded state: a thumbnail (use `previewUrl` if given, else a generic file icon), the `fileName`, and a "Remove" `<button type="button" aria-label="Remove file">` calling `onRemove`. Use dashed border tokens per §8D (`border-2 border-dashed border-[rgba(255,255,255,0.12)]`, hover/drag-over accent). Prefer the internal error, but if the `error` prop is passed, show it too.
- [ ] **Step 4: Run** → PASS (4).
- [ ] **Step 5: Verify + commit** — tsc, biome; `git commit -m "feat: add FileUpload component"`.

---

## Task 5: Progress steps component (TDD)

**Files:** Create `src/components/ui/progress-steps.tsx`, `src/components/ui/progress-steps.test.tsx`.

Spec §10.9: horizontal steps, each circle (24px) + label; active = blue ring/text, completed = filled + check, future = muted; connector line completed=blue.

**Contract:** `ProgressSteps({ steps, current }: { steps: string[]; current: number })` (0-based `current`). Renders an ordered list; current step has `aria-current="step"`.

- [ ] **Step 1: Failing test** — `src/components/ui/progress-steps.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressSteps } from "./progress-steps";

const STEPS = ["Business Basics", "Brand Direction", "Brand Assets"];

describe("ProgressSteps", () => {
  it("renders all step labels", () => {
    render(<ProgressSteps steps={STEPS} current={1} />);
    for (const s of STEPS) expect(screen.getByText(s)).toBeInTheDocument();
  });
  it("marks the current step with aria-current", () => {
    render(<ProgressSteps steps={STEPS} current={1} />);
    expect(screen.getByText("Brand Direction").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/components/ui/progress-steps.tsx` per the contract and §10.9 styling (use `bg-primary` for completed/active accents, `--text-muted` for future, a lucide `Check` icon for completed). `<ol>` with `<li>` per step; `aria-current="step"` on the current `<li>`.
- [ ] **Step 4: Run** → PASS (2).
- [ ] **Step 5: Verify + commit** — tsc, biome; `git commit -m "feat: add ProgressSteps component"`.

---

## Task 6: Extend brand queries (TDD where possible)

**Files:** Modify `src/lib/db/queries/index.ts`.

Two changes: (a) widen `updateBrand`'s accepted fields to include the new profile columns; (b) add `getActiveBrandForUser(userId)` returning the most-recently-updated brand (or null).

- [ ] **Step 1: Inspect** the current `updateBrand` and `getBrandsByUserId` in `src/lib/db/queries/index.ts`.
- [ ] **Step 2: Widen `updateBrand`** — change its `data` param type to also allow the profile columns. Replace the `Partial<Pick<...>>` with:
```ts
export async function updateBrand(
  id: string,
  data: Partial<
    Pick<
      typeof brands.$inferInsert,
      | "name"
      | "onboardingStatus"
      | "completionPercentage"
      | "onboardingType"
      | "overview"
      | "businessType"
      | "stage"
      | "targetAudience"
      | "offer"
      | "tone"
      | "primaryGoal"
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
      | "logoUrl"
    >
  >,
) {
  const [updated] = await db
    .update(brands)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning();
  return updated;
}
```
(Keep the existing body shape; only the type and the `updatedAt` touch matter — match whatever the existing function already does for the update/return.)
- [ ] **Step 3: Add `getActiveBrandForUser`** near `getBrandsByUserId`:
```ts
export async function getActiveBrandForUser(userId: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, userId))
    .orderBy(desc(brands.updatedAt))
    .limit(1);
  return brand ?? null;
}
```
Ensure `desc` is imported from `drizzle-orm` (add to the existing import if missing).
- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit` and `pnpm exec biome check src/lib/db/queries/index.ts`. (No unit test — DB-backed; covered by tsc + review.)
- [ ] **Step 5: Commit** — `git commit -m "feat: extend brand queries with profile columns and getActiveBrandForUser"`.

---

## Task 7: Brand profile schema + server action

**Files:** Create `src/app/(dashboard)/brand/brand-profile-form.ts` (zod schema + types), `src/app/(dashboard)/brand/actions.ts` (server actions). 

- [ ] **Step 1: Create the zod schema** `src/app/(dashboard)/brand/brand-profile-form.ts`:
```ts
import { z } from "zod";

export const businessTypeOptions = [
  "ecommerce", "service", "saas", "creator", "agency", "nonprofit",
  "restaurant", "fashion", "health", "education", "other",
] as const;

export const stageOptions = [
  "pre_launch", "early_growth", "established", "rebranding", "new_product",
] as const;

export const toneOptions = [
  "professional", "friendly", "playful", "bold", "calm",
  "luxurious", "educational", "aspirational",
] as const;

export const primaryGoalOptions = [
  "product_launch", "brand_awareness", "drive_sales", "grow_social",
  "build_email", "reengage", "seasonal", "thought_leadership",
] as const;

export const brandProfileSchema = z.object({
  name: z.string().min(2, "Brand name is required").max(100),
  overview: z.string().min(20, "Give at least a sentence").max(500),
  businessType: z.enum(businessTypeOptions),
  stage: z.enum(stageOptions),
  targetAudience: z.string().max(200).optional().or(z.literal("")),
  offer: z.string().max(200).optional().or(z.literal("")),
  tone: z.enum(toneOptions).optional().or(z.literal("")),
  primaryGoal: z.enum(primaryGoalOptions).optional().or(z.literal("")),
  primaryColor: z.string().optional().or(z.literal("")),
  secondaryColor: z.string().optional().or(z.literal("")),
  additionalColors: z.array(z.string()).optional(),
  logoUrl: z.string().optional().or(z.literal("")),
});

export type BrandProfileValues = z.infer<typeof brandProfileSchema>;
```
- [ ] **Step 2: Create server actions** `src/app/(dashboard)/brand/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createBrand,
  getActiveBrandForUser,
  updateBrand,
} from "@/lib/db/queries";
import { recordUsageEvent } from "@/lib/db/queries"; // add this helper in Step 3 if missing
import { brandProfileSchema } from "./brand-profile-form";

export async function saveBrandProfile(
  raw: unknown,
): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return { ok: false, error: "Not authenticated" };

  const parsed = brandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const profile = {
    name: v.name,
    overview: v.overview,
    businessType: v.businessType,
    stage: v.stage,
    targetAudience: v.targetAudience || null,
    offer: v.offer || null,
    tone: v.tone || null,
    primaryGoal: v.primaryGoal || null,
    primaryColor: v.primaryColor || null,
    secondaryColor: v.secondaryColor || null,
    additionalColors: v.additionalColors ?? null,
    logoUrl: v.logoUrl || null,
    onboardingStatus: "completed" as const,
    completionPercentage: 100,
  };

  const existing = await getActiveBrandForUser(dbUser.id);
  const brand =
    existing && existing.onboardingStatus !== "completed"
      ? await updateBrand(existing.id, profile)
      : await createBrand({ userId: dbUser.id, ...profile });

  revalidatePath("/brand");
  revalidatePath("/dashboard");
  return { ok: true, brandId: brand.id };
}
```
(If `createBrand`'s insert type complains about nullable fields, pass `undefined` instead of `null` for optional string columns — match the column nullability. Verify against `tsc`.)
- [ ] **Step 3: Skip the `recordUsageEvent` import** unless it already exists — remove that import line if there's no such helper yet (usage events for brand creation are not required by spec; only strategy/calendar/ticket events matter, added in later phases). Ensure the file type-checks without it.
- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit`, `pnpm exec biome check` on both new files. `zod` is already a dependency.
- [ ] **Step 5: Commit** — `git commit -m "feat: add brand profile schema and saveBrandProfile action"`.

---

## Task 8: Create Brand 3-step form (UI, §8D)

**Files:** Create `src/app/(dashboard)/brand/create/page.tsx` (server wrapper), `src/app/(dashboard)/brand/create/create-brand-form.tsx` (client).

**Acceptance criteria (from §8D, build to these — write idiomatic JSX with the listed structure/tokens):**
- Page title `Create Your Brand` (32px/700, use `<h1 className="font-display ...">`), subtitle in `--text-secondary`.
- `ProgressSteps` with `["Business Basics", "Brand Direction", "Brand Assets"]`.
- **Step 1 (required):** `name` (Input), `overview` (Textarea), `businessType` (Select, options from `businessTypeOptions` with human labels), `stage` (Select). Next disabled until all four valid (use `brandProfileSchema` partial or simple checks).
- **Step 2 (optional):** `targetAudience` (Input), `offer` (Input), `tone` (Select), `primaryGoal` (Select).
- **Step 3 (optional):** logo via `FileUpload` (accept `image/png,image/svg+xml,image/jpeg`, max 5MB) — on select, upload to Supabase Storage `logos` bucket and set `logoUrl` (use a small client helper that calls a route or the supabase browser client; if storage upload is non-trivial without configured buckets, store the File and upload on submit, and if upload fails show an inline error but allow submit without a logo); `primaryColor`, `secondaryColor` via `ColorPicker`; up to 3 `additionalColors`.
- Buttons: `Previous` (secondary) + `Next`/`Save Brand` (primary). On final submit call `saveBrandProfile(values)`; on `{ok:true}` show success toast (`sonner`) `Brand profile created!` and `router.push("/strategy")` after ~1s; on `{ok:false}` show the error.
- **Persistence:** mirror form state to `localStorage` (`ko-os:brand-create`) on change and restore on mount; clear on successful submit.
- Accessibility: labels tied to inputs, `aria-current` step (via ProgressSteps), visible focus.
- `create/page.tsx` is a server component that checks auth via `getAuthUser()` (redirect `/login` if none) and renders the client form.

- [ ] **Step 1:** Create `create/page.tsx` (server): get `getAuthUser()`, redirect to `/login` if no `dbUser`, else render `<CreateBrandForm />`.
- [ ] **Step 2:** Create `create-brand-form.tsx` (`"use client"`) implementing the criteria above. Use `Button`, `Input`, `Textarea`, `Label`, `Select`, `ProgressSteps`, `ColorPicker`, `FileUpload`, `toast` from `sonner`, `useRouter` from `next/navigation`. Keep the file focused; if it grows beyond ~250 lines, factor each step into a small sub-component in the same folder (e.g. `step-basics.tsx`) — note this in your report.
- [ ] **Step 3:** Logo upload helper — implement a minimal client upload using `createBrowserClient`/the existing `@/lib/supabase/client` to `storage.from("logos").upload(...)` then `getPublicUrl`/signed URL; on any error, set logo error + allow submit without logo. If the Supabase client import path differs, adapt and report.
- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit` and `pnpm exec biome check` on the new files. (No RTL test required for this large screen; the primitives are unit-tested and the action is reviewed. Optionally add a small RTL test that Step 1 Next is disabled until required fields are filled — encouraged but not required.)
- [ ] **Step 5: Commit** — `git commit -m "feat: add 3-step Create Brand form"`.

---

## Task 9: Brand view/edit page (`/brand`)

**Files:** Create `src/app/(dashboard)/brand/page.tsx` (server) and a client editor `src/app/(dashboard)/brand/brand-profile-view.tsx`.

- [ ] **Step 1:** `brand/page.tsx` (server): `getAuthUser()` → redirect `/login` if none; `getActiveBrandForUser(dbUser.id)`; if none or not completed → `redirect("/brand/create")`; else render the profile view with the brand data.
- [ ] **Step 2:** `brand-profile-view.tsx` (`"use client"` if it has edit affordances; otherwise keep server): display name, overview, type, stage, audience, offer, tone, goal, logo thumbnail, color swatches. Provide an "Edit" affordance that links to `/brand/create` pre-filled (the create form already restores from localStorage; for edit, pass the brand via query/prop and seed the form — simplest: reuse the create form in an "edit" mode by passing initial values). Keep MVP simple: a read view + an "Edit profile" button routing to `/brand/create?edit=1`, and have the create form accept optional initial values (server-provided) when editing.
- [ ] **Step 3: Verify** tsc + biome on new files.
- [ ] **Step 4: Commit** — `git commit -m "feat: add brand profile view/edit page"`.

---

## Task 10: Forced-brand gate + route config

**Files:** Modify `src/lib/supabase/middleware.ts`, `src/app/(dashboard)/layout.tsx`.

- [ ] **Step 1: Middleware routes** — in `src/lib/supabase/middleware.ts` set:
```ts
const protectedRoutes = ["/dashboard", "/brand", "/strategy", "/calendar", "/design-request", "/chat", "/settings"];
const authRoutes = ["/login", "/register"];
```
(Public: `/`, `/privacy`, `/terms`, `/auth/callback` — ensure these are NOT matched as protected.)
- [ ] **Step 2: Forced-brand gate** — in `src/app/(dashboard)/layout.tsx`, after resolving `dbUser`, fetch `getActiveBrandForUser(dbUser.id)`. Compute `hasBrand = hasCompletedBrand(activeBrand?.onboardingStatus)`. Read the current path (the layout can't read pathname server-side directly; instead, gate inside each page OR use a server check in the layout via `headers()`/`next/headers` `x-…`). Simpler robust approach: implement the gate in a small server helper `requireBrand()` used by `/dashboard`, `/strategy`, `/calendar`, `/design-request` pages (redirect to `/brand/create` when no completed brand), and DO NOT gate `/brand/create`. For Phase 1, add `requireBrand()` to `src/lib/auth/require-brand.ts` and call it at the top of `dashboard/page.tsx`. Pass `activeBrand?.name` to `TopHeader` via the layout for the brand-name display.
```ts
// src/lib/auth/require-brand.ts
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveBrandForUser } from "@/lib/db/queries";
import { hasCompletedBrand } from "@/lib/brand-profile";

export async function requireBrand() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");
  const brand = await getActiveBrandForUser(dbUser.id);
  if (!hasCompletedBrand(brand?.onboardingStatus)) redirect("/brand/create");
  return { dbUser, brand };
}
```
- [ ] **Step 3:** Call `requireBrand()` at the top of `src/app/(dashboard)/dashboard/page.tsx` (replacing its own auth fetch where appropriate). Update the layout to fetch the active brand and pass `brandName` to `TopHeader`.
- [ ] **Step 4: Verify** tsc + biome on changed files.
- [ ] **Step 5: Commit** — `git commit -m "feat: forced-brand gate and protected route config"`.

---

## Task 11: Entry page (§8A)

**Files:** Modify `src/app/page.tsx`.

**Acceptance criteria (§8A):** dark (`bg-background`) full-viewport two-column on desktop (55/45), single column on mobile. Left: KO OS wordmark (blue circle "KO" + "OS"), headline `Your Brand Brain — powered by KO.` (use `.font-display`, ~48px desktop / 36px mobile, white), description `AI-powered content strategies and calendars. Human designers bring them to life.` (`--text-secondary`), CTA row: `Login` (secondary/outline → `/login`) + `Start Creating` (primary → `/register`), footer `Privacy Policy` link (`--text-muted` → `/privacy`). Right: ambient panel (`bg-surface-1`) with a slowly rotating/pulsing KO mark at low opacity (respect `prefers-reduced-motion` — the Phase 0 media query already neutralizes animations). Server component: if `getAuthUser()` has a `dbUser`, `redirect("/dashboard")` (the dashboard gate then forwards to `/brand/create` if needed).

- [ ] **Step 1:** Replace `src/app/page.tsx` content with the entry page meeting the criteria. Keep it a server component for the auth redirect; the ambient visual is CSS-only (no client JS needed). Use `next/link` for CTAs.
- [ ] **Step 2: Verify** tsc + biome on `src/app/page.tsx`.
- [ ] **Step 3: Commit** — `git commit -m "feat: KO OS dark entry page"`.

---

## Task 12: Auth screens alignment (§8B) + a11y fixes

**Files:** Modify `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`.

The pages are already dark and call the server actions. Bring them to §8B and fix the Phase-0-flagged lint (`useValidAnchor`, `noSvgWithoutTitle`).

- [ ] **Step 1:** Login: centered card (`max-w-[420px]`, `bg-surface-1`, `rounded-2xl`, `border`), KO OS wordmark, title `Welcome back`, subtitle, Email + Password (with show/hide eye toggle button, `aria-label`), `Sign In` primary full-width with loading state, divider `or`, Google button calling `signInWithGoogle`, `Need an account? Create one.` link to `/register`, ghost `Back to home` → `/`. Fix any bare `<a href="#">` (use `<Link>` or a `<button>`), and give any decorative `<svg>` a `<title>` or `aria-hidden`.
- [ ] **Step 2:** Register: same shell; title `Create your account`; fields First Name, Last Name, Email, Password; `Create Account`; `Already have an account? Sign in.` → `/login`; Google button. Keep calling the existing `signup` action with the same FormData field names (`email`, `password`, `firstName`, `lastName`).
- [ ] **Step 3:** Keep both as client components managing `error`/`loading`. Ensure the action call sites still match the server action signatures (FormData). Do not change the server actions.
- [ ] **Step 4: Verify** tsc + biome on both files (must be clean — these previously had lint errors; resolve them).
- [ ] **Step 5: Commit** — `git commit -m "feat: align auth screens to KO OS spec and fix a11y"`.

---

## Task 13: Legal pages (§8I) + retire old brand routes

**Files:** Create `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/terms/page.tsx`, `src/app/(marketing)/legal-content.tsx`. Delete `src/app/(dashboard)/brands/`. Update links.

- [ ] **Step 1:** Create `legal-content.tsx` exporting a `LegalPage({ title, lastUpdated, sections })` renderer (dark, max-width 680px, `--text-secondary` body, section headings 18px/600) and two content constants `PRIVACY_SECTIONS` and `TERMS_SECTIONS` derived from the PDRAP legal modules (Privacy: Information We Collect, How We Use It, Third-Party AI Processing, Data Retention, Your Rights, Contact. Terms: Acceptance, Ownership of AI Outputs, AI "As-Is" Disclaimer, Beta Notice, Limitation of Liability, Prohibited Uses, Contact). Use concise, plain-language placeholder-free copy grounded in the PDRAP doc.
- [ ] **Step 2:** `privacy/page.tsx` and `terms/page.tsx` render `LegalPage` with the respective content + a `Back` link to `/`. Public (no auth). Include a "Last updated: June 17, 2026" line.
- [ ] **Step 3: Delete** `src/app/(dashboard)/brands/` (whole dir). Fix references: the dashboard "Create Brand" link → `/brand/create`; any brand card link → `/brand`; remove the dashboard layout's hardcoded `/brands/new` header button (point to `/brand/create`). Run `grep -rn "/brands" src` → none should remain (except possibly historical strings; remove dead ones). Run `pnpm exec tsc --noEmit` and fix dangling refs.
- [ ] **Step 4: Verify** tsc + biome on all changed/new files; `grep -rn "/brands\b" src` empty.
- [ ] **Step 5: Commit** — `git commit -m "feat: add legal pages and retire old /brands routes"`.

---

## Task 14: Phase 1 verification gate

- [ ] **Step 1:** `pnpm exec tsc --noEmit` → clean.
- [ ] **Step 2:** `pnpm test` → all pass (Phase 0's 11 + new: hex 5, brand-profile 4, color-picker 3, file-upload 4, progress-steps 2 = ~29).
- [ ] **Step 3:** `pnpm exec biome check` on every file created/modified in Phase 1 → clean.
- [ ] **Step 4:** Manual route sanity (static reasoning, since no DB to run): confirm `/`, `/login`, `/register`, `/privacy`, `/terms` are public; `/brand/create` reachable when authed without a brand; `/dashboard` et al. redirect to `/brand/create` when no completed brand; nav `/brand` resolves. Note in the report that runtime verification requires a configured DB.
- [ ] **Step 5:** `git tag phase-1-front-door`.

---

## Self-Review Notes (author)
- **Spec coverage:** entry §8A (T11), auth §8B (T12), create brand §8D (T8, with primitives T3-T5 and schema/action T7), brand view/edit (T9), forced gate §3.3 (T10), legal §8I (T13), route standardization (T10, T13). Primitives color-picker/file-upload/progress-steps fill the Phase-0-identified gaps.
- **Coherence:** `brandProfileSchema` enum options ↔ form Selects ↔ `updateBrand` columns ↔ `BrandProfileInput`; `hasCompletedBrand` ↔ `requireBrand` ↔ `saveBrandProfile` setting `onboardingStatus:"completed"`; `getActiveBrandForUser` used by gate + view.
- **Known environment limit:** DB-dependent tasks (6, 7, 8, 9, 10, parts of 12) are type-checked + reviewed, not run-tested; flagged in T14.
- **Risk:** logo upload depends on a configured `logos` bucket; the form degrades gracefully (submit without logo) if upload fails.
