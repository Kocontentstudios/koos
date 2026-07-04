# Batch 2 — Chat Persistence (Postgres) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the KO strategist chat to Postgres so a page refresh restores the in-progress conversation (today it lives only in `useChat` in-memory state and is lost), and link each generated strategy back to the conversation it came from.

**Architecture:** Wire the already-defined-but-unused `chat_conversations` / `chat_messages` tables and their query helpers. The client owns a `conversationId` (a UUID, generated fresh for a new chat or seeded from the server for a restored one) and sends it with every `/api/chat` request. The route lazily creates the conversation (owned by the authed user + brand) and persists each completed turn (user message + assistant reply) from `streamText`'s `onFinish`. The strategy page loads the brand's most-recent conversation and seeds `useChat` with it. `strategies.conversationId` is set when a strategy is generated.

**Tech Stack:** Next.js (App Router, RSC + client), Vercel AI SDK v6 (`ai`, `@ai-sdk/react` `useChat`), Drizzle + Postgres, Vitest + @testing-library/react, Biome.

## Global Constraints

- Test runner: `npm test` (`vitest run`). Single file: `npx vitest run <path>`. Lint: `npm run lint` (Biome; imports must be Biome-clean). Typecheck: `npx tsc --noEmit -p tsconfig.json` MUST be clean before every commit — vitest and Biome do NOT type-check, so run tsc explicitly (a prior task shipped a tsc-only break that green tests missed).
- Repo-wide `npm run lint` has ~36–39 PRE-EXISTING errors in untouched files; only files you touch must be clean.
- DB message storage is FLAT: `chat_messages` = `{ id (uuid, server-gen), conversationId, role (enum: "user" | "assistant" | ...), content (text), createdAt }`. The UI uses the AI SDK `UIMessage` shape `{ id, role, parts: [{ type: "text", text }] }`. Convert at the boundary — never store `parts` JSON in `content`.
- `useChat` seeds initial messages via its `messages` option (constructor-time only): `useChat({ transport, messages: initialMessages })`. Confirmed against `node_modules/@ai-sdk/react` (ChatInit.messages).
- `conversationId` MUST be a valid UUID (the column is `uuid`). Generate with `crypto.randomUUID()`.
- Ownership is enforced server-side: the route sets `userId`/`brandId` from the authenticated session, never from client-claimed values beyond the conversation UUID; on reuse of an existing conversation it verifies `userId` matches.
- Do NOT add Redis or any new infra (spec decision: Postgres only).

## Scope (confirmed) & explicit non-goals

In scope: persist + restore the current/most-recent conversation; "New Strategy" starts a fresh conversation; link `strategies.conversationId`.

Out of scope (noted follow-ups, do NOT build): restoring a PAST strategy's full original chat on select (the existing single "recap" message behavior in `handleSelectStrategy` stays as-is); multi-conversation history UI; editing/deleting stored messages. Known limitation to document, not fix: `regenerate()` may persist a duplicate user row (rare; the flat schema has no client-message-id column to dedupe on).

---

### Task 1: Chat message adapters (pure, tested)

The lossy boundary between `UIMessage` and the flat DB row. Pure functions, TDD.

**Files:**
- Create: `src/lib/ai/chat-messages.ts`
- Test: `src/lib/ai/chat-messages.test.ts`

**Interfaces:**
- Consumes: `UIMessage` from `ai`.
- Produces:
  - `export function flattenMessageText(message: UIMessage): string` — concatenates all `type: "text"` parts; returns `""` if none.
  - `export type StoredMessageRow = { id: string; role: "user" | "assistant"; content: string }`
  - `export function rowsToUiMessages(rows: StoredMessageRow[]): UIMessage[]` — maps each row to `{ id, role, parts: [{ type: "text", text: content }] }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/chat-messages.test.ts`:

