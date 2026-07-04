# Strategy View — Single Scrollable, Responsive Surface

**Date:** 2026-07-04
**Feature:** 1 of 3 (strategy / design-request-emails / admin)
**Status:** Approved design, pending implementation plan

## Problem

On the strategy page, opening a past or newly generated strategy makes the chat
appear to "freeze" — AI responses stream but get pushed out of view, and the
strategy content itself is not scrollable.

### Root cause (verified, read-only)

The selected strategy renders in **two** places simultaneously, both driven by
the same `strategy` state:

1. An inline `StrategyCard` (`strategy-card.tsx`) wedged into the chat column at
   `strategy-client.tsx:307-323`, **between** the scrollable `MessageList` and
   the sticky `ChatInput`. It is a full-height, **non-scrolling** flex sibling.
2. The right-side `StrategyPanel` (`strategy-panel.tsx`), which already has its
   own scroll region.

The outer container is fixed-height and clips: `h-[calc(100vh-56px)] flex
overflow-hidden` (`strategy-client.tsx:197`). The chat column is `flex-1 flex
flex-col min-w-0`. Because the inline card is a non-scrolling sibling with a
large intrinsic height, it steals vertical space from the `flex-1` `MessageList`
(`overflow-y-auto`, `message-list.tsx:33-35`). New streaming messages render in
the now-compressed/clipped region and disappear. Nothing disables chat —
`handleSend` only checks `isLoading`.

## Goals

- One strategy surface, fully scrollable.
- Chat is never clipped or crowded, whether or not a strategy is open.
- Responsive / mobile-first: best treatment on every device.

## Design

Make `StrategyPanel` the **only** strategy surface; remove the inline
`StrategyCard` block from the chat column.

- **Desktop (≥lg):** 320px side `<aside>` panel that coexists with chat. User
  reads the strategy while continuing to chat. Panel body scrolls independently;
  the message list keeps its full `flex-1` height.
- **Mobile / tablet (<lg):** the panel becomes a full-screen scrollable overlay
  sheet with a backdrop and a visible close button (extends the existing
  `translate-x` drawer at `strategy-panel.tsx:252-256`). Closing returns to
  chat. This is the "modal" behavior for small screens where side-by-side is not
  feasible.
- Selecting a history item (`handleSelectStrategy`, `strategy-client.tsx:157-192`)
  still seeds the chat recap **and** opens the panel. Closing the panel must not
  clear the chat seed or the `strategy` state used for refining.
- Provide a visible open/close affordance (toggle) so the user can re-open the
  panel after closing it while a strategy is loaded.

### Components / files

- `strategy-client.tsx` — remove inline `StrategyCard` block (~307-323); add
  panel open/close state; pass selected `strategy` into `StrategyPanel`; wire
  history selection to open the panel.
- `strategy-panel.tsx` — ensure the whole body scrolls (including any
  overflowing accordion sections); add explicit close button on desktop rail and
  mobile sheet; confirm responsive overlay behavior.
- `strategy-card.tsx` — reuse its per-section rendering **inside** the panel
  (either render it within the panel's scroll region or fold its section markup
  into the panel). No longer rendered inline in the chat column.

### Error handling / edge cases

- Preserve existing `loadStrategy` authorization + schema-validation error paths
  (`strategy/actions.ts`).
- Closing the panel keeps `strategy`/`strategyId` state so the user can re-open
  and continue refining.
- Empty state (no strategy loaded) unchanged.

## Testing

- Desktop: load a past strategy, confirm the panel scrolls end-to-end and the
  chat keeps streaming/scrolling with the panel open.
- Mobile viewport: confirm the strategy opens as a scrollable overlay with a
  working close button, and chat is fully usable after closing.
- Regression: sending messages while a strategy is open never clips responses.

## Out of scope

- Changes to strategy generation, the AI prompt, or the schema.
- Any redesign of the history list beyond opening the panel on select.
