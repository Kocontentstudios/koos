# e2e: rendered contrast

The periodic lane for colour contrast. It is not part of the <2s gate: it needs
a browser, a dev server and the local database, and a full run takes 5 to 12
minutes (less once the dev server has compiled the routes). Run it before shipping any change to colour tokens, `globals.css`,
`landing.css`, `button.tsx` or a page's palette, and nightly.

The gate (`src/app/theme-contrast.test.ts`, `src/app/primary-token-usage.test.ts`)
checks tokens and the pairs `src/` writes. This lane checks what the browser
actually paints, so it catches what a source scan cannot: grounds held in a
const, a map, a cva variant or a prop, interpolated class names, opacity or a
filter on an ancestor, pseudo-element and SVG grounds, gradients, inset shadows,
inherited foregrounds and HTML strings.

## What it checks

`contrast.spec.ts` opens each route below in dark and light, scrolls the main
scroller through its full height, and measures every visible text run, field
value and placeholder. It then hovers, presses and keyboard-focuses each
visible enabled control and measures that control's text in each state. Every
run must reach 4.5:1, or 3:1 for large text (24px, or 18.66px bold).

| Route | Account |
| :---- | :---- |
| `/`, `/login` | signed out |
| `/dashboard` (with sidebar), `/calendar`, `/design-studio`, `/strategy`, `/brand`, `/design-request` | `full`: a brand, a strategy, a week of calendar items in every status, a ticket in every lifecycle status |
| `/dashboard` with the welcome dialog | a new account per theme |
| `/brand/onboarding` | a new account per theme |

The measurement (`probe.ts`) takes two screenshots of the same frame: one as
rendered and one with every glyph made transparent. The second is the text's
real background, with gradients, pseudo-elements, shadows, SVG shapes, images
and ancestor opacity already composited. The text colour comes from the
computed style when nothing between it and the screen changes it. Otherwise
(opacity, a filter, a blend mode, clipped text) it comes from the glyph pixels.

axe-core's `color-contrast` rule runs on the same page as a cross-check. axe
alone is not enough: on the evasion corpus it reported a gradient, a
`before:` box, an SVG shape and a data-URI ground as "incomplete" and missed a
brightness filter and a hover fade entirely.

`probe.spec.ts` is the probe's own test: static markup with known ratios, no
server. If the probe stops seeing a kind of ground, it fails there first.

## Running it

From the repo root, with the local database running
(`docker start koos-dev-db`) and migrated:

```sh
corepack pnpm e2e:contrast
```

That starts `next dev` on port 3417 against
`postgres://koos:koos@localhost:5434/koos` and runs the probe self-test, the
seed and every route. The rest of the app's environment (session secret and so
on) comes from your `.env` as usual.

- Probe self-test only, no server: `E2E_NO_SERVER=1 corepack pnpm exec playwright test --project=probe`
- Against a server you already started: `E2E_BASE_URL=http://localhost:3417 corepack pnpm e2e:contrast`.
  In a git worktree with a symlinked `node_modules`, start that server with
  `next dev --webpack`: Turbopack refuses a symlinked `node_modules`.
- One route: add `-g "calendar"`.
- Fewer browsers at once on a small machine: `E2E_WORKERS=1`.

The seed (`seed.ts`) deletes and recreates five `@example.test` accounts on
every run, and clears the login rate limit. It refuses any database that is not
on localhost.

## Reading a failure

A failure names the route, theme, state, ratio, method and element:

```
rest 3.47:1 < 4.5 (computed) "PO" at div.hero-visual-card-1 > div.hvc-header > div.hvc-avatar
```

`computed` means the text colour was read from the style and the ground from
the pixels. `pixels` means both came from the screenshot. `invisible` means the
text is painted in its own background's colour. `unmeasured` means the element
moved while it was being measured; it fails rather than passing unseen.

Evidence for every run (all measurements, skipped controls, axe incomplete
nodes) is written to `test-results/contrast/<route>-<theme>.json`, which is
gitignored.