```ts
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  flattenMessageText,
  rowsToUiMessages,
  type StoredMessageRow,
} from "./chat-messages";

function uiMsg(role: "user" | "assistant", ...texts: string[]): UIMessage {
  return {
    id: `m-${role}`,
    role,
    parts: texts.map((t) => ({ type: "text", text: t })),
  } as UIMessage;
}

describe("flattenMessageText", () => {
  it("joins all text parts in order", () => {
    expect(flattenMessageText(uiMsg("user", "Hello ", "world"))).toBe(
      "Hello world",
    );
  });

  it("returns empty string when there are no text parts", () => {
    const msg = { id: "x", role: "assistant", parts: [] } as UIMessage;
    expect(flattenMessageText(msg)).toBe("");
  });
});

describe("rowsToUiMessages", () => {
  it("reconstructs UIMessages preserving id, role and text", () => {
    const rows: StoredMessageRow[] = [
      { id: "a", role: "user", content: "hi" },
      { id: "b", role: "assistant", content: "hello there" },
    ];
    const result = rowsToUiMessages(rows);
    expect(result).toEqual([
      { id: "a", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "b",
        role: "assistant",
        parts: [{ type: "text", text: "hello there" }],
      },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(rowsToUiMessages([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/chat-messages.test.ts`
Expected: FAIL — module `./chat-messages` not found.

- [ ] **Step 3: Implement the adapters**

Create `src/lib/ai/chat-messages.ts`:

```ts
import type { UIMessage } from "ai";

export type StoredMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** Concatenate every text part of a UIMessage into a plain string. */
export function flattenMessageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (p): p is Extract<(typeof message.parts)[number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("");
}

/** Rebuild UIMessages from stored flat rows for seeding useChat. */
export function rowsToUiMessages(rows: StoredMessageRow[]): UIMessage[] {
  return rows.map(
    (row) =>
      ({
        id: row.id,
        role: row.role,
        parts: [{ type: "text", text: row.content }],
      }) as UIMessage,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ai/chat-messages.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → the two new files clean.

```bash
git add src/lib/ai/chat-messages.ts src/lib/ai/chat-messages.test.ts
git commit -m "feat(chat): add UIMessage<->stored-row adapters"
```

---

### Task 2: Conversation query helpers

Thin Drizzle helpers the route + page need. Matches the existing un-tested query-wrapper convention in `queries/index.ts` (e.g. `getRecentConversations`); no dedicated unit test — verified by tsc and by the tasks that consume them.

**Files:**
- Modify: `src/lib/db/queries/index.ts` (add three helpers in the `// ── Chat ──` section, near `getRecentConversations` ~line 250)

**Interfaces:**
- Consumes: `chatConversations`, `eq`, `desc`, `and`, `db` (already imported in the file).
- Produces:
  - `export async function getConversationById(id: string)` → the row or `null`.
  - `export async function getLatestConversationForBrand(brandId: string)` → most-recently-updated conversation for that brand, or `null`.
  - `export async function touchConversation(id: string)` → bumps `updatedAt` to now.

- [ ] **Step 1: Add the helpers**

In `src/lib/db/queries/index.ts`, in the Chat section, add:

```ts
export async function getConversationById(id: string) {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, id))
    .limit(1);
  return conv ?? null;
}

export async function getLatestConversationForBrand(brandId: string) {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.brandId, brandId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);
  return conv ?? null;
}

export async function touchConversation(id: string) {
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
}
```

Confirm `desc` and `eq` are already imported at the top of the file (they are — used by existing helpers). Add nothing else.

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → `queries/index.ts` clean.
Run: `npm test` → suite still green (no behavior touched).

```bash
git add src/lib/db/queries/index.ts
git commit -m "feat(chat): add conversation lookup + touch query helpers"
```

---

### Task 3: Persist each turn in the chat route

Accept `conversationId` + `brandId`, verify ownership, lazily create the conversation, and persist the user message + assistant reply on stream finish.

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Test: `src/app/api/chat/ensure-conversation.test.ts` (new) — the testable ownership/create logic, extracted.
- Create: `src/app/api/chat/ensure-conversation.ts` (extracted helper)

