# Design sequence eval

Measures the sequence planner (KOOS-AI-002): given a carousel or
presentation brief and a frame count, does `planSequence` deliver a set a
marketer would post? Exactly N frames, hook first and the action last, one
palette and footer system across the set, varied layouts, every brief fact
on some frame, and copy that a harsh reader says earns the swipe, carries
the action and never repeats itself.

```
pnpm eval:design-sequence                         # 6 briefs x N in {3, 5, 8}
pnpm eval:design-sequence --kind carousel --n 5   # the 4 carousels at 5 frames
pnpm eval:design-sequence --case event            # one brief, every N
pnpm eval:design-sequence --no-judge              # deterministic lane only
```

Paid lane. It calls whatever `getModel("strategy")` resolves to (Bedrock in
this repo's `.env`). The runner clears `AWS_BEARER_TOKEN_BEDROCK` so the
SigV4 keys are used. Each run makes 3 to 5 planner calls (brief read,
outline, copy, and the outline re-ask or repair pass when they are
needed), plus one judge call. A full run is 18 planner runs, three at a
time, and takes about 2.5 minutes. Run it before shipping a change to
`src/lib/design/sequence/` or `src/lib/ai/prompts/design-sequence.ts`, and
nightly. It is not part of `pnpm test`. Nothing is rendered, uploaded or
stored. The JSON report, with every plan and every judge reason, lands in
`qa-reports/eval/design-sequence.json` (gitignored).

## Fixtures

`cases.ts` holds four carousels (a cafe, a textile store, a SaaS launch, a
teen baking class) and two presentations (a seed pitch deck and a
sponsorship deck). Each case's facts and offering are labelled by hand, in
the brief's own words. Coverage is measured against those labels, never
against the brief reader the planner uses, so a reader miss shows up as a
coverage miss. `cases.test.ts` checks that every label appears in its brief
word for word.

## What it scores

The deterministic checks live in `score.ts` and run against the plan and
against the `frameSpec` output the renderer would draw:

| Metric | Meaning |
|---|---|
| `count` | Exactly N frames |
| `roles` | Hook first, cta last, body between, and a button on the last frame only |
| `paletteShared` | Every frame's spec has the same palette, logo, treatment and aspect, with at most one footer style. A presentation is 16:9 |
| `layoutVariety` | No frame uses its neighbour's layout or composition |
| `factCoverage` | Every labelled fact is stated on at least one frame (`factStated`), and the hook names the labelled offering |

The judge lives in `judge.ts`. It is a text judge on the same model path. It
sees the brief and the frames in order, never the planner's prompts, and
scores three things from 1 to 5:

| Metric | Question |
|---|---|
| `judgeHook` | Does frame 1 earn the swipe? |
| `judgeLastAction` | Does the last frame carry one clear action, with how to take it? |
| `judgeNonRepetitive` | Does each frame make its own point, so that read in order the set builds? |

## Frozen thresholds

These were written on 2026-10-30, before the first run, from rubric H13.
They are frozen in `SEQUENCE_EVAL_THRESHOLDS`, and `cases.test.ts` fails if
anyone edits them.

- `count`, `roles`, `paletteShared`, `layoutVariety` and `factCoverage`:
  **1.0**, meaning every run. The planner enforces or repairs each of these,
  so a single miss is a bug.
- `judgeHook`, `judgeLastAction` and `judgeNonRepetitive`: an average of
  **at least 4.0** over every judged run.
- A judge score that was never measured (`--no-judge`, or every judge call
  failed) is reported as "not measured". It never counts as a pass.

## Results so far

The latest numbers come from round 11, on the code as committed (2026-10-30, Bedrock
`us.anthropic.claude-sonnet-4-6`):

| Run | count | roles | palette | layouts | coverage | hook | last action | non-repetitive |
|---|---|---|---|---|---|---|---|---|
| 4 carousels, N=5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 3.50 | 5.00 | 3.50 |
| All 18 runs | 1.0 | 1.0 | 1.0 | 1.0 | 0.944 | 3.50 | 4.88 | 3.31 |

**The eval fails its frozen judge thresholds.** The deterministic lane holds
on every run except one, which is a coverage miss described below. Across
rounds 6 to 11 the judge's hook average stayed between 3.4 and 3.8 and its
non-repetition average between 3.2 and 3.7, with run-to-run swings of about
0.4 on the same code. The judge is the same model as the writer, and its
system prompt sets a 5 as beating Canva or Predis.

The low scores cluster in two places:

- **Thin briefs stretched to 8 frames.** The SaaS brief has 3 facts and the
  sponsorship deck has 4. Frames past the brief's real points get marked as
  filler. The planner is told never to invent a point.
- **Hooks that are accurate but generic**, such as "Send an invoice in under
  a minute". Code catches only the two shapes it can recognise: an
  announcement ("is here", "has arrived") and a headline that is only the
  offering's name (`hook.ts`).

The one remaining coverage miss is the SaaS brief. The brief reader takes
the offering to be the service phrase, not the app's name "Ledgerly". The
planner asks the hook to name the brand when the brief makes the brand its
subject (`hookNames`), and the repair pass asks again, but it does not
always land.

Earlier rounds, kept so later runs can be compared against them:

| Round | Change | hook | non-repetitive | coverage |
|---|---|---|---|---|
| 1 | first build | 3.25 | 2.25 | 0.75 |
| 3 | repeat checks (`repeats.ts`), fact ownership | 3.75 | 3.75 | 1.0 (N=5 only) |
| 6 | first full run, beats in the outline | 3.83 | 3.33 | 0.944 |
| 9 | phone/time rule, hook subheadline rule | 3.76 | 3.65 | 0.889 |
| 11 | hook must name the brand when it is the subject | 3.50 | 3.31 | 0.944 |
