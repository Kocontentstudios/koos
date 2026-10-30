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
SigV4 keys are used. Each run makes 5 to 9 planner calls (brief read,
outline, two copy drafts in parallel, hook versions, and when needed the
outline re-ask, the draft or hook choice and the repair pass), plus one
judge call. A full run is 18 planner runs, three at a time, and takes
about 10 minutes. Each run also prints the copy faults the planner could
not get rewritten (`PlannedSequenceResult.faults`), and the report keeps
them per run, so a flat hook or a line said twice is counted, never
silent. Run it before shipping a change to
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

The latest numbers come from round 2 of the revision (2026-10-30, Bedrock
`us.anthropic.claude-sonnet-4-6`), three full runs on the pipeline as
committed or one change from it. Logs and JSON reports are in
`/tmp/feat-multiframe/critique/u1r2/` (`eval-full-a`, `-b`, `-c`).

| Run | count | roles | palette | layouts | coverage | hook | last action | non-repetitive |
|---|---|---|---|---|---|---|---|---|
| All 18 runs, full-a | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 3.78 | 4.94 | 3.61 |
| All 18 runs, full-b (3 drafts, slack 2: reverted) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 3.78 | 5.00 | 3.44 |
| All 18 runs, full-c (as committed) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 3.72 | 4.94 | 3.22 |

**The eval still fails its frozen judge thresholds.** The deterministic
lane now holds on every run, coverage included: the SaaS "Ledgerly" miss is
gone because the hook is held to every name it must carry and asked for
again on its own when it misses one. The judge's hook average moved from
3.50 to 3.72 to 3.78 and its non-repetition average from 3.31 to between
3.22 and 3.61. Run-to-run swings on the same code are about 0.4, so the
non-repetition change is inside the noise.

The judge is not the problem. A calibration run
(`/tmp/feat-multiframe/critique/u1r2/judge-calibration.json`) put a
hand-written textile set through the frozen judge three times and got
5/5/5 each time, with the same reasons. A hand-written SaaS set that made
the reminder point on two frames got 2 for non-repetition three times out
of three. The judge is strict and consistent; the planner's copy is not yet
at that level.

The low scores cluster in two places:

- **Thin briefs stretched to 8 frames, and the decks.** The sponsorship
  deck has 4 facts and scores 2 or 3 for non-repetition at every N. The
  frames past the brief's real points get marked as filler. The planner is
  told never to invent a point, and code never writes one.
- **Hook subheadlines that only name the offering**, such as "Teen
  sourdough baking class with head baker Tunde Okafor" under "Can your teen
  bake real sourdough?". The judge gives that 3 or 4. Code catches
  announcements in either line, a subheadline echoing its headline, a name
  the hook leaves out, and a hook that spends a later frame's point
  (`hook.ts`). What remains is taste, and the editor's choice between
  versions (`choose.ts`) has not moved it past 3.8.

What did not help, so the next attempt does not repeat it: an editor call
that wrote notes for the repair pass (non-repetition 3.25 to 3.5 on the
carousels at N=5, and it asked for scarcity the brief never gave), and
three drafts with the editor choosing among any within two faults of the
best (full-b above).

Earlier rounds, kept so later runs can be compared against them:

| Round | Change | hook | non-repetitive | coverage |
|---|---|---|---|---|
| 1 | first build | 3.25 | 2.25 | 0.75 |
| 3 | repeat checks (`repeats.ts`), fact ownership | 3.75 | 3.75 | 1.0 (N=5 only) |
| 6 | first full run, beats in the outline | 3.83 | 3.33 | 0.944 |
| 9 | phone/time rule, hook subheadline rule | 3.76 | 3.65 | 0.889 |
| 11 | hook must name the brand when it is the subject | 3.50 | 3.31 | 0.944 |
| R2 | venue facts as the directions read them, hook versions every run, two drafts and an editor's choice, cross-frame recap drops, phrase, action and hook-preview checks | 3.78 | 3.61 | 1.0 |