**Interfaces:**
- Consumes: `getConversationById`, `createConversation`, `getBrandById` from `@/lib/db/queries`.
- Produces: `export async function ensureConversation(deps, args): Promise<{ ok: true } | { ok: false; status: number; error: string }>` where the conversation is created if absent (owned by `userId`/`brandId`) or validated for ownership if present. Dependency-injected so it is unit-testable without a DB.

- [ ] **Step 1: Write the failing test for the ownership/create logic**

Create `src/app/api/chat/ensure-conversation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ensureConversation } from "./ensure-conversation";

function deps(over: Partial<Parameters<typeof ensureConversation>[0]> = {}) {
  return {
    getConversationById: vi.fn().mockResolvedValue(null),
    createConversation: vi.fn().mockResolvedValue({ id: "c1" }),
    ...over,
  };
}

const args = { conversationId: "c1", brandId: "b1", userId: "u1" };

describe("ensureConversation", () => {
  it("creates the conversation when it does not exist, owned by the user+brand", async () => {
    const d = deps();
    const res = await ensureConversation(d, args);
    expect(res.ok).toBe(true);
    expect(d.createConversation).toHaveBeenCalledWith({
      id: "c1",
      brandId: "b1",
      userId: "u1",
    });
  });

  it("accepts an existing conversation owned by the same user", async () => {
    const d = deps({
      getConversationById: vi
        .fn()
        .mockResolvedValue({ id: "c1", userId: "u1", brandId: "b1" }),
    });
    const res = await ensureConversation(d, args);
    expect(res.ok).toBe(true);
    expect(d.createConversation).not.toHaveBeenCalled();
  });

  it("rejects an existing conversation owned by another user (403)", async () => {
    const d = deps({
      getConversationById: vi
        .fn()
        .mockResolvedValue({ id: "c1", userId: "someone-else", brandId: "b1" }),
    });
    const res = await ensureConversation(d, args);
    expect(res).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(d.createConversation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/chat/ensure-conversation.test.ts`
Expected: FAIL — module `./ensure-conversation` not found.

- [ ] **Step 3: Implement the extracted helper**

Create `src/app/api/chat/ensure-conversation.ts`:

```ts
type ConversationRow = { id: string; userId: string; brandId: string };

export interface EnsureConversationDeps {
  getConversationById: (id: string) => Promise<ConversationRow | null>;
  createConversation: (data: {
    id: string;
    brandId: string;
    userId: string;
  }) => Promise<unknown>;
}

export interface EnsureConversationArgs {
  conversationId: string;
  brandId: string;
  userId: string;
}

/**
 * Ensure a chat conversation exists and belongs to the caller. Creates it
 * (owned by userId+brandId) when absent; when present, verifies ownership.
 */
export async function ensureConversation(
  deps: EnsureConversationDeps,
  { conversationId, brandId, userId }: EnsureConversationArgs,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await deps.getConversationById(conversationId);
  if (!existing) {
    await deps.createConversation({ id: conversationId, brandId, userId });
    return { ok: true };
  }
  if (existing.userId !== userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/api/chat/ensure-conversation.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Wire persistence into the route**

Replace `src/app/api/chat/route.ts` with:

```ts
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildChatPrompt } from "@/lib/ai/prompts/chat";
import { flattenMessageText } from "@/lib/ai/chat-messages";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createConversation,
  createMessage,
  getBrandById,
  getConversationById,
  touchConversation,
} from "@/lib/db/queries";
import { ensureConversation } from "./ensure-conversation";

