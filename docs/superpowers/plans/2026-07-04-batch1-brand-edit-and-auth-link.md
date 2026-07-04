# Batch 1 — Edit-Brand Fix + KO OS Auth Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Edit Brand" pre-fill the user's saved brand and update it in place (instead of opening blank and inserting duplicate rows), provide a safe report of existing duplicate brands, and make the KO OS wordmark on the auth pages link to the landing page.

**Architecture:** Extract the brand form's state shape into a standalone module so a pure `brandToFormState` mapper can reverse a DB brand row into form state without an import cycle. The create page fetches the active brand and passes it to the form as `initialBrand`; the form seeds from it in "edit" mode. The save action is corrected to update the existing brand whenever one exists. A separate read-only Node script reports duplicate brands so the destructive cleanup can be reviewed before it runs.

**Tech Stack:** Next.js (App Router, RSC + client components), Drizzle ORM + Postgres, Vitest + @testing-library/react, Biome (lint/format), custom SQL migration runner (`scripts/migrate.mjs`).

## Global Constraints

- Test runner: `npm test` (`vitest run --passWithNoTests`). Single file: `npx vitest run <path>`.
- Lint/format: `npm run lint` (`biome check .`). Keep import order Biome-clean (see commit `204`).
- Migrations: hand-written SQL in `drizzle/NNNN_name.sql`, applied once in filename order by `scripts/migrate.mjs`; statements separated by `--> statement-breakpoint`; each file runs in one transaction. Do NOT use `db:push`. Next migration number is `0006`.
- Brand fields are stored as free-form text; several selects use the sentinel `OTHER_OPTION = "Other (Specify)"`, and `postingFrequency` uses the sentinel `"Custom"`. Option lists are the source of truth in `src/app/(dashboard)/brand/brand-profile-form.ts`.
- The brand is rendered as the wordmark **"KO OS"** (not "KOOS"). Landing page route is `/` (`src/app/page.tsx`).
- Do not run any destructive SQL against real data without first reviewing the dedupe report output (Task 6).

---

### Task 1: Extract brand form state into a shared module

Enables `brandToFormState` (Task 2) to import `CreateBrandState`/`DEFAULT_STATE` without creating an import cycle with `create-brand-form.tsx`. Pure refactor — no behavior change.

**Files:**
- Create: `src/app/(dashboard)/brand/create/brand-form-state.ts`
- Modify: `src/app/(dashboard)/brand/create/create-brand-form.tsx` (remove the moved declarations, import them instead)

**Interfaces:**
- Produces: `export interface CreateBrandState { … }`, `export const DEFAULT_STATE: CreateBrandState`, `export const STORAGE_KEY = "ko-os:brand-create"` from `brand-form-state.ts`.

- [ ] **Step 1: Create the shared state module**

Create `src/app/(dashboard)/brand/create/brand-form-state.ts` with the exact `CreateBrandState` interface (currently lines 82–121 of `create-brand-form.tsx`), the `DEFAULT_STATE` const (currently lines 123–155), and `STORAGE_KEY`:

```ts
// Shared brand-create form state. Extracted so both the form component and the
// brandToFormState mapper can import it without an import cycle.

export const STORAGE_KEY = "ko-os:brand-create";

export interface CreateBrandState {
  // Section 1 — Business Basics
  name: string;
  overview: string;
  businessType: string;
  businessTypeOther: string;
  stage: string;
  stageOther: string;
  // Section 2 — Brand Direction
  targetAudience: string;
  offer: string;
  tone: string;
  toneOther: string;
  primaryGoal: string;
  // Section 3 — Brand Personality
  values: string;
  wordsLove: string;
  wordsAvoid: string;
  // Section 4 — Visual Identity
  hasLogo: string; // "", "Yes", "No"
  brandStyle: string;
  brandStyleOther: string;
  primaryColor: string;
  secondaryColor: string;
  additionalColors: string[];
  logoUrl: string;
  // Section 5 — Competitors
  competitors: string;
  competitorStrengths: string;
  differentiators: string;
  // Section 6 — Platforms & Posting
  platforms: string[];
  platformsOther: string;
  primaryPlatform: string;
  postingFrequency: string;
  postingFrequencyOther: string;
  // Section 7 — Anything Else
  additionalNotes: string;
  helpfulLinks: string;
}

export const DEFAULT_STATE: CreateBrandState = {
  name: "",
  overview: "",
  businessType: "",
  businessTypeOther: "",
  stage: "",
  stageOther: "",
  targetAudience: "",
  offer: "",
  tone: "",
  toneOther: "",
  primaryGoal: "",
  values: "",
  wordsLove: "",
  wordsAvoid: "",
  hasLogo: "",
  brandStyle: "",
  brandStyleOther: "",
  primaryColor: "#138BC8",
  secondaryColor: "#FFFFFF",
  additionalColors: [],
  logoUrl: "",
  competitors: "",
  competitorStrengths: "",
  differentiators: "",
  platforms: [],
  platformsOther: "",
  primaryPlatform: "",
  postingFrequency: "",
  postingFrequencyOther: "",
  additionalNotes: "",
  helpfulLinks: "",
};
```

