# KOS-V1-FEAT-003 — Campaign strategy chat and strategy card actions

Date: 2026-08-25
Status: Implemented

## Problem

"Campaigns" is the `/strategy` route. A generated strategy was a second-class
citizen of the chat that produced it:

- It rendered only in the right-hand `StrategyPanel`; there was no card in the chat.
- Reopening a past chat wiped it, leaving a thin "View Strategy" banner.
- Chat titles were the first user message truncated to 60 chars, never the campaign.
- A strategy confirmed from a chat proposal was written with `conversationId: null`,
  orphaning it from the chat that proposed it.
- `createStrategy` wrote `status: "active"` immediately, so "just generated" and
  "the user stands behind it" were indistinguishable.

## Outcome

A campaign is a durable object living in its own chat: reviewable, refinable,
savable, and traceable from chat → strategy → calendar → design request.

Measured by `strategy_saved` and `strategy_reopened` (new events) alongside the
existing `strategy_generated`, and by `pnpm eval:strategy`, which scores whether
one chat yields one focused campaign.

## Key decision: a persisted-row card, not a message part

`chat_messages.content` is flat text and tool-call parts are never persisted
(`src/app/api/chat/route.ts` `onFinish`). A card rendered as a message part
cannot survive a reload, which would break "return to a previous strategy chat
without losing the campaign details."

The card is therefore derived from the `strategies` row and pinned via
`MessageList`'s `footer` prop — the same wiring `DesignBriefCard` already used.
The data model already supported this: `strategies.conversationId` existed.
No `campaigns` table was needed; the campaign entity *is* `strategies`.

## Lifecycle

```
generate → status "draft"  → card appears, labelled Draft
Save     → status "active" → earlier versions in the same chat → "archived"
Rebuild  → new row, draft  → card versions in place; one campaign per chat
```

`getLatestStrategyForConversation` returns the newest non-archived row, so the
card, the sidebar badge and the API agree on what a chat's campaign is.

## Card actions

| Action | Behavior |
|---|---|
| Open | Loads the strategy into the right-hand `StrategyPanel`; the chat is untouched. |
| Review | Posts a recap into the chat as a **persisted** assistant message, so a follow-up refinement still reads in context after a reopen. |
| Save | Commits the campaign; the Save slot is then replaced by Generate Calendar. |

An ephemeral, client-only recap was rejected: it would leave the user's next
message dangling with no context when the chat was reopened.

## Chat titles

On generation the chat takes the campaign's name. A user rename sets
`chat_conversations.title_custom`, and every automatic title write carries
`title_custom = false` in its `WHERE` clause. The predicate is in the SQL, not
in a read-then-branch, because the AI titler runs in a background `onFinish`
while the user may be typing a rename — a check-then-write has a window where
the background write wins.

## Files

- `drizzle/0023_campaign_chats.sql` — `title_custom`, index on `strategies(conversation_id)`
- `src/lib/strategy/campaign-card.ts` — card shape, meta line, recap, title rule
- `src/lib/strategy/sidebar-groups.ts` — which strategy a chat owns vs. Older Strategies
- `src/app/(dashboard)/strategy/strategy-card.tsx` — the card
- `src/app/(dashboard)/strategy/chat-footer-cards.tsx` — mode separation for pinned cards
- `src/app/(dashboard)/strategy/conversation-row.tsx` — chat row with inline rename
- `src/app/(dashboard)/strategy/actions.ts` — `saveStrategy`, `addStrategyRecap`
- `src/app/api/chat/conversations/[id]/route.ts` — GET returns the card; PATCH renames

## Tests and eval

Gate lane: 1424 vitest tests, including regressions for the `conversationId: null`
orphaning bug and for archived versions outranking the version that superseded them.

Paid lane: `pnpm eval:strategy` — four cases scored deterministically on whether
the campaign name carries the chat's topic and whether topics the user set aside
leaked in. See `src/lib/ai/strategy/eval/README.md`.

## Deliberate non-goals

- No `campaigns` table; `strategies` is the campaign.
- No direct `design_tickets → strategies` FK; the calendar-item join already carries it.
- No full-page `/strategy/[id]` route.
- No "unsave"; Rebuild is the escape hatch from a committed campaign.
