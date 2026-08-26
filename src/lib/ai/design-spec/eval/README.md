# Design spec (art director) eval

Measures whether a generated design actually uses the brand's colours.

```
pnpm eval:design-spec                      # all cases
pnpm eval:design-spec --case named-colour
```

Paid lane. Each case is one real `generateObject` call against
`getModel("strategy")` — text only, no images, so it is far cheaper than
`eval:design`. Run it before shipping a change to
`src/lib/ai/prompts/design-spec.ts`, `src/lib/design/spec.ts`, or the model —
and nightly. Not part of `pnpm test`.

## Why this lane exists

`eval:design` does **not** cover the art-director step. That suite calls the
image adapter with literal prompt strings from `src/lib/ai/image/eval/cases.ts`
and never builds `buildDesignSpecSystemPrompt`, so the prompt that decides a
design's palette had no eval coverage at all.

The regression it guards is real and shipped: the prompt told the model that
`"palette" should be drawn from the brand's colours` while `brandBlock()`
emitted no colour fields whatsoever. The art director was asked for something
it had never been given, and invented a palette instead. `brandPalette()` in
`design-spec.ts` fixed that; this lane is what proves it stays fixed.

Verified to have teeth: removing `brandPalette(brand)` from the prompt drops
`full-palette` to `brandColorUse 0.00` and the run exits non-zero.

## What it scores

Deterministically, in `score.ts` — no judge, because each of these has exactly
one right answer for a given output:

| Metric | Meaning | Threshold |
|---|---|---|
| `validHex` | Every palette slot parses as a hex | 1.0 (every case) |
| `brandColorUse` | A slot equals a colour the brand actually stated | 0.8 |
| `contrastOk` | Foreground clears 4.5:1 on background *before* `resolvePalette` | 0.75 |
| `namedColorMisses` | A brand colour given by name reached the wrong hue | 0 |

Two scoring decisions worth knowing:

- **A brand that states no hexes is excluded from `brandColorUse`, not scored
  zero.** The prompt explicitly tells the model to choose a fitting palette in
  that case, so counting it as a miss would penalise correct behaviour.
- **`contrastOk` reads the model's raw output, not `resolvePalette`'s.**
  `ensureReadablePair` would rescue an unreadable pair downstream and hide the
  fact that the prompt is producing bad ones.

## Cases

| Case | What it covers |
|---|---|
| `full-palette` | Five-colour brand — the palette should reach for the stated hexes |
| `two-colours-only` | The pre-feature shape, primary + secondary with no extras |
| `named-colour` | Conversational path stores `"forest green"`; scored by hue, not exact hex |
| `no-colours` | No stated colours — must still return usable, readable hexes |
