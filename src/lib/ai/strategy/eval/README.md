# Campaign strategy eval

Measures the one thing the campaign-chat feature promises and tests cannot
check: that a chat produces **one focused campaign**, named after the thing the
user actually settled on.

```
pnpm eval:strategy            # all cases
pnpm eval:strategy --case one-campaign-from-many-topics
```

Paid lane. Each case is one real `generateObject` call against
`getModel("strategy")`. Run it before shipping a change to
`src/lib/ai/prompts/strategy.ts`, `strategy-schema.ts`, or the strategy model —
and nightly. Not part of `pnpm test`.

## What it scores

Deterministically, in `score.ts` — no judge, because each of these has exactly
one right answer for a given output:

| Metric | Meaning | Threshold |
|---|---|---|
| `nameFocus` | The campaign name carries the chat's topic | 1.0 (every case) |
| `objectiveFocus` | The objective/key message keep the user's stated anchors | 0.75 |
| `mixedTopics` | Topics the user set aside that leaked into the campaign name | 0 |
| `shapeErrors` | Empty/over-long/boilerplate name, no channels, no phases | 0 |

`one-campaign-from-many-topics` is the case that matters most: the user names a
hiring push, a podcast and a store opening, then picks the store opening. A
strategy whose name mentions the podcast has merged two campaigns into one
chat — exactly what per-campaign chats exist to prevent.

Report lands at `qa-reports/eval/strategy-focus.json`. Non-zero exit when any
case fails.

The scorer itself is covered by gate tests in `score.test.ts`, so a broken
scorer fails on every commit rather than silently passing a bad run.