export async function POST(req: Request) {
  // Authenticated users only — this endpoint spends AI tokens.
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messages, brandContext, brandId, conversationId } =
    (await req.json()) as {
      messages: UIMessage[];
      brandContext: ChatBrandContext;
      brandId: string;
      conversationId: string;
    };

  if (!brandId || !conversationId) {
    return Response.json(
      { error: "Missing brandId or conversationId" },
      { status: 400 },
    );
  }

  // Verify the brand belongs to the caller before persisting under it.
  const brand = await getBrandById(brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  const ensured = await ensureConversation(
    { getConversationById, createConversation },
    { conversationId, brandId, userId: dbUser.id },
  );
  if (!ensured.ok) {
    return Response.json({ error: ensured.error }, { status: ensured.status });
  }

  const systemPrompt = buildChatPrompt(brandContext);
  const modelMessages = await convertToModelMessages(messages);

  // The just-sent user message is the last item; capture it for persistence.
  const lastUserMessage = messages[messages.length - 1];

  const result = streamText({
    model: getModel("chat"),
    system: systemPrompt,
    messages: modelMessages,
    // Persist the completed turn once, after the assistant reply is final, so a
    // stream that errors mid-flight never leaves an orphaned user row.
    onFinish: async ({ text }) => {
      try {
        if (lastUserMessage?.role === "user") {
          await createMessage({
            conversationId,
            role: "user",
            content: flattenMessageText(lastUserMessage),
          });
        }
        await createMessage({
          conversationId,
          role: "assistant",
          content: text,
        });
        await touchConversation(conversationId);
      } catch (err) {
        // Persistence failure must not break the user's chat experience.
        console.error("chat persistence failed", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
```

- [ ] **Step 6: Full verify + commit**

Run: `npx vitest run src/app/api/chat/ensure-conversation.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.json` → clean (confirm `createMessage` accepts `{ conversationId, role, content }` — `role` must be a `messageRoleEnum` value; "user"/"assistant" are valid).
Run: `npm run lint` → touched files clean.

```bash
git add src/app/api/chat/route.ts src/app/api/chat/ensure-conversation.ts src/app/api/chat/ensure-conversation.test.ts
git commit -m "feat(chat): persist conversation + messages on each chat turn"
```

**Manual verification note (needs DB + auth, cannot be unit-tested here):** send a chat message on `/strategy`; confirm a `chat_conversations` row and two `chat_messages` rows (user + assistant) appear, and `conversations.updatedAt` advances.

---

### Task 4: Restore the conversation on page load

Load the brand's most-recent conversation server-side and seed `useChat`; manage the client `conversationId`; send it (with `brandId`) on every request; start a fresh conversation on "New Strategy".

**Files:**
- Modify: `src/app/(dashboard)/strategy/page.tsx`
- Modify: `src/app/(dashboard)/strategy/strategy-client.tsx`
- Test: `src/app/(dashboard)/strategy/strategy-client.test.tsx` (new)

**Interfaces:**
- Consumes: `getLatestConversationForBrand`, `getConversationMessages` from `@/lib/db/queries`; `rowsToUiMessages` from `@/lib/ai/chat-messages`.
- Produces: `StrategyClient` gains props `initialMessages?: UIMessage[]` and `initialConversationId?: string | null`.

- [ ] **Step 1: Write the failing component test**

Create `src/app/(dashboard)/strategy/strategy-client.test.tsx`:

```tsx
import type { UIMessage } from "ai";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StrategyClient } from "./strategy-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({
  loadStrategy: vi.fn(),
  markStrategyActive: vi.fn(),
}));

const brandContext = {
  brandProfile: "Acme",
  audience: "",
  brandVoice: "",
  existingCampaigns: "",
  previousConversations: "",
};

describe("StrategyClient restore", () => {
  it("renders restored messages passed from the server", () => {
    const initialMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Remembered question" }],
      },
    ] as UIMessage[];
    render(
      <StrategyClient
        brandId="b1"
        brandName="Acme"
        brandContext={brandContext}
        initialMessages={initialMessages}
        initialConversationId="c1"
      />,
    );
    expect(screen.getByText("Remembered question")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-client.test.tsx"`
Expected: FAIL — `StrategyClient` ignores `initialMessages`; text not found.

- [ ] **Step 3: Update `StrategyClient`**

In `src/app/(dashboard)/strategy/strategy-client.tsx`:

1. Add imports at the top: `import type { UIMessage } from "ai";` and `import { useState } from "react"` already present (extend the existing react import to include nothing new — `useState` is imported).

2. Extend the props interface:

```ts
interface StrategyClientProps {
  brandId: string;
  brandContext: ChatBrandContext;
  brandName: string;
  pastStrategies?: StrategyHistoryItem[];
  initialMessages?: UIMessage[];
  initialConversationId?: string | null;
}
```

3. Destructure the new props and add conversation state (place near the other `useState` calls). Use a lazy initializer so the UUID is generated once:

```ts
export function StrategyClient({
  brandId,
  brandContext,
  brandName,
  pastStrategies = [],
  initialMessages = [],
  initialConversationId = null,
}: StrategyClientProps) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string>(
    () => initialConversationId ?? crypto.randomUUID(),
  );
  // ...existing useState calls unchanged...
```

4. Include `brandId` + `conversationId` in the transport body, and seed `useChat` with the restored messages:

```ts
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { brandContext, brandId, conversationId },
      }),
    [brandContext, brandId, conversationId],
  );

  const {
    messages,
    status,
    sendMessage,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({ transport, messages: initialMessages });
```

5. Pass the same body on `sendMessage` calls (both `handleSend` and `handlePickChip`), replacing the existing `{ body: { brandContext } }`:

```ts
    sendMessage({ text }, { body: { brandContext, brandId, conversationId } });
```

6. In `handleNewStrategy`, start a fresh conversation so new chat is persisted separately:

```ts
  const handleNewStrategy = () => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setStrategy(null);
    setStrategyId(null);
    setBuildError(null);
    setLoadError(null);
    setHistoryOpen(false);
  };
```

Leave `handleSelectStrategy` (the recap behavior) unchanged — restoring a past strategy's full chat is an explicit non-goal for this batch.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/(dashboard)/strategy/strategy-client.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Load the conversation in the page**

In `src/app/(dashboard)/strategy/page.tsx`, after computing `pastStrategies`, load the latest conversation + its messages and pass them down. Add imports for `getLatestConversationForBrand`, `getConversationMessages`, and `rowsToUiMessages`, then:

```ts
  const latestConversation = await getLatestConversationForBrand(brand.id);
  const initialMessages = latestConversation
    ? rowsToUiMessages(
        (await getConversationMessages(latestConversation.id)).map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      )
    : [];

  return (
    <StrategyClient
      brandId={brand.id}
      brandName={brand.name}
      brandContext={brandContext}
      pastStrategies={pastStrategies}
      initialMessages={initialMessages}
      initialConversationId={latestConversation?.id ?? null}
    />
  );
```

- [ ] **Step 6: Full verify + commit**

Run: `npm test` → full suite green (includes the new component test).
Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add "src/app/(dashboard)/strategy/page.tsx" "src/app/(dashboard)/strategy/strategy-client.tsx" "src/app/(dashboard)/strategy/strategy-client.test.tsx"
git commit -m "feat(chat): restore latest conversation on strategy page load"
```

**Manual verification note:** chat a few turns, refresh `/strategy` → the conversation reappears. Click "New Strategy" → chat clears and a new conversation id is used.

---

### Task 5: Link the generated strategy to its conversation

Send `conversationId` when building a strategy and store it on the strategy row.

**Files:**
- Modify: `src/app/(dashboard)/strategy/strategy-client.tsx` (`handleBuildStrategy` body)
- Modify: `src/app/api/strategy/generate/route.ts`
- Test: `src/app/api/strategy/generate/route.test.ts` (new) — assert `createStrategy` receives `conversationId`.

**Interfaces:**
- Consumes: existing `createStrategy` (already accepts `conversationId` via `strategies.$inferInsert`).

- [ ] **Step 1: Write the failing test**

Create `src/app/api/strategy/generate/route.test.ts`. Mock auth, queries, and the AI call so only the wiring is under test:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getBrandById = vi.fn();
const createStrategy = vi.fn();
const recordUsageEvent = vi.fn();
const generateObject = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getBrandById: (id: string) => getBrandById(id),
  createStrategy: (data: unknown) => createStrategy(data),
  recordUsageEvent: (data: unknown) => recordUsageEvent(data),
}));
vi.mock("ai", () => ({ generateObject: (opts: unknown) => generateObject(opts) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => ({}) }));
vi.mock("@/lib/ai/strategy-schema", () => ({ strategySchema: {} }));
vi.mock("@/lib/ai/prompts/strategy", () => ({
  buildStrategistSystemPrompt: () => "sys",
  buildStrategyGenerationPrompt: () => "prompt",
}));

import { POST } from "./route";

describe("strategy generate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    getBrandById.mockResolvedValue({ id: "b1", userId: "u1", name: "Acme" });
    generateObject.mockResolvedValue({ object: { campaignName: "Camp" } });
    createStrategy.mockResolvedValue({ id: "s1" });
  });

  it("stores the conversationId on the created strategy", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({
        brandId: "b1",
        conversation: "user: hi",
        conversationId: "c1",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: "b1", conversationId: "c1" }),
    );
  });

  it("still works when conversationId is omitted (null)", async () => {
    const req = new Request("http://x/api/strategy/generate", {
      method: "POST",
      body: JSON.stringify({ brandId: "b1", conversation: "user: hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/api/strategy/generate/route.test.ts"`
Expected: FAIL — route does not read/forward `conversationId`; `createStrategy` called without it.

- [ ] **Step 3: Forward `conversationId` in the route**

In `src/app/api/strategy/generate/route.ts`:

1. Extend the body type + destructure:

```ts
  let body: { brandId?: string; conversation?: string; conversationId?: string };
  // ...
  const { brandId, conversation, conversationId } = body;
```

2. Pass it to `createStrategy` (coalesce to `null` so the column is explicitly set):

```ts
    const strategy = await createStrategy({
      brandId,
      conversationId: conversationId ?? null,
      name: object.campaignName,
      structured: object,
      status: "active",
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/api/strategy/generate/route.test.ts"`
Expected: PASS (both cases).

- [ ] **Step 5: Send `conversationId` from the client**

In `src/app/(dashboard)/strategy/strategy-client.tsx`, in `handleBuildStrategy`, include it in the POST body:

```ts
        body: JSON.stringify({ brandId, conversation, conversationId }),
```

- [ ] **Step 6: Full verify + commit**

Run: `npm test` → full suite green.
Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npm run lint` → touched files clean.

```bash
git add "src/app/api/strategy/generate/route.ts" "src/app/api/strategy/generate/route.test.ts" "src/app/(dashboard)/strategy/strategy-client.tsx"
git commit -m "feat(chat): link generated strategy to its conversation"
```

---

## Self-Review

**Spec coverage (#5):**
- Persist chat messages to Postgres → Task 3 (route onFinish) + Task 1 (adapters) + Task 2 (helpers). ✓
- Restore on refresh → Task 4 (page load seeds useChat). ✓
- New Strategy → fresh conversation → Task 4 (`handleNewStrategy`). ✓
- Link chat → strategy (`strategies.conversationId`) → Task 5. ✓
- No new infra (Postgres only) → confirmed; no Redis. ✓

**Placeholder scan:** No TBD/vague steps; every code step shows full code. Manual-verification notes (DB/auth/streaming) are explicit, justified boundaries — the streaming `onFinish` path can't be unit-tested here, so its logic is minimized to two `createMessage` calls + `touchConversation`, and the testable ownership/create logic is extracted into `ensureConversation` (Task 3, unit-tested).

**Type consistency:** `flattenMessageText`/`rowsToUiMessages`/`StoredMessageRow` (Task 1) consumed in Tasks 3 & 4 with matching names. `getConversationById`/`getLatestConversationForBrand`/`touchConversation` (Task 2) consumed in Tasks 3 & 4. `ensureConversation(deps, args)` (Task 3) — deps names (`getConversationById`, `createConversation`) match `queries` exports. `StrategyClient` new props `initialMessages`/`initialConversationId` (Task 4) match the page's props (Task 4 Step 5). `conversationId` threaded client→route in Tasks 4 & 5 uses the same key.

**Known limitations documented (not defects):** `regenerate()` may persist a duplicate user row (flat schema has no client-msg-id to dedupe); past-strategy select keeps the recap (non-goal). Both are called out for the batch's final review, not fixed here.
