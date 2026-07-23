# Track A — Quick Design Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user submit a single design request before they have completed their brand profile.

**Architecture:** A standalone page at `/design-request/quick` guarded by workspace membership only (never `requireBrand`). It creates a minimal draft brand row if none exists, synthesizes a design-request "conversation" from form fields, reuses the existing `/api/design-brief/generate` job endpoint unchanged, then submits through the existing `/api/design-tickets`. If brief generation fails, the raw form text is submitted as the brief so the user is never blocked by a model call.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM, Zod 4, Vitest + Testing Library, Biome.

## Global Constraints

- Package manager is `corepack pnpm` — the PATH `pnpm` is a Windows binary and crashes installs. Never use `npm install`.
- Tests: `corepack pnpm test`. Lint: `corepack pnpm lint`. Both must pass before every commit.
- Comment norms (`CLAUDE.md`): no "what" comments, only "why" comments for non-obvious logic. Never comment out old code — delete it.
- Dark-first app. Use adaptive CSS custom properties (`var(--text-muted)`, `var(--status-error-fg)`, etc.). Never hardcode light-mode hexes or `text-white` on theme surfaces.
- Zod is v4: use `z.string().refine(...)` with the repo's `isValidEmail`, not the deprecated `z.string().email()`.
- No new dependencies.

## Deviation from the spec

The spec said to reuse the existing Design Brief Card for review. On inspection, `DesignBriefPanel` (`src/app/(dashboard)/strategy/design-brief-panel.tsx`) is hard-bound to a **persisted** `design_briefs` row — it PATCHes `/api/design-briefs/[id]` and keys off `brief.id`. The quick flow has no conversation, and `design_briefs.conversationId` is `NOT NULL`, so there is no row to persist against.

This plan instead builds a **local review step inside the quick form**: the generated brief lives in component state, edits are local, and submission goes straight to `/api/design-tickets` with `briefId: null`. This is smaller than refactoring the panel and needs no schema change.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/design/quick-request.ts` | Pure: input schema, conversation synthesis, fallback brief |
| `src/lib/design/quick-request.test.ts` | Unit tests for the above |
| `src/app/(dashboard)/design-request/quick/actions.ts` | Server action resolving/creating the draft brand |
| `src/app/(dashboard)/design-request/quick/page.tsx` | Server page, workspace guard, prefill data |
| `src/app/(dashboard)/design-request/quick/quick-request-form.tsx` | Client: form → generate → review → submit |
| `src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx` | Component tests |
| `src/app/(dashboard)/dashboard/page.tsx` | Modify: un-gate the Request a Design card |
| `src/app/(dashboard)/brand/create/create-brand-form.tsx` | Modify: add the escape-hatch card |

---

### Task 1: Pure quick-request module

**Files:**
- Create: `src/lib/design/quick-request.ts`
- Test: `src/lib/design/quick-request.test.ts`

**Interfaces:**
- Consumes: `isCarouselType` from `@/lib/design/tickets-ui`, `isValidEmail` from `@/lib/validation/email`
- Produces: `quickRequestSchema` (Zod object), `QuickRequestInput` (type), `buildQuickRequestConversation(input: QuickRequestInput): string`, `fallbackQuickBrief(input: QuickRequestInput): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/design/quick-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildQuickRequestConversation,
  fallbackQuickBrief,
  type QuickRequestInput,
  quickRequestSchema,
} from "./quick-request";

const base: QuickRequestInput = {
  businessName: "Ada Bakes",
  designType: "Instagram Post (1080x1350)",
  description: "A launch announcement for our new sourdough range.",
};

