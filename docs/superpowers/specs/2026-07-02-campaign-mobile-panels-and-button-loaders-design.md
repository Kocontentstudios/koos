# Campaign page: mobile panels, past-strategy interaction, button loaders

Date: 2026-07-02
Branch: feat/strategy-view

## Problem

Three issues on the campaign (`/strategy`) page and auth pages:

1. **Campaign History** (left `<aside>`) and **Strategy Summary** (`StrategyPanel`) are
   `hidden lg:flex` — completely unreachable below the `lg` (1024px) breakpoint. Mobile
   users cannot open either.
2. Past strategies listed in the history are non-interactive (`cursor-default`, no handler);
   their saved `structured` JSON is never loaded back into the view.
3. Async-triggering buttons give weak/no progress feedback. Login/register already have a
   manual spinner, but it relies on a fragile `useState` pending flag inside a form-action
   transition. Other buttons (Generate Calendar, etc.) show only a text swap or nothing.

## Design

### Part 1 — Mobile drawers for History & Summary

Reuse the off-canvas drawer pattern from `components/layout/app-sidebar.tsx` (fixed panel,
`translate-x` transition, dimmed backdrop, close-on-tap-out).

- Extract the history list markup into a `StrategyHistory` component, rendered both as the
  desktop `lg:flex` aside and inside a mobile left drawer (single source of markup).
- Add a mobile-only (`lg:hidden`) toolbar in the chat column with two buttons:
  **☰ History** and **Summary ▤**.
- `StrategyClient` owns `historyOpen` / `summaryOpen` state. Opening one closes the other.
- `StrategyPanel` renders as a right-side fixed drawer below `lg` (driven by `summaryOpen`);
  its existing desktop collapse behavior at `lg+` is unchanged.
- Shared backdrop; selecting an item / firing an action closes the drawer.

### Part 2 — View & interact with past strategies

- New server action `loadStrategy(strategyId)` in `strategy/actions.ts`:
  authorize via `requireBrand` (strategy must belong to caller's brand), fetch with
  `getStrategyById`, validate `structured` with `strategySchema`, return typed `Strategy`.
- Clicking a history item loads it into the summary panel + inline card **and seeds the chat**
  with a short assistant context message, so the user can keep refining and rebuild.
- Loading item shows a spinner; failure shows an inline error. Active item is highlighted;
  the mobile drawer closes on select.

### Part 3 — Button loaders

1. Reproduce the login flow (systematic-debugging) to observe current pending behavior.
2. Harden auth forms: move login & register submit to React 19 `useActionState` +
   a `useFormStatus`-based submit button so pending state is framework-owned. Google
   buttons keep an explicit pending flag (they are not form submits).
3. Roll out the shared `Button` `loading`/`loadingText` props to async buttons that lack a
   spinner: **Generate Calendar** (`StrategyPanel` / `StrategyCard`), the new past-strategy
   load, and any design-request / brand-create submit missing one.

## Testing / Verification

- Unit: `loadStrategy` authorization + schema validation.
- Manual: run the app, resize to mobile, open both drawers, load a past strategy, and
  confirm each async button shows a spinner while pending.
- `pnpm typecheck` / lint / build green.
