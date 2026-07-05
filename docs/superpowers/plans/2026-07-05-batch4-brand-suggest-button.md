# Batch 4 — Brand Field Suggest/Enhance Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an AI "Suggest / Enhance" button beside five brand-form text fields (overview, target audience, offer, values, differentiators) that fills an empty field from the rest of the brand context, or improves the existing draft — applying the result to the field for the user to edit before saving.

**Architecture:** A new `"brand"` AI feature routes through the existing `getModel(feature)` layer (so it inherits the configured provider, including Bedrock from Batch 3, with optional `AI_BRAND_PROVIDER`/`AI_BRAND_MODEL` overrides). A pure prompt builder (`src/lib/ai/prompts/brand.ts`) owns the single source of truth for which fields are suggestable and their per-field guidance. A new `/api/brand/suggest` route validates the field against that set and returns a suggestion via `generateObject`. A reusable `<SuggestButton>` client component calls the route and applies the result; it's wired under each of the five fields.

**Tech Stack:** Next.js (App Router), Vercel AI SDK v6 (`generateObject`), zod, Vitest + @testing-library/react, Biome.

## Global Constraints

- Test runner: `npm test`. Single: `npx vitest run <path>`. Lint: `npm run lint` (Biome). Typecheck: `npx tsc --noEmit -p tsconfig.json` MUST be clean before every commit (vitest/Biome don't type-check).
- Repo lint has ~36 PRE-EXISTING errors in untouched files; only touched files must be clean.
- Do NOT add dependencies (no npm/pnpm install). Everything needed (`ai`, `zod`, `sonner`, lucide, UI components) is already installed.
- Do NOT add a usage-metering enum value / migration. Metering was optional in the spec; the `usage_kind` enum has no brand value and adding one needs a migration — out of scope. The suggest route does NOT call `recordUsageEvent`.
- The five suggestable fields and their guidance live in ONE place: `BRAND_SUGGEST_FIELDS` in `src/lib/ai/prompts/brand.ts`. The route's validation and the button's typing both derive from it — do not duplicate the field list.
- Suggestable fields (state key → form location): `overview` (step-basics, Textarea `#brand-overview`), `targetAudience` (step-direction, Input `#target-audience`), `offer` (step-direction, Input `#brand-offer`), `values` (step-personality, Input `#brand-values`), `differentiators` (step-competitors, Textarea `#differentiators`).
- One button, two modes: when the field is EMPTY it "Suggests" (fill from context); when it has text it "Enhances" (improve the draft). The mode is derived from `currentValue`.

---

### Task 1: `"brand"` AI feature + brand prompt builder (pure, tested)

**Files:**
- Modify: `src/lib/ai/provider-config.ts` (AiFeature union)
- Modify: `src/lib/ai/provider-config.test.ts` (brand-feature resolution case)
- Create: `src/lib/ai/prompts/brand.ts`
- Test: `src/lib/ai/prompts/brand.test.ts`

**Interfaces:**
- Produces from `brand.ts`:
  - `export const BRAND_SUGGEST_FIELDS` — record keyed by field name with `{ label, guidance }`.
  - `export type BrandSuggestField = keyof typeof BRAND_SUGGEST_FIELDS`.
  - `export interface BrandSuggestContext { name: string; overview: string; businessType: string; stage: string; targetAudience: string; offer: string; tone: string; values: string; differentiators: string; primaryGoal: string }` (all optional-ish strings; caller passes what it has).
  - `export function buildBrandFieldPrompt(args: { field: BrandSuggestField; currentValue: string; context: BrandSuggestContext }): { system: string; prompt: string }`.

- [ ] **Step 1: Add `"brand"` to `AiFeature` + a failing config test**

In `src/lib/ai/provider-config.ts`:
```ts
export type AiFeature = "chat" | "strategy" | "brand";
```
Add to `src/lib/ai/provider-config.test.ts` (inside the existing `describe`):
```ts
  it("resolves a per-feature provider/model for the brand feature", () => {
    const env = {
      AI_PROVIDER: "google",
      AI_MODEL: "gemini-2.5-flash",
      AI_BRAND_PROVIDER: "anthropic",
      AI_BRAND_MODEL: "claude-sonnet-4-5",
    };
    expect(resolveProviderConfig("brand", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("falls the brand feature back to the global provider/model", () => {
    expect(
      resolveProviderConfig("brand", {
        AI_PROVIDER: "google",
        AI_MODEL: "gemini-2.5-flash",
      }),
    ).toEqual({ provider: "google", model: "gemini-2.5-flash" });
  });
```

Run: `npx vitest run src/lib/ai/provider-config.test.ts`
Expected: FAIL — `"brand"` not assignable to `AiFeature` (compile error) until the union is updated. (The union change above fixes it; if you write the test before the union edit, that's the RED.)

- [ ] **Step 2: Write the failing prompt-builder test**

Create `src/lib/ai/prompts/brand.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  BRAND_SUGGEST_FIELDS,
  type BrandSuggestContext,
  buildBrandFieldPrompt,
} from "./brand";

const ctx: BrandSuggestContext = {
  name: "KO Skincare",
  overview: "Clean, affordable skincare for young professionals.",
  businessType: "E-commerce / Product",
  stage: "Early (0–50 customers)",
  targetAudience: "",
  offer: "",
  tone: "Friendly & Educational",
  values: "",
  differentiators: "",
  primaryGoal: "Sales / Conversions",
};

describe("BRAND_SUGGEST_FIELDS", () => {
  it("covers exactly the five suggestable fields", () => {
    expect(Object.keys(BRAND_SUGGEST_FIELDS).sort()).toEqual(
      ["differentiators", "offer", "overview", "targetAudience", "values"].sort(),
    );
  });
});

describe("buildBrandFieldPrompt", () => {
  it("uses SUGGEST mode and includes context when the field is empty", () => {
    const { system, prompt } = buildBrandFieldPrompt({
      field: "targetAudience",
      currentValue: "",
      context: ctx,
    });
    expect(system.toLowerCase()).toContain("suggest");
    // includes the field's human label and brand context
    expect(prompt).toContain(BRAND_SUGGEST_FIELDS.targetAudience.label);
    expect(prompt).toContain("KO Skincare");
  });

  it("uses ENHANCE mode and includes the current draft when the field is set", () => {
    const { system, prompt } = buildBrandFieldPrompt({
      field: "overview",
      currentValue: "we sell face cream",
      context: { ...ctx, overview: "we sell face cream" },
    });
    expect(system.toLowerCase()).toContain("improve");
    expect(prompt).toContain("we sell face cream");
  });
});
```

Run: `npx vitest run src/lib/ai/prompts/brand.test.ts`
Expected: FAIL — module `./brand` not found.

- [ ] **Step 3: Implement `src/lib/ai/prompts/brand.ts`**

```ts
/**
 * Prompt builder for the brand-field "Suggest / Enhance" helper. Single source
 * of truth for WHICH fields are AI-assistable and their per-field guidance;
 * the API route and the SuggestButton both derive from BRAND_SUGGEST_FIELDS.
 */

export const BRAND_SUGGEST_FIELDS = {
  overview: {
    label: "Business Overview",
    guidance:
      "One to two clear sentences on what the business does and who it serves. Concrete, not buzzwordy. Max ~60 words.",
  },
  targetAudience: {
    label: "Target Audience",
    guidance:
      "A specific customer description — demographics, context, and what they care about. One sentence. Max ~40 words.",
  },
  offer: {
    label: "Offer",
    guidance:
      "The core product/service and its value in one concrete line (include a price or format if known). Max ~30 words.",
  },
  values: {
    label: "Brand Values",
    guidance:
      "Three to five short brand values as a comma-separated list. No sentences.",
  },
  differentiators: {
    label: "What You Want to Do Differently",
    guidance:
      "One to two sentences on how this brand differs from competitors. Specific and credible. Max ~50 words.",
  },
} as const;

export type BrandSuggestField = keyof typeof BRAND_SUGGEST_FIELDS;

export interface BrandSuggestContext {
  name: string;
  overview: string;
  businessType: string;
  stage: string;
  targetAudience: string;
  offer: string;
  tone: string;
  values: string;
  differentiators: string;
  primaryGoal: string;
}

function contextLines(context: BrandSuggestContext): string {
  const rows: Array<[string, string]> = [
    ["Brand name", context.name],
    ["Overview", context.overview],
    ["Business type", context.businessType],
    ["Stage", context.stage],
    ["Target audience", context.targetAudience],
    ["Offer", context.offer],
    ["Tone", context.tone],
    ["Values", context.values],
    ["Differentiators", context.differentiators],
    ["Primary goal", context.primaryGoal],
  ];
  return rows
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join("\n");
}

export function buildBrandFieldPrompt({
  field,
  currentValue,
  context,
}: {
  field: BrandSuggestField;
  currentValue: string;
  context: BrandSuggestContext;
}): { system: string; prompt: string } {
  const meta = BRAND_SUGGEST_FIELDS[field];
  const enhancing = currentValue.trim().length > 0;

  const system = enhancing
    ? "You improve a single brand-profile field. Rewrite the user's draft to be clearer, more specific, and on-brand, keeping their intent. Return ONLY the improved field value — no preamble, quotes, or labels."
    : "You suggest a single brand-profile field from the brand context. Return ONLY the field value — no preamble, quotes, or labels.";

  const task = enhancing
    ? `Improve the "${meta.label}" field. Current draft:\n"""${currentValue.trim()}"""`
    : `Write a strong "${meta.label}" field for this brand.`;

  const prompt = [
    task,
    "",
    `Guidance for this field: ${meta.guidance}`,
    "",
    "Brand context:",
    contextLines(context) || "- (little context provided; make a reasonable, concrete suggestion)",
  ].join("\n");

  return { system, prompt };
}
```

- [ ] **Step 4: Run both test files to green**

Run: `npx vitest run src/lib/ai/prompts/brand.test.ts src/lib/ai/provider-config.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add src/lib/ai/provider-config.ts src/lib/ai/provider-config.test.ts src/lib/ai/prompts/brand.ts src/lib/ai/prompts/brand.test.ts
git commit -m "feat(brand): add brand AI feature + field suggest/enhance prompt builder"
```

---

### Task 2: `/api/brand/suggest` route

**Files:**
- Create: `src/app/api/brand/suggest/route.ts`
- Test: `src/app/api/brand/suggest/route.test.ts`

**Interfaces:**
- Consumes: `BRAND_SUGGEST_FIELDS`, `buildBrandFieldPrompt`, `BrandSuggestContext` from `@/lib/ai/prompts/brand`; `getModel` from `@/lib/ai/provider`; `getAuthUser`; `generateObject` from `ai`; `z`.
- Contract: `POST { field, currentValue, context }` → `200 { suggestion: string }` | `400` (unknown field / bad body) | `401` (unauthenticated) | `500` (generation failed).

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/brand/suggest/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({}) }));

