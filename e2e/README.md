# e2e: rendered contrast

The rendered half of the colour contract (`docs/KO_OS UI.Specification.md`
9.2). The <2s gate (`src/app/theme-contrast.test.ts`,
`src/app/primary-token-usage.test.ts`) reads tokens and source. This lane reads
what Chromium actually paints, so it catches what a source scan cannot:
grounds held in a const, a map, a `cva` variant or a prop, interpolated class
names, opacity or a filter on an ancestor, pseudo-element and SVG grounds,
gradients, inset shadows, inherited foregrounds and HTML strings.

## When it runs

- **On every pull request** that touches `src/app/**`, `src/components/**`,
  `src/lib/theme/**`, the spec, `e2e/**`, `playwright.config.ts`, the
  lockfile or the workflow itself (`.github/workflows/contrast.yml`), against
  a throwaway Postgres service.
- **Nightly** on the default branch, so a change outside those paths is caught
  within a day.
- **By hand** with `corepack pnpm e2e:contrast` (below).

`src/app/contrast-lane-coverage.test.ts`, part of the gate, fails if the
workflow stops running the lane on those triggers.

## What it checks

Every route in `e2e/contrast/routes.ts`, in dark and light. The gate fails
when a `page.tsx` in `src/app` is neither in that list nor named in
`NOT_RENDERED` with a reason, so a new route cannot land unmeasured. Today
that is every page: the marketing and auth pages, the invite and access
gates, every dashboard route (including `/team`, `/settings`,
`/workspace/settings`, `/no-brands` and a design ticket), every admin route,
and the onboarding welcome and start. The one exception is the temporary
FEAT-033 preview harness, which is deleted before merge.

For each route and theme:

1. **It proves the page rendered.** The route's sentinel heading is visible,
   no `[data-error-boundary]` and no "Something went wrong" is on the page,
   the browser logged no error (one dev-only CSP notice and the probe's own
   request guard aside) and the server logged none (see *Server log*). Round 3
   measured an error boundary on `/brand` and passed; that can no longer
   happen.
2. **At 1440 px** it measures every visible text run, field value,
   placeholder, generated `::before`/`::after` text and list marker, scrolling
   the main scroller and then every inner scroller (a sideways strip, a panel
   with its own scrollbar) through their full extent. Closed `<details>` are
   opened first. Where the page styles `::selection`, selected text is
   measured too.
3. **At 1440 px, every target in every state.** No cap: a target that cannot
   be measured fails the route.
   - every control: hover, press, keyboard focus (a visually hidden skip link
     is focused even though it cannot be hovered);
   - every element a `:hover` rule restyles (a card, a row, a `group-hover`
     child): hover;
   - every disclosure (`aria-expanded`, `aria-haspopup`): open;
   - every plain button that declares nothing: clicked, and if the page
     changed, measured and reloaded. One button per kind: buttons whose tag,
     role, type, classes and label match, digits aside, are one kind (thirty
     date cells open the same component), so "Save" and "Delete" are both
     clicked but "12" and "13" only once;
   - every checkbox and switch: checked (`peer-checked`, `:has(:checked)`);
   - every shared `Button`: in its loading state (`data-loading`,
     `aria-busy`), which is what every `data-loading:` style keys on;
   - every element a `:target` rule restyles: targeted through the URL hash.

   In each state the probe measures the target and everything the state
   added or changed elsewhere: a tooltip or menu in a portal, content a
   disclosure revealed. While targets are probed, every request other than a
   read is refused before it leaves the browser, so clicking "Approve" or
   "Remove" shows its state without changing the seeded data the other routes
   are reading. A refused write is answered with a 503; the console errors
   that causes are kept apart as evidence, not counted against the page. While a modal dialog is open, the page under it is inactive
   and is not measured; the dialog and anything layered above it are.
4. **One width in every band** the breakpoints written in `src/` make
   (`widths.ts`: Tailwind's, arbitrary `min-[]` / `max-[]` ones and CSS media
   queries; today 390, 601, 640, 768, 901, 1024, 1025 and 1280 px), at rest,
   so an element shown only at some widths (`md:hidden`, `max-[1400px]:`) is
   on screen in some pass. The 1280 pass runs with reduced motion, so styles
   under `prefers-reduced-motion` are measured; the 390 pass also opens every
   disclosure, which is how a phone reaches the navigation. A new breakpoint
   in `src/` adds a pass.
5. **Timers.** Every `setTimeout` the page sets is recorded, and those due in
   the next five minutes are run as soon as the page has loaded, so content
   that appears after a delay (a poll result, a "still working" hint) is
   measured as shown. Intervals keep their pace and time stays real.
   Playwright's fake clock is not used: it also fakes animation frames and
   intervals, which stalled CSS reveals, fired webpack's chunk timeout early
   and set a 30-second poll firing in a loop. Finite CSS animations are run to
   their end state before each measurement.
6. axe-core's `color-contrast` rule runs on the 1440 pass as a cross-check.

