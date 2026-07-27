# Epic 3 — Brand-Aware Agentic AI (Design Spec)

Status: Draft for review · Date: 2026-07-25 · Owner: engineering
Parent program: `.claude/plans/squishy-mapping-pixel.md`

## 1. Purpose

Make the platform's AI genuinely brand-aware and stateful. Today the chat receives a
pre-baked context string and can only talk; `previousConversations` is a hardcoded `""`
(`src/app/(dashboard)/strategy/page.tsx:32`) and no tools are passed to the model. This epic
turns the assistant into an agent that **pulls** any authorized brand resource through tools,
**remembers** across conversations, **proposes** writes the user confirms, and can **onboard**
a brand by interviewing the user (in chat or by voice) and offering to fill the profile.

Covers original requests **#3** (AI interacts with every brand resource), **#4** (onboarding
chat/call that generates brand info), and **#5** (memory / stateful).

Non-goals here: image generation (Epic 2), design-review UX (Epic 1), brand nav polish
(Epic 4).

## 2. Locked decisions

- **Human-in-the-loop:** the AI may read anything it is authorized for and may *draft* writes,
  but **nothing persists without an explicit user confirmation** (`read + propose, confirm`).
- **Onboarding:** ship **both** a text-chat interview and a **voice** option as working paths.
- **Voice providers pluggable** via env, defaulting to the browser Web Speech API (no metered
  cost); server STT/TTS providers are opt-in and their per-unit costs are stated below.

## 3. Current-state anchors (reuse, don't rebuild)

- Chat: `src/app/api/chat/route.ts` — `streamText` with `onFinish` persistence + best-effort
  title generation; modes `strategy` | `design`.
- Prompts: `src/lib/ai/prompts/chat.ts` (`ChatBrandContext`), `.../design-request.ts`,
  `.../brand.ts` (`buildBrandFieldPrompt`, `BRAND_SUGGEST_FIELDS`).
- Field-level AI: `src/app/api/brand/suggest/route.ts` (`generateObject`).
- Provider abstraction: `src/lib/ai/provider.ts` + `provider-config.ts`
  (`AiFeature = "chat" | "strategy" | "brand"`), text-only.
- Queries (`src/lib/db/queries/index.ts`): `getBrandById`, `getActiveBrandForMember`,
  `getAllBrandContexts`, `updateBrand`, `getStrategiesByBrand`, `getCalendarsForBrand`,
  `getCalendarItems`, `getActiveCalendarForBrand`, `getRecentConversationsForBrand`,
  `getConversationMessages`, `createDesignTicket`, `getDeliverables`, `updateCalendarItem`.
  Ticket creation business logic: `src/lib/design/ticket.ts`.
- Access guard: `checkBrandAccess(userId, brandId, "manage_content")` — used everywhere; the
  authoritative gate. **All tools must call it.**
- Stack: `ai@^6`, `zod@^4`, Bedrock default provider. Migrations via `scripts/migrate.mjs`
  (`_migrations` ledger; hand-written SQL because `drizzle/meta` is gitignored).

## 4. Architecture overview

```
User ⇄ Chat UI ──▶ POST /api/chat  ──streamText(tools)──▶ model
                        │                                   │
                        │        read tools ◀───────────────┤ (server-side, access-checked)
                        │        propose tools ──────────────┤ (return proposal objects; no writes)
                        ▼                                   ▼
                 proposal cards in UI              onFinish: persist turn + update memory
                        │
              user clicks Confirm
                        ▼
              POST /api/actions/confirm ──▶ apply write via existing mutations + usage_events
```

Two hard rules:
1. **Tools fetch server-side and re-authorize.** The client no longer supplies a trusted
   `brandContext` blob; the model calls tools that resolve the active brand from the session
   and `checkBrandAccess` before returning data.
2. **Propose ≠ write.** `propose_*` tools return a structured, typed proposal. Persistence
   happens only through `/api/actions/confirm`.

## 5. Phase 3A — Tool layer + propose/confirm

### 5.1 Tool module

New `src/lib/ai/tools/` with one file per concern and an `index.ts` registry:

```
src/lib/ai/tools/
  context.ts     // ToolContext: { userId, brandId } resolved in the route; passed to builders
  read.ts        // read tools
  propose.ts     // propose tools
  proposals.ts   // zod schemas + discriminated union of Proposal types (shared with confirm route)
  index.ts       // buildBrandTools(ctx) -> Record<string, Tool>
```

Each tool is defined with the AI SDK `tool()` helper (zod `inputSchema`, async `execute`).
Every `execute` first calls `checkBrandAccess(ctx.userId, ctx.brandId, "manage_content")` and
returns a typed error object if denied (the model surfaces it; it never throws to the stream).

