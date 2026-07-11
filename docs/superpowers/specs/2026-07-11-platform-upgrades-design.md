# Platform Upgrades — 12-Item Design (2026-07-11)

Approved design for the July 2026 platform upgrade batch on `feat/upgrades-001`.
Items are grouped into five independent workstreams (A–E), implemented as a
sequence of commits.

## Decisions (user-confirmed)

- AI design-request chat **reuses the strategy chat workspace** in a "Design
  Request Mode" — no separate chat UI.
- Calendar items **keep the prefilled Request Design form modal**; the AI chat
  flow applies to standalone requests (dashboard card, tickets page).
- Calendar generation supports **up to ~90 days**; when the strategy gives a
  duration but no explicit dates, the calendar **starts today**.
- PostHog is wired behind env vars (**no-op when unset**); user adds keys in
  Vercel later. The existing `usage_events` table stays.
- The duplicate calendar shortcut removed is the **Welcome hero CTA when setup
  is complete** (setup-stage CTAs stay).
- `/strategy` **always opens a fresh chat**, including from sidebar nav;
  history reopens past conversations.

## A. Quick wins (items 1, 2, 3, 7, 9, 11)

1. **Clickable hero stats** — `dashboard/page.tsx`: wrap "Posts this week" in
   `<Link href="/calendar">` and "Open design tickets" in
   `<Link href="/design-request">`, with a hover affordance.
2. **Remove duplicate calendar shortcut** — when `setupComplete`, do not render
   the hero CTA button (`setup.nextCta`); during setup stages it renders as
   today.
3. **Month view default** — `calendar-client.tsx`: `withDefault("week")` →
   `withDefault("month")`.
7. **Rename button** — `strategy-history.tsx`: "New Strategy" → "New Chat".
9. **Rename label** — `calendar-item-drawer.tsx`: both "Caption / Brief"
   labels → "Brief".
11. **Mobile chat wrapping** — `message-list.tsx`: add `min-w-0` and
    `break-words` to the bubble; Markdown code blocks/tables scroll inside
    their own container (`overflow-x-auto`) instead of widening the page.

## B. Chat behavior (items 5, 6)

5. **Always fresh chat** — `strategy/page.tsx` no longer loads the latest
   conversation into `initialMessages`; every visit starts with a new
   `conversationId` and empty messages. Recent Chats list is unchanged and
   remains the way back into old conversations.
6. **Smart titles** — after the first completed exchange of a new
   conversation, the chat route (`onFinish`) fires a small `generateText`
   call: produce a 3–7 word descriptive title (e.g. "30-Day Launch Awareness
   Content Plan") from the first user message + assistant reply, then
   `updateConversationTitle`. Fire-and-forget inside try/catch; the truncated
   first-message title remains as fallback.

## C. AI-assisted Design Request + structured briefs (items 4, 10)

**Entry points:** dashboard "Request a Design" card and a "New Request" button
on `/design-request` both link to `/strategy?mode=design`.

**Mode-aware chat:** `StrategyClient` accepts `initialMode: "strategy" |
"design"`. The mode is sent in the chat request body; the chat route selects
the system prompt:

- `buildDesignRequestChatPrompt` (new, `lib/ai/prompts/design-request.ts`):
  KO knows the goal is a design request, not a campaign. It gathers, in 1–2
  questions at a time: what the design is about, its objective, the format
  (flyer, carousel, banner, …), and specific requirements/branding notes.

**Brief generation:** in design mode the "Build Strategy" button is replaced
by **"Generate Design Brief"** → `POST /api/design-brief/generate` (async job,
same 202+poll pattern as strategy/calendar) → `generateObject` with
`designBriefSchema`:

```
{ title, designType, dimensions?, slides?, briefMarkdown, notes? }
```

`briefMarkdown` follows per-format section templates:

- **Carousel:** Title, Objective, Slide 1..N, Caption, CTA, Design Notes /
  Visual Direction
- **Single (static):** Request Title, Objective, Text Overlay, Supporting
  Copy, Visual Direction / Image Suggestion, Branding Requirements, CTA
- **LinkedIn post/article:** Title, Main Content, Supporting Caption, CTA,
  Suggested Visual / Cover Image
- **Video:** Video Title, Objective, Concept Summary, Scene Breakdown /
  Script, Text Overlays, Visual Direction, Caption, CTA

The brief renders in the right-hand panel (design-mode counterpart of the
strategy summary panel) as markdown with a **Request Design** button that
POSTs the existing `/api/design-tickets` endpoint (brief = markdown, plus
designType/dimensions/slides). Existing ticket confirmation + email flow is
reused.

**Item 10 — calendar briefs:** the same per-format structures are added to the
calendar generation prompt so every calendar item brief is structured
markdown adapted to its content type. Briefs render as markdown in the
calendar item drawer and admin ticket view (edit stays a raw textarea).

**Persistence:** `conversations.mode` column (`strategy` | `design`, default
`strategy`) via hand-written SQL migration applied with `scripts/migrate.mjs`.

## D. Calendar timeline fix (item 8)

Root cause: prompt hardcodes "plan 14 days" (`dayOffset` 0–13) and the
scheduler always starts at `upcomingMonday(now)` — the strategy `timeline` is
ignored for scheduling.

- `calendarPlanSchema` gains `startDate` (ISO `YYYY-MM-DD`) and allows
  `dayOffset` 0–89.
- The prompt includes **today's date** and instructs: derive the window from
  the strategy timeline ("August" → Aug 1–31 of the next occurrence; "30
  days" with no dates → 30 days starting today; no timeline info → 14 days
  starting today). Hard cap 90 days.
- `toCalendarRows` uses the validated AI `startDate` (fallback: today;
  clamp: not >1 year out, dayOffsets capped at 89).

## E. PostHog analytics (item 12)

- `posthog-js` client provider (pageviews + client events) and a
  `posthog-node` server capture helper (`lib/analytics/posthog.ts`). Both
  **no-op when `NEXT_PUBLIC_POSTHOG_KEY` is unset**.
- Server events, each with `user_id`, `brand_id`, and a session-scoped
  `session_id`: `signed_up`, `brand_brain_started`, `brand_brain_completed`,
  `chat_started` (mode property), `strategy_generated`,
  `calendar_generated`, `design_brief_generated`, `design_ticket_submitted`.
- Funnels to build in PostHog (documented in `docs/analytics.md`):
  1. `signed_up` → `brand_brain_completed` (% completing Brand Brain)
  2. `brand_brain_completed` → `strategy_generated` same `session_id`
     (% generating first campaign in-session)
- Existing `usage_events` DB table is untouched and keeps recording.

## Testing

- Unit: schedule start-date handling, title generation helper, design brief
  schema/prompt selection, setup-state CTA visibility.
- Existing vitest suite must stay green; biome lint + tsc clean.
- Manual: drive dashboard links, month view, fresh-chat behavior, design-mode
  conversation end-to-end, calendar generation for an explicit-month strategy.