Two more tests per theme hold the login button while its request is held
open: the real loading path, label "Signing in…", measured at rest and
hovered.

Every run must reach 4.5:1, or 3:1 for large text (24px, or 18.66px bold).

## How a run is measured

`probe.ts` takes two screenshots of the same frame: one as rendered and one
with every glyph made transparent. The second is the text's real background,
with gradients, pseudo-elements, shadows, SVG shapes, images, translucent
scrims and ancestor opacity already composited. The text colour comes from the
computed style when nothing between it and the screen changes it. Otherwise
(opacity, a filter, a blend mode, clipped text, a scrim over the text, selected
text, a text-shadow on transparent text) it comes from the glyph pixels. A part
of a word that an opaque layer covers (an open menu over a heading) is left
out of the word's box, so the menu's own pixels are never mistaken for the
word's. Two layers are treated the same way: frosted glass (a header with
`backdrop-filter`, which blurs what it covers on purpose) and the shadow a
fixed or sticky bar casts. Text the page scrolls under them is measured at
the scroll positions where it is clear of them.

`probe.spec.ts` is the probe's own test: static markup with known ratios, no
server, including every pattern round 3's critic found unmeasured. If the probe
stops seeing a kind of ground or a kind of state, it fails there first.

## Server log

`serve.mjs` starts `next dev` and writes its output to
`test-results/server.log`. Each route fails on any error the server logged
while it rendered (Next marks them `⨯`; "Event handlers cannot be passed to
Client Component props" is how round 3's crash showed), and the `server-log`
project reads the whole log once every route has run. The client closing a
response early is the one `⨯` line that is not an error. `server-log.test.ts`
pins both against round 3's log.

`next dev` holds every compiled route in memory. Under the heap cap in
`NODE_OPTIONS` it can run out, and V8 ends it; `serve.mjs` starts it again (up
to five times, each restart written to the log) and the lane retries a page
load that found no server.

## Running it

From the repo root, with the local database running
(`docker start koos-dev-db`) and migrated (`node scripts/migrate.mjs`), and
Chromium installed once per machine
(`corepack pnpm exec playwright install chromium`):

```sh
corepack pnpm e2e:contrast
```

That starts `next dev` on port 3417 against
`postgres://koos:koos@localhost:5434/koos` and runs the probe self-test, the
seed, every route and the server-log check. A full run takes about an hour
and a half with two workers; no step waits more than 15 seconds for an
element, so a run cannot hang on a page that changed under it. The rest of the app's environment comes from your `.env`.

- In a git worktree with a symlinked `node_modules`: `E2E_WEBPACK=1`
  (Turbopack refuses a symlinked `node_modules`).
- On a small machine: `E2E_WORKERS=1` and
  `NODE_OPTIONS=--max-old-space-size=3072`.
- Probe self-test only, no server: `E2E_NO_SERVER=1 corepack pnpm exec playwright test --project=probe`
- Against a server you started yourself: set `E2E_BASE_URL` and point
  `E2E_SERVER_LOG` at that server's output
  (`next dev --port 3417 2>&1 | tee server.log`). Without `E2E_SERVER_LOG`
  the lane fails rather than skipping the server check.
- Some routes: `E2E_ROUTES=brand,team` (labels from `routes.ts`); one theme:
  add `-g "brand \(dark\)"`. On a small machine, a full run in four
  `E2E_ROUTES` chunks, each against a fresh server, stays under a 3 GB heap.
- Trace every target as it is probed: `E2E_TRACE=/tmp/trace.log`.

The seed (`seed.ts`) deletes and recreates the `@example.test` accounts on
every run (a full account with a brand, a teammate and a pending invitation;
a staff admin; an unassigned member; an account awaiting approval; four
first-visit accounts), and clears the login rate limit. It refuses any
database that is not on localhost. Setup then loads every route once so
`next dev` has compiled them before anything is measured.

## Reading a failure

A failure names the pass, state, target, ratio, method and element:

```
desktop pass: text in each state
open of target 13 (control+disclosure) "AC" 4.45:1 < 4.5 (computed) "Invite Team" at main > div > button
```

`computed` means the text colour was read from the style and the ground from
the pixels. `pixels` means both came from the screenshot. `invisible` means the
text is painted in its own background's colour. `unmeasured` means the element
moved while it was being measured; it fails rather than passing unseen.

Evidence for every route (every measurement per pass, targets visited by kind,
refused requests, console errors, axe results, server errors) is written to
`test-results/contrast/<route>-<theme>.json`; CI keeps it, with the server log,
as the `contrast-evidence` artifact.

## What it cannot see

Each of these is out of reach of both the source gate and this lane, and is
listed in the spec (9.2) with the reason: raster images of text, content
inside a frame (the lane fails on any visible `iframe`, `embed` or `object`
rather than pass it), states only reachable through a flow that writes data,
a second level of disclosure, hover and focus below 1440 px, the second and
later buttons of one kind, content behind a timer longer than five minutes
or an interval, and the browser's own selection highlight.
