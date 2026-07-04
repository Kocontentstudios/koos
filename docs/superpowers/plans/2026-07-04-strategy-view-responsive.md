# Strategy View — Responsive Single-Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected/generated strategy render in one fully-scrollable, responsive surface (the right-side `StrategyPanel`) so it never crowds or clips the chat, while preserving the refine→rebuild loop.

**Architecture:** Remove the tall, non-scrolling inline `StrategyCard` from the chat column. The `StrategyPanel` — already a scrollable side panel on desktop and a fixed overlay drawer on mobile — becomes the single strategy surface. Move the card's "Edit strategy" action into the panel footer so clearing the strategy (to rebuild after refining) still works. Auto-open the mobile drawer / re-expand the desktop panel when a strategy loads.

**Tech Stack:** Next.js 16 App Router, React 19, Vercel AI SDK (`@ai-sdk/react` `useChat`), Tailwind (CSS vars), Biome (lint/format), Vitest + React Testing Library (jsdom).

## Global Constraints

- Package manager / scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test` (`vitest run --passWithNoTests`); typecheck = `npx tsc --noEmit`.
- Styling: use existing CSS-variable tokens (`var(--border)`, `bg-surface-1`, `text-foreground`, `var(--status-error-*)`, etc.) — no hardcoded light hexes or `text-white` on theme surfaces (dark-first app; those vanish in light mode).
- Responsive breakpoint: `lg` is the desktop/mobile split already used throughout this feature. Keep it.
- Do not change strategy generation, the AI prompt, the `Strategy` schema, or server actions.
- Frequent commits: one commit per task.

---

### Task 1: Fix Vitest component-test module resolution

The component (`.tsx`) test suite cannot run in this checkout: `vitest.config.ts` aliases React to a hardcoded absolute path from a different machine (`/home/oluwaseyi/dev247/project/koos/node_modules`), which does not exist here, so `react/jsx-dev-runtime` fails to resolve. Point the alias at this repo's own `node_modules` (portable, correct for any checkout). Without this, Tasks 2–3 cannot be tested.

**Files:**
- Modify: `vitest.config.ts:6`

**Interfaces:**
- Consumes: nothing.
- Produces: a working component-test harness. Enables `render()` of any `.tsx` under `src/**`.

- [ ] **Step 1: Confirm the existing component test currently fails**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-card.test.tsx"`
Expected: FAIL — `Failed to resolve import "react/jsx-dev-runtime"`.

- [ ] **Step 2: Repoint the node_modules alias to the local repo**

In `vitest.config.ts`, replace the hardcoded constant:

```ts
// Point to this repo's node_modules to avoid duplicate React instances
const mainNodeModules = resolve(__dirname, "node_modules");
```

(`resolve` is already imported from `node:path` at the top of the file. Remove the old `const mainNodeModules = "/home/oluwaseyi/dev247/project/koos/node_modules";` line entirely.)

- [ ] **Step 3: Confirm the existing component test now passes**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-card.test.tsx"`
Expected: PASS — 3 tests pass.

- [ ] **Step 4: Confirm the full suite still passes**

Run: `npm test`
Expected: PASS — all test files pass (no regressions in the `.ts` suites).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "test: point vitest react alias at local node_modules so component tests run"
```

---

### Task 2: Add an "Edit strategy" action to StrategyPanel; make the mobile sheet full-width

The inline `StrategyCard` (removed in Task 3) is currently the only place the user can clear the loaded strategy to rebuild after refining. Move that affordance into the panel footer so the loop survives once the card is gone. Also widen the mobile drawer to a full-width sheet per the spec ("full-screen scrollable overlay").

**Files:**
- Modify: `src/app/(dashboard)/strategy/strategy-panel.tsx`
- Test: `src/app/(dashboard)/strategy/strategy-panel.test.tsx` (create)

**Interfaces:**
- Consumes: `Strategy` type from `@/lib/ai/strategy-schema`; `Button` from `@/components/ui/button`.
- Produces: `StrategyPanel` gains a required prop `onEdit: () => void`. Its footer renders a secondary button labeled "Edit strategy" (wired to `onEdit`) above the existing "Generate Calendar" button, whenever `strategy` is non-null. The mobile drawer `<aside>` is full-width (`w-full`).

- [ ] **Step 1: Write the failing test**

Create `src/app/(dashboard)/strategy/strategy-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { StrategyPanel } from "./strategy-panel";

const S: Strategy = {
  campaignName: "The Fresh Drop",
  objective: "Drive 300+ pre-orders",
  targetAudience: "Women 22-38",
  keyMessage: "Clean beauty in 3 steps",
  channels: [{ name: "Instagram", rationale: "Buzz" }],
  contentMix: [{ type: "Carousel", count: 6 }],
  timeline: [{ phase: "Teaser", dateRange: "Days 1-7", focus: "Anticipation" }],
  themes: [{ title: "BTS", description: "Sourcing" }],
  postingSchedule: [{ channel: "Instagram", cadence: "Tue/Thu" }],
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof StrategyPanel>> = {}) {
  const props = {
    strategy: S,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onGenerateCalendar: vi.fn(),
    generating: false,
    calendarError: null,
    mobileOpen: false,
    onMobileClose: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  };
  render(<StrategyPanel {...props} />);
  return props;
}

describe("StrategyPanel", () => {
  it("renders an Edit strategy button when a strategy is present and fires onEdit", async () => {
    const props = renderPanel();
    const editButtons = screen.getAllByRole("button", { name: /edit strategy/i });
    expect(editButtons.length).toBeGreaterThan(0);
    await userEvent.click(editButtons[0]);
    expect(props.onEdit).toHaveBeenCalled();
  });

  it("does not render Edit strategy when there is no strategy", () => {
    renderPanel({ strategy: null });
    expect(screen.queryByRole("button", { name: /edit strategy/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-panel.test.tsx"`
Expected: FAIL — TypeScript/prop error on `onEdit` and/or no "Edit strategy" button found.

- [ ] **Step 3: Add the `onEdit` prop and thread it into the footer**

In `src/app/(dashboard)/strategy/strategy-panel.tsx`:

(a) Add `onEdit` to `StrategyPanelProps` (after `onGenerateCalendar`):

```tsx
interface StrategyPanelProps {
  strategy: Strategy | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onGenerateCalendar: () => void;
  onEdit: () => void;
  generating: boolean;
  calendarError: string | null;
  /** Mobile drawer open state (below the lg breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}
```

(b) Add `onEdit` to `PanelContent`'s props and render the secondary button in the footer. Replace the `PanelContent` signature and footer block:

```tsx
function PanelContent({
  strategy,
  onGenerateCalendar,
  onEdit,
  generating,
  calendarError,
  headerAction,
}: {
  strategy: Strategy | null;
  onGenerateCalendar: () => void;
  onEdit: () => void;
  generating: boolean;
  calendarError: string | null;
  headerAction: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h3 className="text-[14px] font-semibold text-foreground">
          Strategy Summary
        </h3>
        {headerAction}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <PanelBody strategy={strategy} />
      </div>

      {strategy && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
          {calendarError && (
            <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
              {calendarError}
            </p>
          )}
          <Button
            variant="default"
            onClick={onGenerateCalendar}
            loading={generating}
            loadingText="Generating…"
            className="w-full justify-center"
          >
            <Calendar className="size-4" />
            Generate Calendar
          </Button>
          <Button
            variant="secondary"
            onClick={onEdit}
            className="w-full justify-center"
          >
            Edit strategy
          </Button>
        </div>
      )}
    </>
  );
}
```

(c) Pass `onEdit` down from `StrategyPanel` into BOTH `PanelContent` usages (desktop expanded aside and mobile drawer). In the desktop expanded block (around line 223) and the mobile drawer block (around line 258), add `onEdit={onEdit}` alongside the existing `onGenerateCalendar={onGenerateCalendar}`. Also destructure `onEdit` in the `StrategyPanel` function params:

```tsx
export function StrategyPanel({
  strategy,
  collapsed,
  onToggleCollapsed,
  onGenerateCalendar,
  onEdit,
  generating,
  calendarError,
  mobileOpen,
  onMobileClose,
}: StrategyPanelProps) {
```

(d) Make the mobile drawer full-width. Change the mobile `<aside>` className (around line 254) from `"fixed inset-y-0 right-0 z-50 flex w-[320px] max-w-[85vw] flex-col ..."` to:

```tsx
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border)] bg-surface-1 transition-transform duration-200 lg:hidden",
          mobileOpen ? "translate-x-0" : "translate-x-full",
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-panel.test.tsx"`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors for `strategy-panel.tsx` / `strategy-panel.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/strategy/strategy-panel.tsx" "src/app/(dashboard)/strategy/strategy-panel.test.tsx"
git commit -m "feat(strategy): add Edit strategy action to panel; full-width mobile sheet"
```

---

### Task 3: Remove the inline StrategyCard; wire panel auto-open on load; delete dead card

Delete the inline card block from the chat column (the crowding/clipping cause), wire the panel's new `onEdit`, and auto-surface the strategy when it loads (open the mobile drawer, re-expand the desktop panel). Then delete the now-unused `StrategyCard` component and its test.

**Files:**
- Modify: `src/app/(dashboard)/strategy/strategy-client.tsx`
- Delete: `src/app/(dashboard)/strategy/strategy-card.tsx`
- Delete: `src/app/(dashboard)/strategy/strategy-card.test.tsx`

**Interfaces:**
- Consumes: `StrategyPanel` with its new required `onEdit` prop (from Task 2).
- Produces: chat column no longer renders any strategy block; `StrategyPanel` receives `onEdit={() => { setStrategy(null); setSummaryOpen(false); }}`; `handleSelectStrategy` and `handleBuildStrategy` set `setSummaryOpen(true)` and `setPanelCollapsed(false)` on success.

- [ ] **Step 1: Confirm StrategyCard has no other consumers**

Run: `git grep -n "StrategyCard\|strategy-card" -- "src/**/*.tsx" "src/**/*.ts"`
Expected: matches only in `strategy-client.tsx` (import + inline usage) and the `strategy-card.*` files themselves. If any other file imports it, STOP and revise (do not delete a still-used component).