- [ ] **Step 2: Update `create-brand-form.tsx` to import them**

In `create-brand-form.tsx`: delete the local `const STORAGE_KEY` (line 19), the `CreateBrandState` interface (lines 82–121), and the `DEFAULT_STATE` const (lines 123–155). Add an import near the other local imports:

```ts
import {
  type CreateBrandState,
  DEFAULT_STATE,
  STORAGE_KEY,
} from "./brand-form-state";
```

Keep the `export interface CreateBrandState` consumers working: `step-*.tsx` components import `CreateBrandState` from `./create-brand-form`. To avoid touching all of them, re-export it from the form file:

```ts
export type { CreateBrandState } from "./brand-form-state";
```

- [ ] **Step 3: Verify no behavior change**

Run: `npm test`
Expected: PASS (same as before — no test targets these files yet).

Run: `npm run lint`
Expected: no errors on the two files.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/brand/create/brand-form-state.ts" "src/app/(dashboard)/brand/create/create-brand-form.tsx"
git commit -m "refactor(brand): extract create-form state into shared module"
```

---

### Task 2: `brandToFormState` reverse-mapper (pure, tested)

Maps a stored brand row back into `CreateBrandState`, reversing the "Other" sentinels and the platform array so the edit form pre-fills correctly.

**Files:**
- Create: `src/app/(dashboard)/brand/create/brand-to-form-state.ts`
- Test: `src/app/(dashboard)/brand/create/brand-to-form-state.test.ts`

**Interfaces:**
- Consumes: `CreateBrandState`, `DEFAULT_STATE` from `./brand-form-state`; option lists + `OTHER_OPTION` from `../brand-profile-form`; `brands` from `@/lib/db/schema`.
- Produces: `export function brandToFormState(brand: typeof brands.$inferSelect): CreateBrandState`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/brand/create/brand-to-form-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { brands } from "@/lib/db/schema";
import { brandToFormState } from "./brand-to-form-state";

type Brand = typeof brands.$inferSelect;

// Minimal row factory — only the fields the mapper reads matter.
function row(overrides: Partial<Brand>): Brand {
  return {
    id: "b1",
    userId: "u1",
    name: "Acme",
    onboardingType: "manual",
    onboardingStatus: "completed",
    completionPercentage: 100,
    overview: "We sell things people love.",
    businessType: null,
    stage: null,
    targetAudience: null,
    offer: null,
    tone: null,
    primaryGoal: null,
    primaryColor: null,
    secondaryColor: null,
    additionalColors: null,
    logoUrl: null,
    values: null,
    wordsLove: null,
    wordsAvoid: null,
    hasLogo: null,
    brandStyle: null,
    competitors: null,
    competitorStrengths: null,
    differentiators: null,
    platforms: null,
    primaryPlatform: null,
    postingFrequency: null,
    additionalNotes: null,
    helpfulLinks: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Brand;
}

describe("brandToFormState", () => {
  it("copies core text fields", () => {
    const s = brandToFormState(row({ name: "Acme", overview: "Hello world" }));
    expect(s.name).toBe("Acme");
    expect(s.overview).toBe("Hello world");
  });

  it("maps a known select value directly, leaving the Other field empty", () => {
    const s = brandToFormState(row({ businessType: "SaaS / Digital Product" }));
    expect(s.businessType).toBe("SaaS / Digital Product");
    expect(s.businessTypeOther).toBe("");
  });

  it("routes a custom select value to the Other sentinel + other field", () => {
    const s = brandToFormState(row({ businessType: "Nonprofit collective" }));
    expect(s.businessType).toBe("Other (Specify)");
    expect(s.businessTypeOther).toBe("Nonprofit collective");
  });

  it("uses the Custom sentinel for a non-standard posting frequency", () => {
    const s = brandToFormState(row({ postingFrequency: "2x / month" }));
    expect(s.postingFrequency).toBe("Custom");
    expect(s.postingFrequencyOther).toBe("2x / month");
  });

  it("splits platforms into known selections and a comma-joined Other field", () => {
    const s = brandToFormState(
      row({ platforms: ["Instagram", "Threads", "Bluesky"] }),
    );
    expect(s.platforms).toContain("Instagram");
    expect(s.platforms).toContain("Other");
    expect(s.platforms).not.toContain("Threads");
    expect(s.platformsOther).toBe("Threads, Bluesky");
  });

  it("maps hasLogo boolean to the Yes/No string", () => {
    expect(brandToFormState(row({ hasLogo: true })).hasLogo).toBe("Yes");
    expect(brandToFormState(row({ hasLogo: false })).hasLogo).toBe("No");
    expect(brandToFormState(row({ hasLogo: null })).hasLogo).toBe("");
  });

  it("falls back to default colors when the row has none", () => {
    const s = brandToFormState(row({ primaryColor: null }));
    expect(s.primaryColor).toBe("#138BC8");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/brand/create/brand-to-form-state.test.ts"`