**Read tools** (thin wrappers over existing queries):

| Tool | Backing query | Returns |
|------|---------------|---------|
| `get_brand_profile` | `getBrandById` + `getAllBrandContexts` | brand fields + context sections |
| `list_brand_assets` | `getBrandAssets` (add if missing) | logos/images/docs |
| `list_strategies` | `getStrategiesByBrand` | strategy names/status |
| `list_calendar_items` | `getActiveCalendarForBrand` + `getCalendarItems` | upcoming items |
| `list_design_tickets` | `listDesignTicketsForBrand` (new query) | tickets + status |
| `recall_memory` | `getBrandMemory` (Phase 3B) | brand summary + facts |
| `list_past_conversations` | `getRecentConversationsForBrand` | titles + dates |
| `read_conversation` | `getConversationMessages` | messages of one prior thread |

**Propose tools** (no DB write — return a `Proposal`):

| Tool | Proposal kind | Payload |
|------|---------------|---------|
| `propose_brand_field_updates` | `brand_fields` | partial `brandProfileSchema` diff |
| `propose_design_ticket` | `design_ticket` | designType, brief, dimensions, notes… |
| `propose_calendar_generation` | `calendar` | strategyId, date range, cadence |
| `propose_strategy` | `strategy` | name + prompt seed |

### 5.2 Proposal type (shared contract)

`src/lib/ai/tools/proposals.ts` exports a zod discriminated union `ProposalSchema` keyed on
`kind`, plus `type Proposal = z.infer<...>`. Each variant carries a stable `kind`, a
human-readable `summary`, and a typed `data`. This exact schema is reused by the confirm
endpoint and by the UI card renderer — one source of truth.

### 5.3 Chat route changes (`src/app/api/chat/route.ts`)

- Build `ctx = { userId: dbUser.id, brandId }` after the existing `checkBrandAccess`.
- Pass `tools: buildBrandTools(ctx)` and `stopWhen: stepCountIs(6)` to `streamText` for
  multi-step tool use.
- Keep `onFinish` persistence; extend it with the memory writer (Phase 3B).
- The client stops sending a trusted `brandContext`; the route no longer stuffs it into the
  prompt (a compact memory summary is injected instead — 3B).
- Guard model-agnostic tool support: Bedrock/Anthropic/OpenAI/Google all support tools; z.ai/
  openai-compatible may not — if `resolveProviderConfig("chat")` is a provider without tool
  support, fall back to the legacy no-tools prompt (documented in `provider-config.ts`).

### 5.4 System prompt (`src/lib/ai/prompts/chat.ts`)

Rewrite to be tool-aware: instruct the model to (a) call read tools before answering factual
brand questions, (b) never fabricate data, (c) for ANY change to brand/tickets/calendar/
strategy, call the matching `propose_*` tool and tell the user to confirm — never claim a
change was made. Inject the compact memory summary (3B). Preserve the existing tone guidance.

### 5.5 Confirm endpoint (`src/app/api/actions/confirm/route.ts`) — new

- Auth + rate-limit (reuse `checkRateLimit`).
- Body: `{ brandId, proposal }`; validate `proposal` with `ProposalSchema`.
- Re-run `checkBrandAccess`.
- Dispatch on `proposal.kind`:
  - `brand_fields` → `updateBrand(brandId, data)`.
  - `design_ticket` → existing ticket-creation path (`src/lib/design/ticket.ts`).
  - `calendar` → enqueue existing calendar generation job (reuse `src/lib/jobs`/generation).
  - `strategy` → existing strategy generation path.
- Record a `usage_events` row (`kind` per action).
- Return the created/updated resource id so the UI can link to it.

### 5.6 UI (proposal cards)

- A shared `ProposalCard` component renders any `Proposal` (`summary` + a typed detail view)
  with **Confirm** and **Dismiss**.
- Wire it into the chat surfaces. Assistant tool-call output that includes a proposal renders
  the card inline. Confirm → `POST /api/actions/confirm` → toast + `router.refresh()`; Dismiss
  → drop locally, no server call.
- Reuse the existing `sonner` toast + button/textarea primitives.

## 6. Phase 3B — Persistent memory (stateful)

### 6.1 Data model — new `brand_memory` table