describe("quickRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    expect(quickRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a description that is too short to brief from", () => {
    const result = quickRequestSchema.safeParse({ ...base, description: "logo" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed delivery email", () => {
    const result = quickRequestSchema.safeParse({
      ...base,
      deliveryEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid delivery email", () => {
    const result = quickRequestSchema.safeParse({
      ...base,
      deliveryEmail: "hello@adabakes.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a slide count outside 2-10", () => {
    expect(
      quickRequestSchema.safeParse({ ...base, slides: 11 }).success,
    ).toBe(false);
  });
});

describe("buildQuickRequestConversation", () => {
  it("includes the business name, design type and description", () => {
    const text = buildQuickRequestConversation(base);
    expect(text).toContain("Ada Bakes");
    expect(text).toContain("Instagram Post (1080x1350)");
    expect(text).toContain("new sourdough range");
  });

  it("states that the brand profile is incomplete so the model does not invent facts", () => {
    expect(buildQuickRequestConversation(base)).toContain("not invent");
  });

  it("includes slides only for carousel types", () => {
    const carousel = buildQuickRequestConversation({
      ...base,
      designType: "Instagram Carousel (1080x1350 per slide)",
      slides: 5,
    });
    expect(carousel).toContain("Slides: 5");

    const post = buildQuickRequestConversation({ ...base, slides: 5 });
    expect(post).not.toContain("Slides: 5");
  });

  it("omits optional lines that were not provided", () => {
    const text = buildQuickRequestConversation(base);
    expect(text).not.toContain("Reference image");
    expect(text).not.toContain("Dimensions");
  });
});

describe("fallbackQuickBrief", () => {
  it("carries the user's own description into a markdown brief", () => {
    const brief = fallbackQuickBrief(base);
    expect(brief).toContain("**Details**");
    expect(brief).toContain("new sourdough range");
  });

  it("flags to the designer that the brand profile is incomplete", () => {
    expect(fallbackQuickBrief(base)).toContain("without a completed brand profile");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/design/quick-request.test.ts`
Expected: FAIL — `Failed to resolve import "./quick-request"`

- [ ] **Step 3: Write the implementation**

Create `src/lib/design/quick-request.ts`:

```ts
import { z } from "zod";
import { isCarouselType } from "@/lib/design/tickets-ui";
import { isValidEmail } from "@/lib/validation/email";

/** A design request submitted from the quick form, by a user who has not
 * completed (or even started) their brand profile. */
export const quickRequestSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name"),
  designType: z.string().trim().min(1, "Choose what you need designed"),
  dimensions: z.string().trim().min(1).optional(),
  slides: z.number().int().min(2).max(10).optional(),
  description: z
    .string()
    .trim()
    .min(20, "Describe what you need in at least 20 characters"),
  referenceImageUrl: z.string().trim().min(1).optional(),
  deliveryEmail: z
    .string()
    .trim()
    .refine(isValidEmail, "Enter a valid email address")
    .optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .optional(),
});

export type QuickRequestInput = z.infer<typeof quickRequestSchema>;

/** Render the form submission as a design-request transcript so it can drive
 * the same brief generator the design-mode chat uses, unchanged. */
export function buildQuickRequestConversation(
  input: QuickRequestInput,
): string {
  const lines = [
    `User: I'd like to request a design for ${input.businessName}.`,
    `User: What I need designed: ${input.designType}.`,
  ];
  if (input.dimensions) lines.push(`User: Dimensions: ${input.dimensions}.`);
  if (isCarouselType(input.designType) && input.slides) {
    lines.push(`User: Slides: ${input.slides}.`);
  }
  lines.push(`User: Here are the details: ${input.description}`);
  if (input.referenceImageUrl) {
    lines.push(`User: Reference image: ${input.referenceImageUrl}`);
  }
  if (input.dueDate) lines.push(`User: I need it by ${input.dueDate}.`);
  lines.push(
    "User: I have not filled in my full brand profile yet, so use sensible defaults and do not invent facts about the business.",
  );
  return lines.join("\n");
}

/** The brief submitted when AI polish fails. The whole premise is "one
 * design, no setup" — a model failure must degrade brief quality, never
 * block the request. */
export function fallbackQuickBrief(input: QuickRequestInput): string {
  const sections = [
    `**Request**\n${input.designType} for ${input.businessName}`,
    `**Details**\n${input.description}`,
  ];
  if (input.dimensions) sections.push(`**Dimensions**\n${input.dimensions}`);
  if (isCarouselType(input.designType) && input.slides) {
    sections.push(`**Slides**\n${input.slides}`);
  }
  if (input.referenceImageUrl) {
    sections.push(`**Reference**\n${input.referenceImageUrl}`);
  }
  sections.push(
    "**Note**\nSubmitted without a completed brand profile — confirm brand details with the requester before finalizing.",
  );
  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/design/quick-request.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Lint and commit**

```bash
corepack pnpm lint
git add src/lib/design/quick-request.ts src/lib/design/quick-request.test.ts
git commit -m "feat: pure quick design request module"
```

---

### Task 2: Draft-brand server action

**Files:**
- Create: `src/app/(dashboard)/design-request/quick/actions.ts`

**Interfaces:**
- Consumes: `getActiveWorkspace` from `@/lib/auth/workspace`, `getActiveBrandForMember` and `createBrand` from `@/lib/db/queries`
- Produces: `ensureQuickRequestBrand(businessName: string): Promise<{ ok: true; brandId: string } | { ok: false; error: string }>`

**Why no test file:** this action is a thin composition of two already-tested queries plus an auth guard, with no branching logic worth pinning. Its behavior is covered end-to-end by Task 4's component test (which mocks it) and by manual verification.

- [ ] **Step 1: Write the implementation**

Create `src/app/(dashboard)/design-request/quick/actions.ts`:

```ts
"use server";

import { getActiveWorkspace } from "@/lib/auth/workspace";
import { createBrand, getActiveBrandForMember } from "@/lib/db/queries";

/**
 * Resolve the brand a quick request attaches to. design_tickets.brandId is
 * NOT NULL and no brand row exists until the full onboarding form is
 * submitted, so a user with no brand gets a minimal draft row here.
 *
 * The draft stays invisible to the dashboard: requireBrand gates on
 * onboardingStatus === "completed". saveBrandProfile later takes its
 * `existing` branch and upgrades this same row in place.
 */
export async function ensureQuickRequestBrand(
  businessName: string,
): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser || !workspace) return { ok: false, error: "Not authenticated" };

  const name = businessName.trim();
  if (!name) return { ok: false, error: "Enter your business name" };

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (existing) return { ok: true, brandId: existing.id };

  const brand = await createBrand({
    userId: dbUser.id,
    workspaceId: workspace.id,
    name,
    onboardingStatus: "draft",
    completionPercentage: 0,
  });
  if (!brand) return { ok: false, error: "Could not start your request" };
  return { ok: true, brandId: brand.id };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `actions.ts`

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/design-request/quick/actions.ts"
git commit -m "feat: draft brand resolution for quick design requests"
```

---

### Task 3: Quick-request page and form shell

**Files:**
- Create: `src/app/(dashboard)/design-request/quick/page.tsx`
- Create: `src/app/(dashboard)/design-request/quick/quick-request-form.tsx`
- Test: `src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx`

**Interfaces:**
- Consumes: `quickRequestSchema` and `QuickRequestInput` from Task 1, `DESIGN_TYPE_OPTIONS` / `isCarouselType` from `@/lib/design/tickets-ui`
- Produces: `QuickRequestForm` component with props `{ defaultBusinessName: string; defaultDeliveryEmail: string }`

This task builds the form and its validation only. Generation and submission arrive in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickRequestForm } from "./quick-request-form";

vi.mock("./actions", () => ({
  ensureQuickRequestBrand: vi.fn(async () => ({ ok: true, brandId: "b1" })),
}));

function renderForm() {
  return render(
    <QuickRequestForm
      defaultBusinessName="Ada Bakes"
      defaultDeliveryEmail="hello@adabakes.com"
    />,
  );
}

describe("QuickRequestForm", () => {
  it("prefills the business name and delivery email", () => {
    renderForm();
    expect(screen.getByLabelText(/business name/i)).toHaveValue("Ada Bakes");
    expect(screen.getByLabelText(/delivery email/i)).toHaveValue(
      "hello@adabakes.com",
    );
  });

  it("shows a validation error when the description is too short", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/describe/i), {
      target: { value: "logo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
  });

  it("hides the slides field for non-carousel design types", () => {
    renderForm();
    expect(screen.queryByLabelText(/slides/i)).not.toBeInTheDocument();
  });

  it("shows the slides field once a carousel type is selected", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/what do you need/i), {
      target: { value: "Instagram Carousel (1080x1350 per slide)" },
    });
    expect(screen.getByLabelText(/slides/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run "src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx"`
Expected: FAIL — `Failed to resolve import "./quick-request-form"`

- [ ] **Step 3: Write the form component**

Create `src/app/(dashboard)/design-request/quick/quick-request-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type QuickRequestInput,
  quickRequestSchema,
} from "@/lib/design/quick-request";
import { DESIGN_TYPE_OPTIONS, isCarouselType } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[14px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

const labelCls =
  "mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

interface Draft {
  businessName: string;
  designType: string;
  dimensions: string;
  slides: string;
  description: string;
  deliveryEmail: string;
  dueDate: string;
}

interface QuickRequestFormProps {
  defaultBusinessName: string;
  defaultDeliveryEmail: string;
}

function toInput(draft: Draft): unknown {
  return {
    businessName: draft.businessName,
    designType: draft.designType,
    dimensions: draft.dimensions.trim() || undefined,
    slides:
      isCarouselType(draft.designType) && draft.slides.trim()
        ? Number(draft.slides)
        : undefined,
    description: draft.description,
    deliveryEmail: draft.deliveryEmail.trim() || undefined,
    dueDate: draft.dueDate.trim() || undefined,
  };
}

export function QuickRequestForm({
  defaultBusinessName,
  defaultDeliveryEmail,
}: QuickRequestFormProps) {
  const [draft, setDraft] = useState<Draft>({
    businessName: defaultBusinessName,
    designType: DESIGN_TYPE_OPTIONS[1],
    dimensions: "",
    slides: "",
    description: "",
    deliveryEmail: defaultDeliveryEmail,
    dueDate: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<QuickRequestInput | null>(null);

  function handleContinue() {
    const parsed = quickRequestSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setError(null);
    setAccepted(parsed.data);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={labelCls} htmlFor="quick-business-name">
          Business name
        </label>
        <input
          id="quick-business-name"
          className={inputCls}
          value={draft.businessName}
          onChange={(e) =>
            setDraft({ ...draft, businessName: e.target.value })
          }
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-design-type">
          What do you need designed?
        </label>
        <select
          id="quick-design-type"
          className={inputCls}
          value={draft.designType}
          onChange={(e) => setDraft({ ...draft, designType: e.target.value })}
        >
          {DESIGN_TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {isCarouselType(draft.designType) && (
        <div>
          <label className={labelCls} htmlFor="quick-slides">
            Slides
          </label>
          <input
            id="quick-slides"
            className={inputCls}
            type="number"
            min={2}
            max={10}
            value={draft.slides}
            onChange={(e) => setDraft({ ...draft, slides: e.target.value })}
          />
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="quick-dimensions">
          Dimensions (optional)
        </label>
        <input
          id="quick-dimensions"
          className={inputCls}
          placeholder="e.g. 1080x1350"
          value={draft.dimensions}
          onChange={(e) => setDraft({ ...draft, dimensions: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-description">
          Describe what you need
        </label>
        <textarea
          id="quick-description"
          className={cn(inputCls, "min-h-[140px]")}
          placeholder="What is it for, what should it say, and what should it achieve?"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-delivery-email">
          Delivery email
        </label>
        <input
          id="quick-delivery-email"
          className={inputCls}
          value={draft.deliveryEmail}
          onChange={(e) =>
            setDraft({ ...draft, deliveryEmail: e.target.value })
          }
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-due-date">
          Needed by (optional)
        </label>
        <input
          id="quick-due-date"
          className={inputCls}
          type="date"
          value={draft.dueDate}
          onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}

      <Button
        variant="default"
        size="lg"
        onClick={handleContinue}
        className="w-full justify-center"
      >
        Continue
      </Button>

      {accepted && (
        <p className="text-[13px] text-[var(--text-muted)]">
          Ready to build your brief.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run "src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx"`
Expected: PASS — 4 tests

- [ ] **Step 5: Write the page**

Create `src/app/(dashboard)/design-request/quick/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { QuickRequestForm } from "./quick-request-form";

/** Deliberately guarded by workspace membership only, never requireBrand:
 * this page exists precisely for users whose brand profile is incomplete. */
export default async function QuickDesignRequestPage() {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser || !workspace) redirect("/login");

  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-[28px] font-bold text-foreground">
          Request a Design
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)]">
          Tell us what you need and we'll brief the KO design team. You can
          finish your brand profile later.
        </p>
      </header>

      <QuickRequestForm
        defaultBusinessName={brand?.name ?? ""}
        defaultDeliveryEmail={dbUser.email}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify the full suite and lint**

Run: `corepack pnpm test`
Expected: PASS, no regressions

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/design-request/quick/"
git commit -m "feat: quick design request form and page"
```

---

### Task 4: Generate, review, and submit

**Files:**
- Modify: `src/app/(dashboard)/design-request/quick/quick-request-form.tsx`
- Modify: `src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx`

**Interfaces:**
- Consumes: `ensureQuickRequestBrand` (Task 2), `buildQuickRequestConversation` and `fallbackQuickBrief` (Task 1), `pollGenerationJob` from `@/lib/generation/poll-job`, `Markdown` from `@/components/ui/markdown`
- Produces: nothing consumed by later tasks

**Behavior:** `Continue` now resolves the brand, POSTs to `/api/design-brief/generate`, polls the job, and moves to a review step showing the generated `briefMarkdown`. If generation fails for any reason, it moves to the same review step carrying `fallbackQuickBrief(input)` instead, with a notice. `Submit Request` POSTs to `/api/design-tickets`.

- [ ] **Step 1: Add the failing tests**

Append to `src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx`:

```tsx
import { waitFor } from "@testing-library/react";
import { beforeEach } from "vitest";
import * as pollJob from "@/lib/generation/poll-job";

const VALID_DESCRIPTION =
  "A launch announcement for our new sourdough range, warm and inviting.";

function fillValid() {
  fireEvent.change(screen.getByLabelText(/describe/i), {
    target: { value: VALID_DESCRIPTION },
  });
}

describe("QuickRequestForm generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
      ),
    );
  });

  it("shows the generated brief for review", async () => {
    vi.spyOn(pollJob, "pollGenerationJob").mockResolvedValue({
      brief: {
        title: "Sourdough Launch",
        designType: "Instagram Post (1080x1350)",
        briefMarkdown: "**Objective**\nAnnounce the range.",
      },
      briefId: null,
    });

    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/announce the range/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /submit request/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the raw description when generation fails", async () => {
    vi.spyOn(pollJob, "pollGenerationJob").mockRejectedValue(
      new Error("The AI returned an unusable response. Please try again."),
    );

    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByText(/new sourdough range/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /submit request/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/couldn't polish/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run "src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx"`
Expected: FAIL — no "Submit Request" button; the form still only renders "Ready to build your brief."

- [ ] **Step 3: Replace the form's tail with the generate/review/submit flow**

In `quick-request-form.tsx`, add these imports:

```tsx
import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import {
  buildQuickRequestConversation,
  fallbackQuickBrief,
  type QuickRequestInput,
  quickRequestSchema,
} from "@/lib/design/quick-request";
import { pollGenerationJob } from "@/lib/generation/poll-job";
import { ensureQuickRequestBrand } from "./actions";
```

Add these types above the component:

```tsx
interface GeneratedBrief {
  title: string;
  designType: string;
  dimensions?: string;
  slides?: number;
  briefMarkdown: string;
  notes?: string;
}

interface ReviewState {
  brandId: string;
  input: QuickRequestInput;
  brief: GeneratedBrief;
  /** True when AI polish failed and the raw description is standing in. */
  degraded: boolean;
}
```

Replace the `accepted` state and `handleContinue` with:

```tsx
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);

  async function handleContinue() {
    if (generating) return;
    const parsed = quickRequestSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    const input = parsed.data;
    setError(null);
    setGenerating(true);
    try {
      const brand = await ensureQuickRequestBrand(input.businessName);
      if (!brand.ok) {
        setError(brand.error);
        return;
      }
      let brief: GeneratedBrief;
      let degraded = false;
      try {
        const res = await fetch("/api/design-brief/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId: brand.brandId,
            conversation: buildQuickRequestConversation(input),
          }),
        });
        if (!res.ok) throw new Error("generate request rejected");
        const { jobId } = (await res.json()) as { jobId: string };
        const result = await pollGenerationJob<{ brief: GeneratedBrief }>(
          jobId,
        );
        brief = result.brief;
      } catch {
        // A model failure must not block a request whose entire premise is
        // "one design, no setup" — degrade the brief instead.
        degraded = true;
        brief = {
          title: input.designType,
          designType: input.designType,
          dimensions: input.dimensions,
          slides: input.slides,
          briefMarkdown: fallbackQuickBrief(input),
        };
      }
      setReview({ brandId: brand.brandId, input, brief, degraded });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!review || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/design-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: review.brandId,
          calendarItemId: null,
          briefId: null,
          designType: review.brief.designType,
          dimensions: review.brief.dimensions ?? null,
          slides: review.brief.slides ?? null,
          brief: review.brief.briefMarkdown,
          notes: review.brief.notes ?? null,
          deliveryEmail: review.input.deliveryEmail ?? null,
          dueDate: review.input.dueDate ?? null,
        }),
      });
      const data = (await res.json()) as
        | { ticket: { ticketNumber: number } }
        | { error: string };
      if (!res.ok || !("ticket" in data)) {
        setError(
          ("error" in data && data.error) ||
            "Could not submit your request. Please try again.",
        );
        return;
      }
      setTicketNumber(data.ticket.ticketNumber);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }
```

Change the Continue button to show generation state:

```tsx
      <Button
        variant="default"
        size="lg"
        onClick={handleContinue}
        loading={generating}
        loadingText="Building your brief…"
        className="w-full justify-center"
      >
        Continue
      </Button>
```

Replace the `{accepted && ...}` block with the review step:

```tsx
      {review && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
          <h2 className="text-[16px] font-semibold text-foreground">
            {review.brief.title}
          </h2>
          {review.degraded && (
            <p className="rounded-lg bg-[var(--status-pending-bg)] px-3 py-2 text-[13px] text-[var(--status-pending-fg)]">
              We couldn't polish this into a full brief, so we'll send your
              description as written. The design team will follow up if they
              need more.
            </p>
          )}
          <Markdown className="text-[13px]">
            {review.brief.briefMarkdown}
          </Markdown>
          {ticketNumber === null ? (
            <Button
              variant="default"
              onClick={handleSubmit}
              loading={submitting}
              loadingText="Submitting…"
              className="w-full justify-center"
            >
              Submit Request
            </Button>
          ) : (
            <p className="rounded-lg bg-[var(--status-ready-bg)] px-3 py-2 text-[13px] font-medium text-[var(--status-ready-fg)]">
              Request KO-{ticketNumber} sent to the KO design team.
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run "src/app/(dashboard)/design-request/quick/quick-request-form.test.tsx"`
Expected: PASS — 6 tests

- [ ] **Step 5: Run the full suite and lint**

Run: `corepack pnpm test`
Expected: PASS, no regressions

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/design-request/quick/"
git commit -m "feat: generate, review and submit a quick design request"
```

---

### Task 5: Entry points

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx:226-234`
- Modify: `src/app/(dashboard)/brand/create/create-brand-form.tsx`

**Interfaces:**
- Consumes: the `/design-request/quick` route from Task 3
- Produces: nothing

- [ ] **Step 1: Un-gate the dashboard action card**

In `src/app/(dashboard)/dashboard/page.tsx`, the "Request a Design" entry in `actionCards` currently reads:

```tsx
    setupComplete
      ? {
          icon: Palette,
          tint: "bg-[rgba(151,196,89,0.12)] text-success",
          title: "Request a Design",
          desc: "Chat with KO AI to build a design brief and send it to the design team.",
          href: "/strategy?mode=design",
        }
      : null,
```

Replace it with an always-present card:

```tsx
    {
      icon: Palette,
      tint: "bg-[rgba(151,196,89,0.12)] text-success",
      title: "Request a Design",
      desc: "Chat with KO AI to build a design brief and send it to the design team.",
      href: "/strategy?mode=design",
    },
```

- [ ] **Step 2: Verify the dashboard still renders**

Run: `corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `dashboard/page.tsx`

- [ ] **Step 3: Add the escape hatch to the brand-create form**

In `src/app/(dashboard)/brand/create/create-brand-form.tsx`, add the import:

```tsx
import Link from "next/link";
```

Render this card at the end of the form's outermost container, after the existing step content:

```tsx
      <div className="mt-8 rounded-2xl border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-surface-1 p-5">
        <h4 className="text-[15px] font-bold text-foreground">
          Just need one design right now?
        </h4>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          You can request a single design without finishing your brand
          profile. We'll save what you've entered so far.
        </p>
        <Link
          href="/design-request/quick"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-[var(--status-pending-bg)] px-4 text-[13px] font-semibold text-[var(--status-pending-fg)] transition-colors hover:bg-[rgba(212,169,84,0.28)]"
        >
          Request a Design
        </Link>
      </div>
```

- [ ] **Step 4: Run the full suite and lint**

Run: `corepack pnpm test`
Expected: PASS, no regressions

Run: `corepack pnpm lint`
Expected: no errors

- [ ] **Step 5: Manual verification**

Use the `verify` skill to launch the dev server, then:
1. Sign in as a user with no brand → you land on `/brand/create` → the escape-hatch card is visible.
2. Click through to `/design-request/quick`, fill the form, Continue.
3. Confirm a brief renders, then Submit Request.
4. Confirm the ticket appears at `/admin/tickets`.
5. Return to `/brand/create` and confirm your business name is prefilled.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/page.tsx" "src/app/(dashboard)/brand/create/create-brand-form.tsx"
git commit -m "feat: surface design request entry points before brand completion"
```

---

## Out of scope

- Reference-image upload on the quick form. The spec listed it, but it needs
  `STORAGE_PREFIXES.referenceImages` wiring in `/api/upload` (which only
  accepts logos today) and is not required for a first working request.
  `quickRequestSchema` already carries `referenceImageUrl` so adding the
  control later needs no schema change.
- Relaxing `requireBrand` to admit incomplete brands to the dashboard.
- Persisting quick briefs as `design_briefs` rows.