Expected: FAIL — cannot find module `./brand-to-form-state`.

- [ ] **Step 3: Implement the mapper**

Create `src/app/(dashboard)/brand/create/brand-to-form-state.ts`:

```ts
import type { brands } from "@/lib/db/schema";
import {
  brandStyleOptions,
  businessTypeOptions,
  OTHER_OPTION,
  platformOptions,
  postingFrequencyOptions,
  stageOptions,
  toneOptions,
} from "../brand-profile-form";
import { type CreateBrandState, DEFAULT_STATE } from "./brand-form-state";

type Brand = typeof brands.$inferSelect;

const CUSTOM_OPTION = "Custom"; // postingFrequency's "type your own" sentinel

/**
 * Reverse a stored select value into a {value, other} pair. If the stored value
 * is a known option it is used verbatim; any other non-empty value is treated as
 * a custom entry (select set to the sentinel, text placed in `other`).
 */
function splitOther(
  stored: string | null | undefined,
  options: readonly string[],
  sentinel: string,
): { value: string; other: string } {
  const v = (stored ?? "").trim();
  if (!v) return { value: "", other: "" };
  if (options.includes(v)) return { value: v, other: "" };
  return { value: sentinel, other: v };
}

/** The six selectable platforms (the "Other" entry is not a real platform). */
const KNOWN_PLATFORMS = platformOptions.filter((p) => p !== "Other");

export function brandToFormState(brand: Brand): CreateBrandState {
  const businessType = splitOther(
    brand.businessType,
    businessTypeOptions,
    OTHER_OPTION,
  );
  const stage = splitOther(brand.stage, stageOptions, OTHER_OPTION);
  const tone = splitOther(brand.tone, toneOptions, OTHER_OPTION);
  const brandStyle = splitOther(
    brand.brandStyle,
    brandStyleOptions,
    OTHER_OPTION,
  );
  const posting = splitOther(
    brand.postingFrequency,
    postingFrequencyOptions,
    CUSTOM_OPTION,
  );

  const storedPlatforms = brand.platforms ?? [];
  const known = storedPlatforms.filter((p) => KNOWN_PLATFORMS.includes(p));
  const custom = storedPlatforms.filter((p) => !KNOWN_PLATFORMS.includes(p));
  const platforms = custom.length > 0 ? [...known, "Other"] : known;

  return {
    ...DEFAULT_STATE,
    name: brand.name ?? "",
    overview: brand.overview ?? "",
    businessType: businessType.value,
    businessTypeOther: businessType.other,
    stage: stage.value,
    stageOther: stage.other,
    targetAudience: brand.targetAudience ?? "",
    offer: brand.offer ?? "",
    tone: tone.value,
    toneOther: tone.other,
    primaryGoal: brand.primaryGoal ?? "",
    values: brand.values ?? "",
    wordsLove: brand.wordsLove ?? "",
    wordsAvoid: brand.wordsAvoid ?? "",
    hasLogo: brand.hasLogo === true ? "Yes" : brand.hasLogo === false ? "No" : "",
    brandStyle: brandStyle.value,
    brandStyleOther: brandStyle.other,
    primaryColor: brand.primaryColor ?? DEFAULT_STATE.primaryColor,
    secondaryColor: brand.secondaryColor ?? DEFAULT_STATE.secondaryColor,
    additionalColors: brand.additionalColors ?? [],
    logoUrl: brand.logoUrl ?? "",
    competitors: brand.competitors ?? "",
    competitorStrengths: brand.competitorStrengths ?? "",
    differentiators: brand.differentiators ?? "",
    platforms,
    platformsOther: custom.join(", "),
    primaryPlatform: brand.primaryPlatform ?? "",
    postingFrequency: posting.value,
    postingFrequencyOther: posting.other,
    additionalNotes: brand.additionalNotes ?? "",
    helpfulLinks: brand.helpfulLinks ?? "",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/brand/create/brand-to-form-state.test.ts"`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/brand/create/brand-to-form-state.ts" "src/app/(dashboard)/brand/create/brand-to-form-state.test.ts"