```sql
CREATE TABLE brand_memory (
  brand_id   uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  summary    text NOT NULL DEFAULT '',
  facts      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ text, source, createdAt }]
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

One evolving row per brand: a rolling `summary` plus an append-only typed `facts` list. Add
the Drizzle table to `src/lib/db/schema.ts` and a hand-written migration run by
`scripts/migrate.mjs`.

### 6.2 Writer

In chat `onFinish`, best-effort (never breaks chat, mirrors title generation): summarize
salient new facts from the just-finished turn via a small `generateObject` call and upsert the
`brand_memory` row (merge facts, refresh summary, cap length). Failures are logged and
swallowed.

### 6.3 Reader

- Inject the compact `summary` into the system prompt (replaces the empty
  `previousConversations`).
- Expose `recall_memory` + `list_past_conversations` + `read_conversation` (Phase 3A) so the
  model can pull specifics on demand rather than dumping everything into context.

## 7. Phase 3C — Onboarding (chat + voice)

### 7.1 Chat interview

- New surface `src/app/(dashboard)/brand/onboarding/*` (a guided conversation). Reuse the chat
  stream with an onboarding system prompt that walks the user through the brand questions in a
  friendly order.
- New endpoint `POST /api/brand/onboarding/extract`: given the conversation so far, run
  `generateObject` against a schema derived from **`brandProfileSchema`**
  (`src/app/(dashboard)/brand/brand-profile-form.ts`) to extract structured field values.
  Reuse `buildBrandFieldPrompt` phrasing patterns from `src/lib/ai/prompts/brand.ts`.
- The extraction result is surfaced as a `propose_brand_field_updates` card (Phase 3A) →
  Confirm → `updateBrand` fills the profile. Works for a brand-new brand or to fill gaps in an
  existing one.

### 7.2 Voice option

Pipeline: browser mic → speech-to-text → the same text onboarding pipeline → text-to-speech
reply. STT/TTS are **provider-pluggable** exactly like the model config.

- **Default — browser Web Speech API** (`SpeechRecognition` + `speechSynthesis`): zero metered
  cost, Chrome-first. Where unsupported, the UI transparently degrades to the text interview.
- **Opt-in server providers** (`AI_STT_PROVIDER` / `AI_TTS_PROVIDER`, default `browser`):
  - STT: OpenAI Whisper / Deepgram.
  - TTS: OpenAI TTS / ElevenLabs.
  - New endpoints proxy audio to the selected provider using existing env-key conventions.

**Cost note (for the team to decide):** the browser option is free but lower fidelity and
browser-dependent. Server STT is billed per audio-minute and server TTS per character/second
(exact rates depend on the chosen provider) — these are surfaced in the settings copy, not
hard-committed here.

## 8. Provider-config additions (`src/lib/ai/provider-config.ts`)

- Extend `AiFeature` with `"onboarding"` (text model for extraction/interview).
- Add STT/TTS provider resolution (`AI_STT_PROVIDER`, `AI_TTS_PROVIDER`, default `browser`)
  following the same global-default + per-feature-override shape. (Image config lands in
  Epic 2 but shares this pattern.)

## 9. Error handling & security

- Tools return typed error objects on access denial; they never throw into the stream.
- The confirm endpoint is the single write path and re-authorizes every call — a forged
  proposal for another brand fails `checkBrandAccess`.
- Rate-limit chat (exists), confirm, and onboarding-extract endpoints.
- Memory writer and title generator are best-effort and isolated from the user-facing stream.
- No secrets in client code; voice server providers keyed by env only.

## 10. Testing

- **Unit/integration (vitest, co-located `*.test.ts`):**
  - Tool authorization: denied access → tool returns error, no data leak.
  - `ProposalSchema` round-trips; confirm dispatch calls the right mutation per `kind`.
  - Confirm endpoint rejects a proposal whose `brandId` the user can't access.
  - Onboarding extraction maps a transcript to valid `brandProfileSchema` fields.
  - Memory writer upserts/merges; reader injects summary; failure is swallowed.
- **End-to-end (`verify`/`run` skill against local dev):** the four scenarios in the master
  plan's verification section (fact recall, propose→confirm write + dismiss no-op, onboarding
  fills profile via chat and via browser voice, cross-conversation memory).
- **Lint/typecheck:** `corepack pnpm lint` + typecheck clean (WSL: never bare `pnpm`).

## 11. Phasing / sequencing

1. **3A** tool layer + propose/confirm + confirm endpoint + proposal cards (largest value;
   unblocks the rest).
2. **3B** memory table + writer/reader (makes it stateful).
3. **3C** onboarding chat, then voice (chat first; voice behind the browser default).

Each phase is independently shippable and testable.

## 12. Open items to confirm during implementation

- 3A v1 ships **all four** `propose_*` actions: brand fields, design ticket, calendar
  generation, and strategy (decision locked with the user, 2026-07-25).
- Whether `list_design_tickets` needs a new `listDesignTicketsForBrand` query (likely yes) and
  `list_brand_assets` a `getBrandAssets` query (confirm during build).
- Memory summarization cadence (every turn vs. every N turns) — start every-turn, tune if
  token cost warrants.