- [ ] **Step 2: Remove the `StrategyCard` import**

In `src/app/(dashboard)/strategy/strategy-client.tsx`, delete line 16:

```tsx
import { StrategyCard } from "./strategy-card";
```

- [ ] **Step 3: Remove the inline strategy card block**

Delete the entire block currently at lines 307–323 (the `{strategy && ( <div className="flex flex-col gap-2 px-4 pb-4"> ... </div> )}` that renders `<StrategyCard ... />` and its `calendarError`). The calendar error is already surfaced inside `StrategyPanel`, so nothing is lost. The chat column between the `error` block and the "Build strategy" block should now go straight from the `useChat` error block to the `{(showBuildButton || buildError) && (...)}` block.

- [ ] **Step 4: Wire the panel's onEdit and auto-open behavior**

(a) Update the `StrategyPanel` render at the bottom of the file to pass `onEdit`:

```tsx
      {/* Right strategy-summary panel — the single strategy surface (collapsible) */}
      <StrategyPanel
        strategy={strategy}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
        onGenerateCalendar={handleGenerateCalendar}
        onEdit={() => {
          setStrategy(null);
          setSummaryOpen(false);
        }}
        generating={calendarPending}
        calendarError={calendarError}
        mobileOpen={summaryOpen}
        onMobileClose={() => setSummaryOpen(false)}
      />
```