git commit -m "feat(brand): add brandToFormState mapper for edit pre-fill"
```

---

### Task 3: Update the existing brand instead of inserting a duplicate

Fix the save branch and widen `updateBrand`'s column allow-list so every edited field persists.

**Files:**
- Modify: `src/lib/db/queries/index.ts:147-176` (`updateBrand` allow-list)
- Modify: `src/app/(dashboard)/brand/actions.ts:56-60` (branch)
- Test: `src/app/(dashboard)/brand/actions.test.ts` (new)

**Interfaces:**
- Consumes: `getActiveBrandForUser`, `updateBrand`, `createBrand` from `@/lib/db/queries`; `getAuthUser` from `@/lib/auth/get-user`.
- Produces: unchanged `saveBrandProfile` signature; behavior now updates when a brand exists.

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/brand/actions.test.ts`. It mocks the DB + auth layers and asserts that a completed existing brand is UPDATED (not duplicated):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getActiveBrandForUser = vi.fn();
const updateBrand = vi.fn();
const createBrand = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForUser: (id: string) => getActiveBrandForUser(id),
  updateBrand: (id: string, data: unknown) => updateBrand(id, data),
  createBrand: (data: unknown) => createBrand(data),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveBrandProfile } from "./actions";

const validInput = {
  name: "Acme",
  overview: "We help people do the thing they love every single day.",
  businessType: "SaaS / Digital Product",
  stage: "Early (0–50 customers)",
};

