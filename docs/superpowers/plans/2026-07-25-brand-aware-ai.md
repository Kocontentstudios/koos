# Brand-Aware Agentic AI (Epic 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the KOOS assistant into a brand-aware agent that reads any authorized brand resource via tools, proposes writes the user confirms, remembers across conversations, and can onboard a brand by interviewing the user in chat or by voice.

**Architecture:** The chat route passes AI-SDK `tools` to `streamText`. Read tools fetch server-side and re-authorize via `checkBrandAccess`; `propose_*` tools return typed `Proposal` objects (no writes). A single `/api/actions/confirm` endpoint is the only path that persists an AI-proposed write. A `brand_memory` table + best-effort `onFinish` writer makes the assistant stateful. Onboarding reuses the same chat + propose/confirm loop, with pluggable STT/TTS defaulting to the browser Web Speech API.

**Tech Stack:** Next.js App Router, `ai@^6` (`streamText`, `tool`, `stepCountIs`, `generateObject`), `zod@^4`, Drizzle + Postgres, Amazon Bedrock (default provider), vitest.

## Global Constraints

- **Human-in-the-loop (verbatim):** the AI may read anything it is authorized for and may draft writes, but **nothing persists without an explicit user confirmation**. Only `/api/actions/confirm` writes AI-proposed changes.
- **Authorization choke point:** every tool `execute` and the confirm endpoint MUST call `checkBrandAccess(userId, brandId, "manage_content")` before touching data. Return typed errors; never throw into the stream. 404 = not yours, 403 = capability denied.
- **Package manager (WSL):** use `corepack pnpm …`; never bare `pnpm`, never `npm install` (PATH pnpm is the Windows binary and crashes).
- **Migrations:** hand-write SQL under `drizzle/` and run via `scripts/migrate.mjs` (the `_migrations` ledger); `drizzle/meta` is gitignored, so do not `db:push`.
- **Best-effort side-effects:** memory writing and title generation run inside `onFinish` and must be wrapped so a failure never breaks the user's stream.
- **Comments:** only "why" comments (per repo CLAUDE.md); no redundant "what" comments; delete replaced code, don't comment it out.
- **Commit style:** end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Code model default:** Bedrock. New model surfaces resolve through `src/lib/ai/provider-config.ts` (global default + per-feature env override).

---

## File structure

```
src/lib/ai/tools/
  context.ts        # ToolContext + buildToolContext; shared access guard helper
  proposals.ts      # zod ProposalSchema (discriminated union) + Proposal type
  read.ts           # read tools (get_brand_profile, list_*, recall_memory, ...)
  propose.ts        # propose_* tools (return Proposal, no writes)
  index.ts          # buildBrandTools(ctx) + providerSupportsTools()
src/lib/design/ticket-create.ts        # shared ticket-creation helper (extracted)
src/lib/ai/memory.ts                    # summarizeIntoMemory writer + buildMemoryBlock reader
src/app/api/actions/confirm/route.ts    # single AI-write path (dispatch by proposal.kind)
src/app/api/brand/onboarding/extract/route.ts  # transcript -> brand field proposal
src/app/(dashboard)/brand/onboarding/page.tsx  # onboarding surface (chat + voice toggle)
src/app/(dashboard)/brand/onboarding/onboarding-client.tsx
src/components/ai/proposal-card.tsx     # renders any Proposal with Confirm/Dismiss
src/hooks/use-voice-io.ts               # browser Web Speech STT/TTS (default)
```

Modified: `src/lib/db/queries/index.ts` (new queries), `src/lib/db/schema.ts` (+`brandMemory`),
`src/app/api/chat/route.ts` (tools + memory), `src/lib/ai/prompts/chat.ts` (tool-aware prompt),
`src/lib/ai/provider-config.ts` (`onboarding` + STT/TTS), `src/app/api/design-tickets/route.ts`
(use extracted helper), `src/app/(dashboard)/strategy/strategy-client.tsx` (render proposal cards).

---

# PHASE 3A — Tool layer + propose/confirm

## Task 1: Brand read queries the tools need

**Files:**
- Modify: `src/lib/db/queries/index.ts`
- Test: `src/lib/db/queries/brand-tool-queries.test.ts`

**Interfaces:**
- Produces: `getBrandAssets(brandId: string): Promise<(typeof brandAssets.$inferSelect)[]>`; `listDesignTicketsForBrand(brandId: string): Promise<(typeof designTickets.$inferSelect)[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/db/queries/brand-tool-queries.test.ts
import { describe, expect, it } from "vitest";
import { getBrandAssets, listDesignTicketsForBrand } from "./index";

describe("brand tool queries", () => {
  it("exports callable query functions", () => {
    expect(typeof getBrandAssets).toBe("function");
    expect(typeof listDesignTicketsForBrand).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/db/queries/brand-tool-queries.test.ts`
Expected: FAIL — `getBrandAssets is not exported`.

- [ ] **Step 3: Add the queries** (follow the existing `getStrategiesByBrand` pattern in the same file)

```ts
export async function getBrandAssets(brandId: string) {
  return db
    .select()
    .from(brandAssets)
    .where(eq(brandAssets.brandId, brandId))
    .orderBy(desc(brandAssets.createdAt));
}

export async function listDesignTicketsForBrand(brandId: string) {
  return db
    .select()
    .from(designTickets)
    .where(eq(designTickets.brandId, brandId))
    .orderBy(desc(designTickets.createdAt));
}
```