import { POST } from "./route";

const context = {
  name: "KO",
  overview: "",
  businessType: "",
  stage: "",
  targetAudience: "",
  offer: "",
  tone: "",
  values: "",
  differentiators: "",
  primaryGoal: "",
};

function req(body: unknown) {
  return new Request("http://x/api/brand/suggest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("brand suggest route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    generateObject.mockResolvedValue({ object: { suggestion: "A crisp line." } });
  });

  it("returns 401 when unauthenticated", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(req({ field: "overview", currentValue: "", context }));
    expect(res.status).toBe(401);
  });

  it("returns a suggestion for a valid field", async () => {
    const res = await POST(req({ field: "overview", currentValue: "", context }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "A crisp line." });
  });

  it("rejects an unknown field with 400", async () => {
    const res = await POST(req({ field: "hacker", currentValue: "", context }));
    expect(res.status).toBe(400);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/app/api/brand/suggest/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 2: Implement the route**

Create `src/app/api/brand/suggest/route.ts`:
```ts
import { generateObject } from "ai";
import { z } from "zod";
import {
  BRAND_SUGGEST_FIELDS,
  type BrandSuggestContext,
  type BrandSuggestField,
  buildBrandFieldPrompt,
} from "@/lib/ai/prompts/brand";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";

const suggestionSchema = z.object({ suggestion: z.string() });

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    field?: string;
    currentValue?: string;
    context?: BrandSuggestContext;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { field, currentValue = "", context } = body;
  if (!field || !(field in BRAND_SUGGEST_FIELDS) || !context) {
    return Response.json({ error: "Invalid field or context" }, { status: 400 });
  }

  const { system, prompt } = buildBrandFieldPrompt({
    field: field as BrandSuggestField,
    currentValue,
    context,
  });

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: suggestionSchema,
      system,
      prompt,
    });
    return Response.json({ suggestion: object.suggestion });
  } catch (err) {
    console.error("brand suggest failed", err);
    return Response.json(
      { error: "Suggestion failed. Please try again." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Run test to green**

Run: `npx vitest run src/app/api/brand/suggest/route.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add src/app/api/brand/suggest/route.ts src/app/api/brand/suggest/route.test.ts
git commit -m "feat(brand): add /api/brand/suggest field suggestion route"
```

---

### Task 3: `<SuggestButton>` component

**Files:**
- Create: `src/app/(dashboard)/brand/create/suggest-button.tsx`
- Test: `src/app/(dashboard)/brand/create/suggest-button.test.tsx`

**Interfaces:**
- Consumes: `BrandSuggestField`, `BrandSuggestContext` from `@/lib/ai/prompts/brand`; `CreateBrandState` from `./brand-form-state`; `toast` from `sonner`.
- Produces: `export function SuggestButton({ field, state, onApply }: { field: BrandSuggestField; state: CreateBrandState; onApply: (text: string) => void })`.

- [ ] **Step 1: Write the failing component test**

Create `src/app/(dashboard)/brand/create/suggest-button.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { SuggestButton } from "./suggest-button";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe("SuggestButton", () => {
  it("labels 'Suggest' when the field is empty and applies the API result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestion: "AI-written overview." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onApply = vi.fn();

    render(
      <SuggestButton
        field="overview"
        state={{ ...DEFAULT_STATE, overview: "" }}
        onApply={onApply}
      />,
    );

    const btn = screen.getByRole("button", { name: /suggest/i });
    fireEvent.click(btn);

    await waitFor(() => expect(onApply).toHaveBeenCalledWith("AI-written overview."));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/brand/suggest",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("labels 'Enhance' when the field already has text", () => {
    render(
      <SuggestButton
        field="overview"
        state={{ ...DEFAULT_STATE, overview: "existing draft" }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /enhance/i })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run "src/app/(dashboard)/brand/create/suggest-button.test.tsx"`
Expected: FAIL — module `./suggest-button` not found.

- [ ] **Step 2: Implement the component**

Create `src/app/(dashboard)/brand/create/suggest-button.tsx`:
```tsx
"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  BrandSuggestContext,
  BrandSuggestField,
} from "@/lib/ai/prompts/brand";
import { cn } from "@/lib/utils";
import type { CreateBrandState } from "./brand-form-state";

function toContext(state: CreateBrandState): BrandSuggestContext {
  return {
    name: state.name,
    overview: state.overview,
    businessType: state.businessType,
    stage: state.stage,
    targetAudience: state.targetAudience,
    offer: state.offer,
    tone: state.tone,
    values: state.values,
    differentiators: state.differentiators,
    primaryGoal: state.primaryGoal,
  };
}

export function SuggestButton({
  field,
  state,
  onApply,
}: {
  field: BrandSuggestField;
  state: CreateBrandState;
  onApply: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const currentValue = state[field];
  const label = currentValue.trim().length > 0 ? "Enhance" : "Suggest";

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/brand/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          currentValue,
          context: toContext(state),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Suggestion failed");
      }
      const data = (await res.json()) as { suggestion: string };
      if (data.suggestion?.trim()) onApply(data.suggestion.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={`${label} with AI`}
      className={cn(
        "inline-flex items-center gap-1 self-start rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--accent-glow)]",
        loading && "opacity-50 cursor-not-allowed",
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {loading ? "Thinking…" : label}
    </button>
  );
}
```

- [ ] **Step 3: Run test to green**

Run: `npx vitest run "src/app/(dashboard)/brand/create/suggest-button.test.tsx"`
Expected: PASS (2 cases).

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add "src/app/(dashboard)/brand/create/suggest-button.tsx" "src/app/(dashboard)/brand/create/suggest-button.test.tsx"
git commit -m "feat(brand): add reusable SuggestButton for brand fields"
```

---

### Task 4: Wire `<SuggestButton>` into the five fields

**Files:**
- Modify: `src/app/(dashboard)/brand/create/step-basics.tsx` (overview)
- Modify: `src/app/(dashboard)/brand/create/step-direction.tsx` (targetAudience, offer)
- Modify: `src/app/(dashboard)/brand/create/step-personality.tsx` (values)
- Modify: `src/app/(dashboard)/brand/create/step-competitors.tsx` (differentiators)
- Test: `src/app/(dashboard)/brand/create/step-basics.test.tsx` (new — proves wiring)

**Interfaces:**
- Consumes: `SuggestButton` from `./suggest-button`. Each step already receives `state` and `onChange`.

- [ ] **Step 1: Write a failing wiring test (step-basics)**

Create `src/app/(dashboard)/brand/create/step-basics.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { StepBasics } from "./step-basics";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("StepBasics AI assist", () => {
  it("renders a Suggest button for the overview field", () => {
    render(<StepBasics state={{ ...DEFAULT_STATE }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /suggest with ai/i }),
    ).toBeInTheDocument();
  });
});
```

Run: `npx vitest run "src/app/(dashboard)/brand/create/step-basics.test.tsx"`
Expected: FAIL — no such button yet.

- [ ] **Step 2: Wire the overview field in `step-basics.tsx`**

Add the import and render `<SuggestButton>` inside the overview `<Field>`, after the `<Textarea>`:
```tsx
import { SuggestButton } from "./suggest-button";
```
```tsx
      <Field
        label="Business Overview *"
        htmlFor="brand-overview"
        hint={`What you do and who it's for. Minimum 20 characters${
          state.overview.length > 0 ? ` (${state.overview.length} / 500)` : ""
        }`}
      >
        <Textarea
          id="brand-overview"
          rows={3}
          placeholder="We make clean, affordable skincare products for young professionals who want effective routines without 20 steps."
          value={state.overview}
          onChange={(e) => onChange({ overview: e.target.value })}
        />
        <SuggestButton
          field="overview"
          state={state}
          onApply={(text) => onChange({ overview: text })}
        />
      </Field>
```

- [ ] **Step 3: Run the wiring test to green**

Run: `npx vitest run "src/app/(dashboard)/brand/create/step-basics.test.tsx"`
Expected: PASS.

- [ ] **Step 4: Wire the remaining four fields (same pattern)**

Add `import { SuggestButton } from "./suggest-button";` to each file and place a `<SuggestButton>` after the field's input, inside its `<Field>`:

`step-direction.tsx` — Target Audience field, after its `<Input>`:
```tsx
        <SuggestButton
          field="targetAudience"
          state={state}
          onApply={(text) => onChange({ targetAudience: text })}
        />
```
`step-direction.tsx` — Offer field, after its `<Input>`:
```tsx
        <SuggestButton
          field="offer"
          state={state}
          onApply={(text) => onChange({ offer: text })}
        />
```
`step-personality.tsx` — Brand Values field, after its `<Input>`:
```tsx
        <SuggestButton
          field="values"
          state={state}
          onApply={(text) => onChange({ values: text })}
        />
```
`step-competitors.tsx` — Differentiators field, after its `<Textarea>`:
```tsx
        <SuggestButton
          field="differentiators"
          state={state}
          onApply={(text) => onChange({ differentiators: text })}
        />
```

- [ ] **Step 5: Full verify + commit**

Run: `npm test` → full suite green.
Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add "src/app/(dashboard)/brand/create/step-basics.tsx" "src/app/(dashboard)/brand/create/step-direction.tsx" "src/app/(dashboard)/brand/create/step-personality.tsx" "src/app/(dashboard)/brand/create/step-competitors.tsx" "src/app/(dashboard)/brand/create/step-basics.test.tsx"
git commit -m "feat(brand): wire SuggestButton into the five assistable fields"
```

**Manual verification note (needs DB + auth + a configured AI provider):** open `/brand/create`, click "Suggest" on an empty field → it fills with a sensible draft; edit a field then click "Enhance" → it improves; both are editable before saving.

---

## Self-Review

**Spec coverage (#2):**
- Suggest + Enhance in one control (mode from currentValue) → Task 3. ✓
- On the five text fields (overview, targetAudience, offer, values, differentiators) → Task 4. ✓
- Uses the provider layer / new `brand` feature (inherits Bedrock) → Task 1. ✓
- Applies to the field, user edits before saving (`onApply` → `onChange`, no auto-save) → Tasks 3 & 4. ✓

**Placeholder scan:** every code step is complete. No metering (deliberate — avoids an unplanned enum migration, noted in Global Constraints).

**Type consistency:** `BRAND_SUGGEST_FIELDS` / `BrandSuggestField` / `BrandSuggestContext` / `buildBrandFieldPrompt` defined in Task 1, consumed by the route (Task 2), the button (Task 3), and — via the button's `field` prop — the wiring (Task 4). `SuggestButton({ field, state, onApply })` signature (Task 3) matches every call site in Task 4. `getModel("brand")` requires the `AiFeature` union change (Task 1 Step 1).

**Known limitation (documented, not a defect):** the suggest route is unauthenticated-rate-limited only by the login gate — a logged-in user could spam it. Acceptable for an internal tool; add rate-limiting if this becomes public. No usage metering this batch (enum migration out of scope).