describe("saveBrandProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  });

  it("updates the existing brand even when onboarding is completed", async () => {
    getActiveBrandForUser.mockResolvedValue({
      id: "existing-brand",
      onboardingStatus: "completed",
    });
    updateBrand.mockResolvedValue({ id: "existing-brand" });

    const res = await saveBrandProfile(validInput);

    expect(updateBrand).toHaveBeenCalledWith(
      "existing-brand",
      expect.objectContaining({ name: "Acme" }),
    );
    expect(createBrand).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, brandId: "existing-brand" });
  });

  it("creates a new brand when the user has none", async () => {
    getActiveBrandForUser.mockResolvedValue(null);
    createBrand.mockResolvedValue({ id: "new-brand" });

    const res = await saveBrandProfile(validInput);

    expect(createBrand).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", name: "Acme" }),
    );
    expect(updateBrand).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, brandId: "new-brand" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/brand/actions.test.ts"`
Expected: FAIL — first test fails because the current branch calls `createBrand` for a completed brand.

- [ ] **Step 3: Fix the save branch**

In `src/app/(dashboard)/brand/actions.ts`, replace the branch (lines 56–60):

```ts
  const existing = await getActiveBrandForUser(dbUser.id);
  const brand = existing
    ? await updateBrand(existing.id, profile)
    : await createBrand({ userId: dbUser.id, ...profile });
```

- [ ] **Step 4: Widen the `updateBrand` allow-list**

In `src/lib/db/queries/index.ts`, extend the `Pick<...>` in `updateBrand` (lines 150–167) to include every column `profile` sends:

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
      | "values"
      | "wordsLove"
      | "wordsAvoid"
      | "hasLogo"
      | "brandStyle"
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
      | "logoUrl"
      | "competitors"
      | "competitorStrengths"
      | "differentiators"
      | "platforms"
      | "primaryPlatform"
      | "postingFrequency"
      | "additionalNotes"
      | "helpfulLinks"
    >
  >,
) {
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/brand/actions.test.ts"`
Expected: PASS (both cases).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/brand/actions.ts" "src/app/(dashboard)/brand/actions.test.ts" src/lib/db/queries/index.ts
git commit -m "fix(brand): edit updates existing brand instead of inserting a duplicate"
```

---

### Task 4: Pre-fill the edit form from the saved brand

Fetch the active brand server-side and seed the form; in edit mode ignore the localStorage draft and return to `/brand` after saving.

**Files:**
- Modify: `src/app/(dashboard)/brand/create/page.tsx`
- Modify: `src/app/(dashboard)/brand/create/create-brand-form.tsx`
- Test: `src/app/(dashboard)/brand/create/create-brand-form.test.tsx` (new)

**Interfaces:**
- Consumes: `getActiveBrandForUser` from `@/lib/db/queries`; `brandToFormState` from `./brand-to-form-state`; `CreateBrandState`, `DEFAULT_STATE`, `STORAGE_KEY` from `./brand-form-state`.
- Produces: `CreateBrandForm` now accepts `{ initialBrand?: CreateBrandState | null }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/brand/create/create-brand-form.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { CreateBrandForm } from "./create-brand-form";

vi.mock("@/app/(dashboard)/brand/actions", () => ({
  saveBrandProfile: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("CreateBrandForm pre-fill", () => {
  it("shows the saved brand name when initialBrand is provided", () => {
    render(
      <CreateBrandForm
        initialBrand={{ ...DEFAULT_STATE, name: "Saved Brand Co" }}
      />,
    );
    expect(screen.getByDisplayValue("Saved Brand Co")).toBeInTheDocument();
  });

  it("starts blank when no initialBrand is provided", () => {
    render(<CreateBrandForm />);
    expect(screen.queryByDisplayValue("Saved Brand Co")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/brand/create/create-brand-form.test.tsx"`
Expected: FAIL — `CreateBrandForm` does not accept `initialBrand`; name input renders empty.

- [ ] **Step 3: Accept and seed `initialBrand` in the form**

In `create-brand-form.tsx`:

1. Change the signature and state init:

```ts
export function CreateBrandForm({
  initialBrand = null,
}: {
  initialBrand?: CreateBrandState | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<CreateBrandState>(
    initialBrand ?? DEFAULT_STATE,
  );
  const [isPending, startTransition] = useTransition();
  const isEditing = initialBrand !== null;
```

2. Skip the localStorage restore when editing (the saved brand is the source of truth), and don't let the draft-persist effect clobber it before hydration. Replace the restore effect (lines 170–180):

```ts
  // Restore an in-progress draft from localStorage only for a brand-new profile.
  // When editing, the server-provided brand is authoritative, so we ignore drafts.
  useEffect(() => {
    if (isEditing) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CreateBrandState>;
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parse errors
    }
  }, [isEditing]);
```

3. After a successful save, send editors back to `/brand` and new users to `/strategy`. In `handleSubmit`, replace `router.push("/strategy")`:

```ts
        router.push(isEditing ? "/brand" : "/strategy");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/brand/create/create-brand-form.test.tsx"`
Expected: PASS (both cases).

- [ ] **Step 5: Fetch the brand in the page and pass it down**

Replace `src/app/(dashboard)/brand/create/page.tsx` in full:

```tsx
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveBrandForUser } from "@/lib/db/queries";
import { brandToFormState } from "./brand-to-form-state";
import { CreateBrandForm } from "./create-brand-form";

export default async function CreateBrandPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");

  const existing = await getActiveBrandForUser(dbUser.id);
  const initialBrand = existing ? brandToFormState(existing) : null;

  return <CreateBrandForm initialBrand={initialBrand} />;
}
```

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test`
Expected: PASS.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/brand/create/page.tsx" "src/app/(dashboard)/brand/create/create-brand-form.tsx" "src/app/(dashboard)/brand/create/create-brand-form.test.tsx"
git commit -m "feat(brand): pre-fill edit form from saved brand, return to /brand after edit"
```

---

### Task 5: Link the KO OS wordmark to the landing page

Wrap the in-card wordmark on both auth pages in a link to `/`. (The top-bar mark in `(auth)/layout.tsx` already links to `/`.)

**Files:**
- Modify: `src/app/(auth)/login/page.tsx:59-72`
- Modify: `src/app/(auth)/register/page.tsx:77-90`
- Test: `src/app/(auth)/login/page.test.tsx` (new)

**Interfaces:**
- Consumes: `Link` from `next/link` (already imported in `login/page.tsx`; add the import to `register/page.tsx` if absent).

- [ ] **Step 1: Write the failing test**

Create `src/app/(auth)/login/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("../actions", () => ({ login: vi.fn(), signInWithGoogle: vi.fn() }));

describe("LoginPage wordmark", () => {
  it("links the KO OS wordmark to the landing page", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /KO OS — back to home/i });
    expect(link).toHaveAttribute("href", "/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: FAIL — no link with that accessible name (wordmark is a plain `<div>`).

- [ ] **Step 3: Wrap the login wordmark in a link**

In `src/app/(auth)/login/page.tsx`, replace the wordmark block (lines 59–72) — change the outer `<div>` to a `Link`:

```tsx
        {/* KO OS Wordmark */}
        <Link
          href="/"
          aria-label="KO OS — back to home"
          className="flex items-center justify-center gap-2.5 mb-8"
        >
          <div
            aria-hidden="true"
            className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center"
          >
            <span className="text-white text-sm font-extrabold leading-none">
              KO
            </span>
          </div>
          <span className="text-lg font-bold text-foreground tracking-tight">
            KO OS
          </span>
        </Link>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Apply the same change to register**

In `src/app/(auth)/register/page.tsx`, replace the wordmark block (lines 77–90) with the identical `Link` markup from Step 3. Ensure `import Link from "next/link";` is present at the top (add it if missing).

- [ ] **Step 6: Verify + lint**

Run: `npx vitest run "src/app/(auth)/login/page.test.tsx"`
Expected: PASS.

Run: `npm run lint`
Expected: no errors (import order Biome-clean).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(auth)/login/page.tsx" "src/app/(auth)/register/page.tsx" "src/app/(auth)/login/page.test.tsx"
git commit -m "fix(auth): link KO OS wordmark to landing page on login and register"
```

---

### Task 6: Report existing duplicate brands (read-only, gates the cleanup)

Deleting a duplicate brand cascade-deletes its `strategies`, `calendars`, `designTickets`, etc. The edit bug typically left the *older* row holding the real children, so a naive "keep newest" delete would destroy history. This task ships a read-only report so the actual cleanup SQL can be written against real data and reviewed. **No destructive SQL runs in this task.**

**Files:**
- Create: `scripts/dedupe-brands.mjs`

**Interfaces:**
- Consumes: `DIRECT_URL`/`DATABASE_URL` from env; `postgres` (already a dependency, used by `scripts/migrate.mjs`).

- [ ] **Step 1: Write the read-only report script**

Create `scripts/dedupe-brands.mjs`:

```js
/**
 * READ-ONLY report of duplicate brands per user, with child-row counts on each
 * brand. Duplicates were created by the pre-fix "Edit Brand" flow inserting a new
 * row instead of updating. This script does NOT modify anything — its output is
 * the input to the reviewed cleanup migration.
 *
 * Run: node scripts/dedupe-brands.mjs
 */
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("No DIRECT_URL/DATABASE_URL set — nothing to report.");
  process.exit(0);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

const CHILD_TABLES = [
  "brand_contexts",
  "brand_assets",
  "chat_conversations",
  "strategies",
  "calendars",
  "design_tickets",
  "usage_events",
];

try {
  const dupUsers = await sql`
    select user_id, count(*) as brand_count
    from brands
    group by user_id
    having count(*) > 1
    order by count(*) desc`;

  if (dupUsers.length === 0) {
    console.log("✓ No users have duplicate brands.");
    process.exit(0);
  }

  console.log(`Found ${dupUsers.length} user(s) with duplicate brands:\n`);

  for (const { user_id } of dupUsers) {
    const rows = await sql`
      select id, name, onboarding_status, created_at, updated_at
      from brands
      where user_id = ${user_id}
      order by updated_at desc`;

    console.log(`User ${user_id} — ${rows.length} brands:`);
    for (const b of rows) {
      const counts = [];
      for (const t of CHILD_TABLES) {
        const [{ n }] = await sql`
          select count(*)::int as n
          from ${sql(t)}
          where brand_id = ${b.id}`;
        if (n > 0) counts.push(`${t}=${n}`);
      }
      const children = counts.length ? counts.join(", ") : "no children";
      console.log(
        `  • ${b.id}  updated=${b.updated_at.toISOString()}  status=${b.onboarding_status}  (${children})`,
      );
    }
    console.log("");
  }

  console.log(
    "Review the above. The cleanup migration must reassign children to the\n" +
      "surviving row (the one to keep) BEFORE deleting the others, to avoid\n" +
      "cascade-deleting strategies/calendars/tickets.",
  );
} catch (e) {
  console.error(`Report failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
```

- [ ] **Step 2: Run the report against the dev database**

Run: `node scripts/dedupe-brands.mjs`
Expected: either "✓ No users have duplicate brands." or a per-user listing with child-row counts. Capture the output — it decides the survivor per user for the cleanup migration.

- [ ] **Step 3: Commit the report tool**

```bash
git add scripts/dedupe-brands.mjs
git commit -m "chore(brand): add read-only duplicate-brand report script"
```

- [ ] **Step 4: STOP — review before writing the cleanup migration**

Do not proceed to a destructive `drizzle/0006_dedupe_brands.sql` until the Step 2 output is reviewed with the user. The cleanup migration (separate, reviewed step) will, per user, choose a survivor, `UPDATE <child>.brand_id` to the survivor for all seven child tables, then `DELETE` the non-survivor brands — all inside one transaction. Its exact survivor rule depends on the report (keep the row with real children; if children are split across rows, consolidate onto the most-recently-updated). This is intentionally left for a data-informed follow-up.

---

## Self-Review

**Spec coverage (Batch 1 items):**
- #1 pre-fill → Tasks 1, 2, 4. ✓
- #1 update-not-duplicate + widen columns → Task 3. ✓
- #1 dedupe existing → Task 6 (report) + gated follow-up migration. ✓ (destructive step deliberately deferred pending real-data review, per spec's "report counts before destructive action")
- #3 KO OS link on auth pages → Task 5. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" in code steps; every code step shows full code. The only deferred item (Task 6 Step 4) is an explicit, justified human-review gate, not a code placeholder.

**Type consistency:** `CreateBrandState`, `DEFAULT_STATE`, `STORAGE_KEY` defined in Task 1, consumed with the same names in Tasks 2 & 4. `brandToFormState(brand): CreateBrandState` produced in Task 2, consumed in Task 4 Step 5. `CreateBrandForm` prop `{ initialBrand?: CreateBrandState | null }` produced in Task 4, matched by the page in Task 4 Step 5 (passes `CreateBrandState | null`). `updateBrand`/`createBrand`/`getActiveBrandForUser` names match `queries/index.ts`.

**Notes / minor decisions baked in:**
- Editors return to `/brand` after save (new users still go to `/strategy`) — small UX improvement consistent with "edit" semantics.
- `brandToFormState` runs server-side in the RSC page, so no client bundle impact.