Ensure `brandAssets` and `designTickets` are in the schema import at the top of the file (they may already be).

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/db/queries/brand-tool-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/index.ts src/lib/db/queries/brand-tool-queries.test.ts
git commit -m "feat: brand asset + ticket list queries for AI tools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Proposal schema (shared contract)

**Files:**
- Create: `src/lib/ai/tools/proposals.ts`
- Test: `src/lib/ai/tools/proposals.test.ts`

**Interfaces:**
- Produces: `ProposalSchema` (zod discriminated union on `kind`), `type Proposal`, and per-kind data schemas. Consumed by propose tools (Task 4), the confirm route (Task 7), and the UI card (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/tools/proposals.test.ts
import { describe, expect, it } from "vitest";
import { ProposalSchema } from "./proposals";

describe("ProposalSchema", () => {
  it("accepts a brand_fields proposal", () => {
    const p = { kind: "brand_fields", summary: "Set tone to playful",
      data: { fields: { tone: "playful" } } };
    expect(ProposalSchema.safeParse(p).success).toBe(true);
  });
  it("accepts a design_ticket proposal", () => {
    const p = { kind: "design_ticket", summary: "IG carousel",
      data: { designType: "Instagram Carousel", brief: "5 slides on launch" } };
    expect(ProposalSchema.safeParse(p).success).toBe(true);
  });
  it("rejects an unknown kind", () => {
    expect(ProposalSchema.safeParse({ kind: "nope", summary: "x", data: {} }).success).toBe(false);
  });
  it("rejects a design_ticket missing brief", () => {
    const p = { kind: "design_ticket", summary: "x", data: { designType: "Logo" } };
    expect(ProposalSchema.safeParse(p).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/ai/tools/proposals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```ts
// src/lib/ai/tools/proposals.ts
import { z } from "zod";

const brandFields = z.object({
  fields: z
    .object({
      name: z.string().optional(),
      overview: z.string().optional(),
      businessType: z.string().optional(),
      stage: z.string().optional(),
      targetAudience: z.string().optional(),
      offer: z.string().optional(),
      tone: z.string().optional(),
      primaryGoal: z.string().optional(),
      values: z.string().optional(),
      wordsLove: z.string().optional(),
      wordsAvoid: z.string().optional(),
      brandStyle: z.string().optional(),
      competitors: z.string().optional(),
      differentiators: z.string().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      additionalNotes: z.string().optional(),
    })
    .refine((f) => Object.keys(f).length > 0, "At least one field required"),
});

const designTicket = z.object({
  designType: z.string().min(1),
  brief: z.string().min(1),
  dimensions: z.string().optional(),
  slides: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

const calendar = z.object({
  strategyId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string(),
  cadence: z.string().optional(),
});

const strategy = z.object({
  name: z.string().min(1),
  seed: z.string().min(1),
});

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brand_fields"), summary: z.string(), data: brandFields }),
  z.object({ kind: z.literal("design_ticket"), summary: z.string(), data: designTicket }),
  z.object({ kind: z.literal("calendar"), summary: z.string(), data: calendar }),
  z.object({ kind: z.literal("strategy"), summary: z.string(), data: strategy }),
]);

export type Proposal = z.infer<typeof ProposalSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/ai/tools/proposals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/proposals.ts src/lib/ai/tools/proposals.test.ts
git commit -m "feat: shared Proposal schema for AI propose/confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tool context + read tools

**Files:**
- Create: `src/lib/ai/tools/context.ts`, `src/lib/ai/tools/read.ts`
- Test: `src/lib/ai/tools/read.test.ts`

**Interfaces:**
- Produces: `type ToolContext = { userId: string; brandId: string }`; `buildReadTools(ctx: ToolContext): Record<string, Tool>`; helper `withBrandAccess(ctx, fn)` that runs `checkBrandAccess` and returns `{ error }` on denial.
- Consumes: queries from Task 1 + existing `getBrandById`, `getAllBrandContexts`, `getStrategiesByBrand`, `getActiveCalendarForBrand`, `getCalendarItems`, `getRecentConversationsForBrand`, `getConversationMessages`; `checkBrandAccess` from Task 0/existing.

- [ ] **Step 1: Write the failing test** (authorization is the contract that matters)

```ts
// src/lib/ai/tools/read.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: vi.fn(),
  getBrandById: vi.fn(),
  getAllBrandContexts: vi.fn(),
  getBrandAssets: vi.fn(),
  getStrategiesByBrand: vi.fn(),
  getActiveCalendarForBrand: vi.fn(),
  getCalendarItems: vi.fn(),
  listDesignTicketsForBrand: vi.fn(),
  getRecentConversationsForBrand: vi.fn(),
  getConversationMessages: vi.fn(),
}));

import * as q from "@/lib/db/queries";
import { buildReadTools } from "./read";

const ctx = { userId: "u1", brandId: "b1" };

describe("read tools", () => {
  it("returns an error object when access is denied (no data leak)", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: false, status: 404, error: "Brand not found" });
    const tools = buildReadTools(ctx);
    const out = await tools.get_brand_profile.execute({}, { toolCallId: "t", messages: [] });
    expect(out).toEqual({ error: "Brand not found" });
    expect(q.getBrandById).not.toHaveBeenCalled();
  });

  it("returns brand data when access is granted", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1", name: "Acme" } } as never);
    vi.mocked(q.getBrandById).mockResolvedValue({ id: "b1", name: "Acme", tone: "bold" } as never);
    vi.mocked(q.getAllBrandContexts).mockResolvedValue([]);
    const tools = buildReadTools(ctx);
    const out = await tools.get_brand_profile.execute({}, { toolCallId: "t", messages: [] });
    expect(out).toMatchObject({ brand: { name: "Acme" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/ai/tools/read.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement context + read tools**

```ts
// src/lib/ai/tools/context.ts
import { checkBrandAccess } from "@/lib/db/queries";

export type ToolContext = { userId: string; brandId: string };

/** Runs the authorization choke point; returns { error } on denial so tools
 *  surface a message to the model instead of throwing into the stream. */
export async function withBrandAccess<T>(
  ctx: ToolContext,
  fn: (brand: Awaited<ReturnType<typeof checkBrandAccess>> extends { ok: true; brand: infer B } ? B : never) => Promise<T>,
): Promise<T | { error: string }> {
  const access = await checkBrandAccess(ctx.userId, ctx.brandId, "manage_content");
  if (!access.ok) return { error: access.error };
  return fn(access.brand);
}
```

```ts
// src/lib/ai/tools/read.ts
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  getActiveCalendarForBrand,
  getAllBrandContexts,
  getBrandAssets,
  getBrandById,
  getBrandMemory,
  getCalendarItems,
  getConversationMessages,
  getRecentConversationsForBrand,
  getStrategiesByBrand,
  listDesignTicketsForBrand,
} from "@/lib/db/queries";
import { type ToolContext, withBrandAccess } from "./context";

export function buildReadTools(ctx: ToolContext): Record<string, Tool> {
  return {
    get_brand_profile: tool({
      description: "Get the active brand's profile fields and saved context sections.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => ({
          brand: await getBrandById(ctx.brandId),
          contexts: await getAllBrandContexts(ctx.brandId),
        })),
    }),
    list_brand_assets: tool({
      description: "List the brand's uploaded logos, images and documents.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ assets: await getBrandAssets(ctx.brandId) })),
    }),
    list_strategies: tool({
      description: "List the brand's marketing strategies with status.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ strategies: await getStrategiesByBrand(ctx.brandId) })),
    }),
    list_calendar_items: tool({
      description: "List content items on the brand's active calendar.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => {
          const cal = await getActiveCalendarForBrand(ctx.brandId);
          return { items: cal ? await getCalendarItems(cal.id) : [] };
        }),
    }),
    list_design_tickets: tool({
      description: "List the brand's design tickets and their status.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ tickets: await listDesignTicketsForBrand(ctx.brandId) })),
    }),
    recall_memory: tool({
      description: "Recall durable facts and the running summary remembered about this brand.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ memory: await getBrandMemory(ctx.brandId) })),
    }),
    list_past_conversations: tool({
      description: "List recent past conversations (titles + dates) for this brand.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => ({
          conversations: await getRecentConversationsForBrand(ctx.brandId, 20),
        })),
    }),
    read_conversation: tool({
      description: "Read the messages of one prior conversation by id.",
      inputSchema: z.object({ conversationId: z.string().uuid() }),
      execute: ({ conversationId }) =>
        withBrandAccess(ctx, async () => ({ messages: await getConversationMessages(conversationId) })),
    }),
  };
}
```

Note: `getBrandMemory` is delivered in Task 10 (Phase 3B). To keep Phase 3A independently
testable, add a temporary stub export in `queries/index.ts` now that returns `null`
(replaced with the real implementation in Task 10), and mock it in this test.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/ai/tools/read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/context.ts src/lib/ai/tools/read.ts src/lib/ai/tools/read.test.ts src/lib/db/queries/index.ts
git commit -m "feat: access-checked read tools for brand-aware AI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Propose tools (return Proposal, never write)

**Files:**
- Create: `src/lib/ai/tools/propose.ts`
- Test: `src/lib/ai/tools/propose.test.ts`

**Interfaces:**
- Produces: `buildProposeTools(ctx: ToolContext): Record<string, Tool>` with `propose_brand_field_updates`, `propose_design_ticket`, `propose_calendar_generation`, `propose_strategy`. Each returns `{ proposal: Proposal }` validated against `ProposalSchema`, or `{ error }` on access denial. **No DB writes.**

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/tools/propose.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));
import * as q from "@/lib/db/queries";
import { buildProposeTools } from "./propose";
import { ProposalSchema } from "./proposals";

const ctx = { userId: "u1", brandId: "b1" };

describe("propose tools", () => {
  it("returns a valid, schema-conformant proposal (and writes nothing)", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_brand_field_updates.execute(
      { fields: { tone: "playful" }, summary: "Set tone to playful" },
      { toolCallId: "t", messages: [] },
    );
    expect(ProposalSchema.safeParse((out as { proposal: unknown }).proposal).success).toBe(true);
  });

  it("returns an error object on access denial", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: false, status: 403, error: "Denied" });
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_design_ticket.execute(
      { designType: "Logo", brief: "x", summary: "Logo" },
      { toolCallId: "t", messages: [] },
    );
    expect(out).toEqual({ error: "Denied" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/ai/tools/propose.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement propose tools**

```ts
// src/lib/ai/tools/propose.ts
import { tool, type Tool } from "ai";
import { z } from "zod";
import { type ToolContext, withBrandAccess } from "./context";
import { type Proposal, ProposalSchema } from "./proposals";

function ok(proposal: Proposal) {
  return { proposal: ProposalSchema.parse(proposal) };
}

export function buildProposeTools(ctx: ToolContext): Record<string, Tool> {
  return {
    propose_brand_field_updates: tool({
      description: "Draft updates to brand profile fields for the user to confirm. Does NOT save.",
      inputSchema: z.object({
        summary: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
      execute: ({ summary, fields }) =>
        withBrandAccess(ctx, async () => ok({ kind: "brand_fields", summary, data: { fields } })),
    }),
    propose_design_ticket: tool({
      description: "Draft a design ticket for the user to confirm. Does NOT submit it.",
      inputSchema: z.object({
        summary: z.string(),
        designType: z.string(),
        brief: z.string(),
        dimensions: z.string().optional(),
        slides: z.number().int().positive().optional(),
        notes: z.string().optional(),
      }),
      execute: ({ summary, ...data }) =>
        withBrandAccess(ctx, async () => ok({ kind: "design_ticket", summary, data })),
    }),
    propose_calendar_generation: tool({
      description: "Draft a content-calendar generation request for the user to confirm.",
      inputSchema: z.object({
        summary: z.string(),
        strategyId: z.string().uuid().optional(),
        startDate: z.string(),
        endDate: z.string(),
        cadence: z.string().optional(),
      }),
      execute: ({ summary, ...data }) =>
        withBrandAccess(ctx, async () => ok({ kind: "calendar", summary, data })),
    }),
    propose_strategy: tool({
      description: "Draft a marketing-strategy generation request for the user to confirm.",
      inputSchema: z.object({ summary: z.string(), name: z.string(), seed: z.string() }),
      execute: ({ summary, name, seed }) =>
        withBrandAccess(ctx, async () => ok({ kind: "strategy", summary, data: { name, seed } })),
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/ai/tools/propose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/propose.ts src/lib/ai/tools/propose.test.ts
git commit -m "feat: propose tools that draft confirmable actions (no writes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Tool registry + provider tool-support guard

**Files:**
- Create: `src/lib/ai/tools/index.ts`
- Test: `src/lib/ai/tools/index.test.ts`

**Interfaces:**
- Produces: `buildBrandTools(ctx: ToolContext): Record<string, Tool>` (read + propose merged); `providerSupportsTools(provider: AiProvider): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/tools/index.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));
import { buildBrandTools, providerSupportsTools } from "./index";

describe("tool registry", () => {
  it("includes read and propose tools", () => {
    const tools = buildBrandTools({ userId: "u", brandId: "b" });
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["get_brand_profile", "propose_brand_field_updates"]),
    );
  });
  it("knows which providers support tools", () => {
    expect(providerSupportsTools("bedrock")).toBe(true);
    expect(providerSupportsTools("zai")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/ai/tools/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// src/lib/ai/tools/index.ts
import type { Tool } from "ai";
import type { AiProvider } from "@/lib/ai/provider-config";
import type { ToolContext } from "./context";
import { buildProposeTools } from "./propose";
import { buildReadTools } from "./read";

export function buildBrandTools(ctx: ToolContext): Record<string, Tool> {
  return { ...buildReadTools(ctx), ...buildProposeTools(ctx) };
}

const TOOL_CAPABLE: ReadonlySet<AiProvider> = new Set<AiProvider>([
  "bedrock",
  "anthropic",
  "openai",
  "google",
]);

export function providerSupportsTools(provider: AiProvider): boolean {
  return TOOL_CAPABLE.has(provider);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/lib/ai/tools/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/index.ts src/lib/ai/tools/index.test.ts
git commit -m "feat: brand tool registry + provider tool-support guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract shared design-ticket creation helper

**Files:**
- Create: `src/lib/design/ticket-create.ts`
- Modify: `src/app/api/design-tickets/route.ts` (call the helper)
- Test: `src/lib/design/ticket-create.test.ts`

**Interfaces:**
- Produces: `createTicketFromRequest(input: { brandId; userId; designType; brief; dimensions?; slides?; notes?; deliveryEmail?; dueDate?; calendarItemId?; briefId? }, deps): Promise<{ ticket }>`. Reuses `createDesignTicket`, `recordUsageEvent`, `sendDesignRequestEmails` exactly as the current route does. Consumed by the design-tickets route AND the confirm route (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/design/ticket-create.test.ts
import { describe, expect, it, vi } from "vitest";
import { createTicketFromRequest } from "./ticket-create";

describe("createTicketFromRequest", () => {
  it("creates a ticket and records usage; email failure does not throw", async () => {
    const createDesignTicket = vi.fn().mockResolvedValue({ id: "t1", ticketNumber: 5, designType: "Logo" });
    const recordUsageEvent = vi.fn().mockResolvedValue(undefined);
    const sendEmails = vi.fn().mockRejectedValue(new Error("smtp down"));
    const res = await createTicketFromRequest(
      { brandId: "b1", userId: "u1", designType: "Logo", brief: "clean wordmark" },
      { createDesignTicket, recordUsageEvent, sendEmails, brandName: "Acme",
        requesterName: "A B", requesterEmail: "a@b.co" },
    );
    expect(res.ticket.id).toBe("t1");
    expect(createDesignTicket).toHaveBeenCalledOnce();
    expect(recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "design_ticket_created" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/design/ticket-create.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper** by lifting the try-block body from `src/app/api/design-tickets/route.ts:88-153` into a dependency-injected function. Keep the email send best-effort (wrapped in try/catch). Then refactor the route to call `createTicketFromRequest(...)`, passing the real queries + `sendDesignRequestEmails`. Preserve the route's existing validation, `calendarItemId`/`briefId` checks, analytics event, and response shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run src/lib/design/ticket-create.test.ts src/lib/design`
Expected: PASS. Also run the existing design-ticket route tests if present.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/ticket-create.ts src/lib/design/ticket-create.test.ts src/app/api/design-tickets/route.ts
git commit -m "refactor: extract shared design-ticket creation helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Confirm endpoint — the single AI write path

**Files:**
- Create: `src/app/api/actions/confirm/route.ts`
- Test: `src/app/api/actions/confirm/route.test.ts`

**Interfaces:**
- Consumes: `ProposalSchema` (Task 2), `checkBrandAccess`, `updateBrand`, `createTicketFromRequest` (Task 6), `createGenerationJob` + `executeGenerationJob`/`generateStrategyWork`/`generateCalendarWork` (existing), `recordUsageEvent`.
- Produces: `POST` handler returning `{ ok: true, kind, resultId? }` or an error status.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/actions/confirm/route.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ ok: true }), tooManyRequests: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: vi.fn(),
  updateBrand: vi.fn(),
  recordUsageEvent: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth/get-user";
import * as q from "@/lib/db/queries";
import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/actions/confirm", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/actions/confirm", () => {
  it("rejects a proposal for a brand the user cannot access", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ dbUser: { id: "u1" } } as never);
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: false, status: 404, error: "Brand not found" });
    const res = await POST(req({ brandId: "b1", proposal: { kind: "brand_fields", summary: "x", data: { fields: { tone: "bold" } } } }));
    expect(res.status).toBe(404);
    expect(q.updateBrand).not.toHaveBeenCalled();
  });

  it("applies a confirmed brand_fields proposal", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ dbUser: { id: "u1" } } as never);
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    vi.mocked(q.updateBrand).mockResolvedValue({ id: "b1" } as never);
    const res = await POST(req({ brandId: "b1", proposal: { kind: "brand_fields", summary: "Set tone", data: { fields: { tone: "bold" } } } }));
    expect(res.status).toBe(200);
    expect(q.updateBrand).toHaveBeenCalledWith("b1", { tone: "bold" });
  });

  it("400s on an invalid proposal", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ dbUser: { id: "u1" } } as never);
    const res = await POST(req({ brandId: "b1", proposal: { kind: "nope" } }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/app/api/actions/confirm/route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the confirm route**

```ts
// src/app/api/actions/confirm/route.ts
import { after } from "next/server";
import { z } from "zod";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  createGenerationJob,
  updateBrand,
} from "@/lib/db/queries";
import { createTicketFromRequest } from "@/lib/design/ticket-create";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

const bodySchema = z.object({ brandId: z.string().uuid(), proposal: ProposalSchema });

export const maxDuration = 300;

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const verdict = await checkRateLimit({ key: `confirm:${dbUser.id}`, limit: 30, windowSeconds: 300 });
  if (!verdict.ok) return tooManyRequests(verdict);

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid proposal" }, { status: 400 });
  }

  const { brandId, proposal } = parsed;
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const brand = access.brand;

  switch (proposal.kind) {
    case "brand_fields": {
      // No usage_events row: the usage_kind enum has no brand-update value, and
      // adding one is out of this epic's scope. Just apply the confirmed update.
      await updateBrand(brandId, proposal.data.fields);
      return Response.json({ ok: true, kind: proposal.kind, resultId: brandId });
    }
    case "design_ticket": {
      const { ticket } = await createTicketFromRequest(
        { brandId, userId: dbUser.id, ...proposal.data },
        {
          brandName: brand.name,
          requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
          requesterEmail: dbUser.email,
        },
      );
      return Response.json({ ok: true, kind: proposal.kind, resultId: ticket.id });
    }
    case "strategy":
    case "calendar": {
      const job = await createGenerationJob({
        kind: proposal.kind === "calendar" ? "calendar" : "strategy",
        userId: dbUser.id,
        brandId,
        input: proposal.data,
      });
      after(async () => {
        const { executeGenerationJob } = await import("@/lib/jobs/run-generation");
        await executeGenerationJob(job.id);
      });
      return Response.json({ ok: true, kind: proposal.kind, resultId: job.id }, { status: 202 });
    }
  }
}
```

Note: confirm `createGenerationJob`/`executeGenerationJob` argument shapes against
`src/app/api/strategy/generate/route.ts` and adjust the `input` payload if the existing job
runner expects specific keys. If the design-ticket dispatch needs `createTicketFromRequest`
deps beyond brand identity, pass the real queries (default them inside the helper).

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/app/api/actions/confirm/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/actions/confirm
git commit -m "feat: /api/actions/confirm as the single AI write path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire tools into the chat route + tool-aware prompt

**Files:**
- Modify: `src/app/api/chat/route.ts`, `src/lib/ai/prompts/chat.ts`
- Test: `src/lib/ai/prompts/chat.test.ts` (extend/create)

**Interfaces:**
- Consumes: `buildBrandTools`, `providerSupportsTools` (Task 5), `resolveProviderConfig`, `stepCountIs` from `ai`.
- Produces: chat requests now run with tools when the resolved chat provider supports them.

- [ ] **Step 1: Write the failing test** (prompt is tool-aware)

```ts
// src/lib/ai/prompts/chat.test.ts
import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "./chat";

describe("buildChatPrompt (tool-aware)", () => {
  it("instructs the model to use tools and to propose, not fabricate", () => {
    const p = buildChatPrompt({ memorySummary: "Acme sells running shoes." });
    expect(p).toMatch(/tool/i);
    expect(p).toMatch(/propose/i);
    expect(p).toContain("Acme sells running shoes.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/lib/ai/prompts/chat.test.ts`
Expected: FAIL — `buildChatPrompt` still expects the old `ChatBrandContext`.

- [ ] **Step 3: Rewrite the prompt + wire the route.** Change `buildChatPrompt` to accept `{ memorySummary: string }` and return tool-aware guidance: use read tools before answering factual brand questions; never fabricate; for ANY change call the matching `propose_*` tool and tell the user to confirm (never claim the change was made); include the memory summary. In `src/app/api/chat/route.ts`, after `checkBrandAccess`, build `ctx = { userId: dbUser.id, brandId }`, resolve the provider, and add to `streamText`:

```ts
import { stepCountIs } from "ai";
import { buildBrandTools, providerSupportsTools } from "@/lib/ai/tools";
import { resolveProviderConfig } from "@/lib/ai/provider-config";
// ...
const useTools = providerSupportsTools(resolveProviderConfig("chat").provider);
const result = streamText({
  model: getModel("chat"),
  system: systemPrompt,
  messages: modelMessages,
  ...(useTools ? { tools: buildBrandTools({ userId: dbUser.id, brandId }), stopWhen: stepCountIs(6) } : {}),
  onFinish: async ({ text }) => { /* existing persistence unchanged */ },
});
```

Update the `strategy` mode's `systemPrompt` to `buildChatPrompt({ memorySummary })` (memorySummary comes from Task 11; until then pass `""`). Keep the `design` mode prompt as-is for now. Remove the now-unused `ChatBrandContext` string plumbing from the strategy path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run src/lib/ai/prompts/chat.test.ts && corepack pnpm exec tsc --noEmit -p tsconfig.json`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts src/lib/ai/prompts/chat.ts src/lib/ai/prompts/chat.test.ts
git commit -m "feat: run brand-aware tools in chat with a tool-aware prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Proposal card UI + confirm wiring

**Files:**
- Create: `src/components/ai/proposal-card.tsx`
- Modify: `src/app/(dashboard)/strategy/strategy-client.tsx` (render tool proposals)
- Test: `src/components/ai/proposal-card.test.tsx`

**Interfaces:**
- Consumes: `Proposal` (Task 2), `/api/actions/confirm` (Task 7).
- Produces: `<ProposalCard proposal brandId onDone />` — renders `summary` + typed detail, Confirm posts to the endpoint, Dismiss calls `onDone("dismissed")`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ai/proposal-card.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./proposal-card";

describe("ProposalCard", () => {
  it("shows the summary and confirms via the endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ProposalCard brandId="b1" onDone={onDone}
      proposal={{ kind: "brand_fields", summary: "Set tone to bold", data: { fields: { tone: "bold" } } }} />);
    expect(screen.getByText("Set tone to bold")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/actions/confirm", expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/ai/proposal-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card** using existing `Button`/`sonner` primitives. Render `proposal.summary` prominently and a `<pre>`/definition list of `proposal.data`. Confirm → `fetch("/api/actions/confirm", { method:"POST", headers, body: JSON.stringify({ brandId, proposal }) })`; on ok toast success + `onDone("confirmed")`, else toast the error. Dismiss → `onDone("dismissed")`. Then, in `strategy-client.tsx`, detect assistant tool outputs carrying a `proposal` (AI SDK v6 surfaces tool results in message parts) and render `<ProposalCard>` inline, passing the active `brandId` and an `onDone` that drops the card.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/ai/proposal-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/proposal-card.tsx src/components/ai/proposal-card.test.tsx src/app/(dashboard)/strategy/strategy-client.tsx
git commit -m "feat: proposal card with confirm/dismiss in chat

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 3A checkpoint:** run `corepack pnpm lint && corepack pnpm vitest run && corepack pnpm exec tsc --noEmit`. Then verify E2E scenarios 1–2 from §13 against local dev (`verify` skill).

---

# PHASE 3B — Persistent memory (stateful)

## Task 10: `brand_memory` table + queries

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/queries/index.ts` (replace the Task 3 `getBrandMemory` stub)
- Create: `drizzle/00XX_brand_memory.sql` (next sequential number)
- Test: `src/lib/db/queries/brand-memory.test.ts`

**Interfaces:**
- Produces: `getBrandMemory(brandId): Promise<{ summary: string; facts: MemoryFact[] } | null>`; `upsertBrandMemory(brandId, { summary, facts }): Promise<void>`; `type MemoryFact = { text: string; source: string; createdAt: string }`.

- [ ] **Step 1: Add the Drizzle table** to `schema.ts`:

```ts
export const brandMemory = pgTable("brand_memory", {
  brandId: uuid("brand_id").primaryKey().references(() => brands.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  facts: jsonb("facts").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Write the migration** `drizzle/00XX_brand_memory.sql`:

```sql
CREATE TABLE IF NOT EXISTS brand_memory (
  brand_id   uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  summary    text NOT NULL DEFAULT '',
  facts      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/db/queries/brand-memory.test.ts
import { describe, expect, it } from "vitest";
import { getBrandMemory, upsertBrandMemory } from "./index";
describe("brand memory queries", () => {
  it("exports upsert + read", () => {
    expect(typeof getBrandMemory).toBe("function");
    expect(typeof upsertBrandMemory).toBe("function");
  });
});
```

- [ ] **Step 4: Implement the queries** (replace the stub) with a real select + upsert on conflict `brandId`. Run migration locally: `node scripts/migrate.mjs`.

- [ ] **Step 5: Run + commit**

Run: `corepack pnpm vitest run src/lib/db/queries/brand-memory.test.ts`

```bash
git add src/lib/db/schema.ts src/lib/db/queries/index.ts drizzle/00XX_brand_memory.sql src/lib/db/queries/brand-memory.test.ts
git commit -m "feat: brand_memory table + queries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Memory writer + reader

**Files:**
- Create: `src/lib/ai/memory.ts`
- Modify: `src/app/api/chat/route.ts` (call writer in `onFinish`, pass summary to prompt)
- Test: `src/lib/ai/memory.test.ts`

**Interfaces:**
- Produces: `summarizeIntoMemory({ brandId, userText, assistantText }): Promise<void>` (best-effort); `buildMemoryBlock(brandId): Promise<string>` (returns the compact summary or "").

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/memory.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/queries", () => ({ getBrandMemory: vi.fn(), upsertBrandMemory: vi.fn() }));
import * as q from "@/lib/db/queries";
import { buildMemoryBlock, summarizeIntoMemory } from "./memory";

describe("memory", () => {
  it("buildMemoryBlock returns the stored summary", async () => {
    vi.mocked(q.getBrandMemory).mockResolvedValue({ summary: "Sells shoes.", facts: [] });
    expect(await buildMemoryBlock("b1")).toContain("Sells shoes.");
  });
  it("summarizeIntoMemory swallows errors (best-effort)", async () => {
    vi.mocked(q.getBrandMemory).mockRejectedValue(new Error("db down"));
    await expect(summarizeIntoMemory({ brandId: "b1", userText: "hi", assistantText: "yo" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: implement.** `buildMemoryBlock` reads `getBrandMemory` and returns `summary` (or `""`). `summarizeIntoMemory` wraps everything in try/catch: read current memory, run a small `generateObject` (model `getModel("chat")`) that returns `{ summary, newFacts }`, then `upsertBrandMemory` with merged/capped facts. On any error, log and return.

- [ ] **Step 4: Wire into the route.** In `chat/route.ts`: before `streamText`, `const memorySummary = await buildMemoryBlock(brandId);` pass to `buildChatPrompt({ memorySummary })`; in `onFinish`, after persistence, `await summarizeIntoMemory({ brandId, userText: flattenMessageText(lastUserMessage), assistantText: text }).catch(() => {})`.

- [ ] **Step 5: Run + commit**

Run: `corepack pnpm vitest run src/lib/ai/memory.test.ts && corepack pnpm exec tsc --noEmit`

```bash
git add src/lib/ai/memory.ts src/app/api/chat/route.ts src/lib/ai/memory.test.ts
git commit -m "feat: cross-conversation brand memory (writer + reader)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 3B checkpoint:** verify E2E scenario 4 (second conversation recalls a fact).

---

# PHASE 3C — Onboarding (chat + voice)

## Task 12: Onboarding extraction endpoint

**Files:**
- Create: `src/app/api/brand/onboarding/extract/route.ts`
- Test: `src/app/api/brand/onboarding/extract/route.test.ts`

**Interfaces:**
- Produces: `POST` accepting `{ brandId, transcript }`, returning `{ proposal: Proposal }` of kind `brand_fields` extracted from the transcript. Consumes `brandProfileSchema` (`src/app/(dashboard)/brand/brand-profile-form.ts`), `generateObject`, `checkBrandAccess`, `ProposalSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/brand/onboarding/extract/route.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));
vi.mock("ai", () => ({ generateObject: vi.fn() }));
import { generateObject } from "ai";
import { getAuthUser } from "@/lib/auth/get-user";
import * as q from "@/lib/db/queries";
import { POST } from "./route";

describe("POST onboarding extract", () => {
  it("returns a brand_fields proposal from a transcript", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ dbUser: { id: "u1" } } as never);
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    vi.mocked(generateObject).mockResolvedValue({ object: { fields: { tone: "warm" }, summary: "Captured tone" } } as never);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ brandId: "b1", transcript: "We're friendly and warm." }) }));
    const body = await res.json();
    expect(body.proposal.kind).toBe("brand_fields");
    expect(body.proposal.data.fields.tone).toBe("warm");
  });
});
```

- [ ] **Step 2–4:** Run to fail; implement the route (auth + rate-limit + `checkBrandAccess`; `generateObject` with a schema of the extractable subset of `brandProfileSchema` fields + a `summary`; wrap into `{ kind:"brand_fields", summary, data:{ fields } }` and validate with `ProposalSchema`); run to pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/brand/onboarding/extract
git commit -m "feat: onboarding transcript -> brand field proposal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Provider-config STT/TTS + voice hook (browser default)

**Files:**
- Modify: `src/lib/ai/provider-config.ts` (add `"onboarding"` feature; add `resolveVoiceConfig`)
- Create: `src/hooks/use-voice-io.ts`
- Test: `src/lib/ai/voice-config.test.ts`

**Interfaces:**
- Produces: `resolveVoiceConfig(env?): { stt: "browser" | "openai" | "deepgram"; tts: "browser" | "openai" | "elevenlabs" }` defaulting to `browser`; `useVoiceIo()` hook exposing `{ supported, listening, transcript, start, stop, speak }` backed by `window.SpeechRecognition`/`speechSynthesis`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/voice-config.test.ts
import { describe, expect, it } from "vitest";
import { resolveVoiceConfig } from "./provider-config";
describe("resolveVoiceConfig", () => {
  it("defaults both to browser", () => {
    expect(resolveVoiceConfig({})).toEqual({ stt: "browser", tts: "browser" });
  });
  it("honors env overrides", () => {
    expect(resolveVoiceConfig({ AI_STT_PROVIDER: "openai", AI_TTS_PROVIDER: "elevenlabs" }))
      .toEqual({ stt: "openai", tts: "elevenlabs" });
  });
});
```

- [ ] **Step 2–4:** Run to fail; add `resolveVoiceConfig` to `provider-config.ts` and extend `AiFeature` with `"onboarding"`; implement `use-voice-io.ts` guarding `typeof window` and feature-detecting Web Speech (graceful `supported=false` when absent); run config test to pass. (The hook itself is exercised in E2E, not unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/provider-config.ts src/hooks/use-voice-io.ts src/lib/ai/voice-config.test.ts
git commit -m "feat: pluggable voice config + browser Web Speech hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Onboarding surface (chat + voice toggle)

**Files:**
- Create: `src/app/(dashboard)/brand/onboarding/page.tsx`, `src/app/(dashboard)/brand/onboarding/onboarding-client.tsx`
- Modify: dashboard nav (add "AI Onboarding" entry near Brand)
- Test: `src/app/(dashboard)/brand/onboarding/onboarding-client.test.tsx`

**Interfaces:**
- Consumes: chat stream (`useChat` against `/api/chat` with an onboarding system context), `/api/brand/onboarding/extract`, `ProposalCard` (Task 9), `useVoiceIo` (Task 13).

- [ ] **Step 1: Write the failing test** — renders the interview, a "Fill my brand" button that calls the extract endpoint and renders a `ProposalCard`, and a mic toggle that is hidden when `useVoiceIo().supported` is false.

```tsx
// onboarding-client.test.tsx (shape)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-voice-io", () => ({ useVoiceIo: () => ({ supported: false }) }));
import { OnboardingClient } from "./onboarding-client";
describe("OnboardingClient", () => {
  it("hides the mic when voice is unsupported", () => {
    render(<OnboardingClient brandId="b1" />);
    expect(screen.queryByRole("button", { name: /mic|voice/i })).toBeNull();
  });
});
```

- [ ] **Step 2–4:** Run to fail; implement the client (chat transcript UI; "Fill my brand" → POST transcript to extract → render returned `ProposalCard`; mic button gated on `supported`, wiring `useVoiceIo` transcript into the chat input and `speak()` on assistant replies) and the server `page.tsx` (resolve active brand, redirect to `/brand/create` if none, render client); run to pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/brand/onboarding" src/components/layout
git commit -m "feat: AI onboarding surface with chat + voice option

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Phase 3C checkpoint:** verify E2E scenario 3 (onboarding fills the profile via chat, then via browser voice).

---

## 13. Verification (end-to-end, `verify`/`run` skill against local dev)

1. **Fact recall:** open chat → "what's my brand's tone?" → assistant calls `get_brand_profile`, answers from real data, no fabrication.
2. **Propose → confirm/dismiss:** "update my primary goal to X" → a proposal card appears → **Confirm** updates the brand row (check `/brand`); repeat and **Dismiss** → nothing changes.
3. **Onboarding fills profile:** run onboarding for a fresh brand in chat → answer questions → "Fill my brand" → confirm → `/brand` reflects fields. Repeat with the **voice** toggle (Chrome, browser Web Speech).
4. **Cross-conversation memory:** state a fact in one conversation → start a second → assistant recalls it (`previousConversations`/memory summary no longer empty).
5. **Authorization:** attempt a confirm with a `brandId` in another workspace → 404/403, no write.

Final gates before PR: `corepack pnpm lint && corepack pnpm vitest run && corepack pnpm exec tsc --noEmit` all clean.

## 14. Self-review notes (coverage vs spec)

- Spec §5 (3A) → Tasks 1–9. Spec §6 (3B memory) → Tasks 10–11. Spec §7 (3C onboarding+voice) → Tasks 12–14. Spec §8 (provider-config) → Task 13. Spec §9 (security) enforced by `withBrandAccess` in every tool (Tasks 3–4) + confirm re-auth (Task 7). Spec §10 (testing) → per-task TDD + §13. All four `propose_*` actions ship in 3A (Task 4 + Task 7 dispatch), per the locked decision.
- Cross-task type consistency: `Proposal`/`ProposalSchema` (Task 2) is the single shared type used by Tasks 4, 7, 9, 12; `ToolContext` (Task 3) used by Tasks 3–5, 8; `getBrandMemory` stubbed in Task 3 and realized in Task 10.