(b) In `handleSelectStrategy`, after `setStrategy(s)` / `setStrategyId(id)` succeed, surface the panel. Replace the existing `setHistoryOpen(false);` near the end of the `try` block with:

```tsx
      setPanelCollapsed(false);
      setSummaryOpen(true);
      setHistoryOpen(false);
```

(c) In `handleBuildStrategy`, after `setStrategy(data.strategy)` / `setStrategyId(data.strategyId)`, add the same surfacing:

```tsx
      setStrategy(data.strategy);
      setStrategyId(data.strategyId);
      setPanelCollapsed(false);
      setSummaryOpen(true);
```

- [ ] **Step 5: Delete the now-unused card and its test**

```bash
git rm "src/app/(dashboard)/strategy/strategy-card.tsx" "src/app/(dashboard)/strategy/strategy-card.test.tsx"
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (In particular, no "StrategyCard is not defined" and no unused-import errors.)

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors for `strategy-client.tsx`.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites pass; the deleted `strategy-card.test.tsx` is gone and `strategy-panel.test.tsx` passes.

- [ ] **Step 9: Manual verification (dev server)**

`strategy-client.tsx` depends on `useChat`, `useRouter`, and server actions, so its wiring is verified by driving the real app rather than a unit test. Run `npm run dev`, sign in, open `/strategy` for a brand with saved strategies, and confirm:
  1. **Desktop (≥lg):** click a history item → strategy appears in the right panel; the panel scrolls end-to-end; the chat column shows only the recap message (no inline card); you can send a message and the streamed reply is fully visible and scrolls. "Edit strategy" in the panel clears it and the "Build Strategy" button returns.
  2. **Mobile (<lg, e.g. 390px):** click a history item → the strategy opens as a full-width scrollable sheet with a working ✕ close; closing returns to a fully usable chat; building a strategy from a conversation auto-opens the sheet.
  3. **No clipping:** with a long strategy open, every section is reachable by scrolling on both breakpoints.

- [ ] **Step 10: Commit**

```bash
git add -A "src/app/(dashboard)/strategy"
git commit -m "feat(strategy): single scrollable panel surface; remove inline card that crowded chat"
```

---

## Self-Review notes

- **Spec coverage:** single scrollable surface (Task 3 removes the inline card; panel is the surface) ✓; coexist-with-chat on desktop / overlay on mobile (Task 2 full-width sheet + existing responsive panel; Task 3 auto-open) ✓; refine→rebuild loop preserved (Task 2 "Edit strategy" + Task 3 onEdit wiring) ✓; error/edge (calendar error shown in panel; strategy state retained across collapse) ✓.
- **Type consistency:** `onEdit: () => void` defined on `StrategyPanelProps` (Task 2) and supplied by the client (Task 3); `setSummaryOpen` / `setPanelCollapsed` already exist in `strategy-client.tsx`.
- **No dead references:** Task 3 deletes `strategy-card.tsx` + its test only after Step 1 confirms no other consumer.
