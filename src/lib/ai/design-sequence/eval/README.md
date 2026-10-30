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
pnpm eval:design-sequence --set held-out          # the 4 held-out briefs x N
pnpm eval:design-sequence --report /tmp/x.json    # write the report elsewhere
```

Paid lane. It calls whatever `getModel("strategy")` resolves to (Bedrock in
this repo's `.env`). The runner clears `AWS_BEARER_TOKEN_BEDROCK` so the
SigV4 keys are used. Each run makes 5 to 8 planner calls, never more than
`MAX_MODEL_CALLS` (9, the brief read included): the brief read, the
outline, two copy drafts in parallel, and the one edit pass (the problems
code found, the hook in three angles and the editor's own review of which
frames repeat another, in a single call); when needed, the outline re-ask,
the draft choice and the hook choice. Plus one judge call. A full run is
18 planner runs, three at a time, and takes about 10 minutes. Each run
also prints the copy faults the planner could not get rewritten
(`PlannedSequenceResult.faults`), and the report keeps them per run, so a
flat hook or a line said twice is counted, never silent. Run it before
shipping a change to `src/lib/design/sequence/` or
`src/lib/ai/prompts/design-sequence.ts`, and nightly. It is not part of
`pnpm test`. Nothing is rendered, uploaded or stored. The JSON report, with
every plan and every judge reason, lands in
`qa-reports/eval/design-sequence.json` (gitignored).

## Fixtures

Two sets, scored and reported separately against the same frozen
thresholds:

- **Tuning** (`SEQUENCE_EVAL_CASES`, the default): the six briefs rounds 1
  to 3 read to change the prompt.
- **Held out** (`SEQUENCE_HELD_OUT_CASES`, `--set held-out`): four briefs
  written on 2026-10-30, after the round-3 critic found the prompt quoting
  tuning-set hooks word for word. A pepper sauce restock (two facts, so
  thin at N=8), a laundry pickup service (text-led), a dental clinic
  offer and a fundraising deck. Nobody reads their runs to change the
  prompt; they measure whether the planner generalises. The report goes
  to `qa-reports/eval/design-sequence.held-out.json`.

`prompt-leak.test.ts` (gate lane) fails if any distinctive phrase of
either set (the offering, title, brand name, every labelled fact, every
figure with its unit, the distinctive words of the names) appears in
`src/lib/ai/prompts/design-sequence.ts`, comments included, in
`HOOK_CRAFT`, or in any prompt the builders produce for a brief that is
not a fixture. The phrases are computed from `cases.ts`, so a new fixture
is covered the day it is added.

Every brand profile carries `overview`, `offer`, `values`,
`differentiators`, `targetAudience` and `primaryGoal`, the fields a thin
brief may borrow points from (`profilePoints` in
`src/lib/design/sequence/points.ts`), so that path is measured live.

`cases.ts` holds four carousels (a cafe, a textile store, a SaaS launch, a
teen baking class) and two presentations (a seed pitch deck and a
sponsorship deck). Each case's facts and offering are labelled by hand, in
the brief's own words. Coverage is measured against those labels, never
against the brief reader the planner uses, so a reader miss shows up as a
coverage miss. `cases.test.ts` checks that every label appears in its brief
word for word. A venue the brief calls "our Yaba bar" is read the way the
directions path and the job's drawn-copy check read it (`withVenueOrBrand`):
the brand's name and the area state it. That rule is deterministic, so the
labels are still not the planner's reader.

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

### Round 4 (2026-10-30, Bedrock `us.anthropic.claude-sonnet-4-6`)

Logs and JSON reports in `/tmp/feat-multiframe/critique/u1r4/`
(`eval-tuning-{a,b,c}`, `eval-heldout-{a,b,c}`). Run a was the first
pass of this round; b and c are two runs of the code as committed.

Changes: fixture examples removed from the prompt (a tuning-set hook had
been copied word for word) and gated by `prompt-leak.test.ts`; a thin
brief may borrow points from the brand profile, labelled as a second
source and each used once; a carousel price stated before the action
frame is a fault after copy, and its move is tried on both frames
together; stat-highlight only for a headline with a figure.

| Run | set | coverage | hook | last action | non-repetitive |
|---|---|---|---|---|---|
| a | tuning | 1.0 | 3.78 | 4.94 | 3.44 |
| a | held out | 0.75 (label error, see below) | 3.33 | 4.83 | 3.08 |
| b | tuning | 1.0 | 3.56 | 4.89 | 3.11 |
| b | held out | 0.917 | 3.50 | 4.92 | 3.50 |
| c | tuning | 1.0 | 3.89 | 5.00 | 3.17 |
| c | held out | 1.0 | 3.50 | 4.83 | 3.67 |

**Both sets fail the frozen hook and non-repetition thresholds.** The
tuning hook fell from round 3's 3.72 to 4.11 range to 3.56 to 3.89 once
the prompt stopped handing the model two fixtures' hooks: round 3's hook
number was partly recall. The held-out set lands in the same range
(hook 3.33 to 3.50, non-repetition 3.08 to 3.67), so the planner is not
worse on briefs it never saw; it is just as short of 4.

Run a's held-out coverage miss was the label, not the planner: the
clinic's quantity was labelled "60-minute session" where the brief says
"One 60-minute session", and the product's fact reader (`factStated`)
counts the extra number. The label was corrected to the brief's words
before runs b and c. Run b's one miss (clinic N=8) is real: the planner
reported it as `fact-uncovered` itself.

Deterministic evidence from runs b and c: 0 price-placement faults left
in 60 runs, 0 stat-highlight frames without a figure.

What holds the judge scores down, from the reasons in the reports:

- Hooks: a question any competitor could post ("Still doing laundry
  yourself?"), or a headline that leaves the offering to the
  subheadline. The judge marks both 3.
- Non-repetition at N=8 on thin briefs: profile points that are near
  each other in meaning (a school's "free" in three fields), and two
  action-adjacent frames (a "reserve" frame before the action frame).
- Text-led sets (no image) alternate hero-center and the centred card for
  the whole set. The renderer has two text-led compositions
  (`TEXT_LED_LAYOUTS`); a third needs a new builder in
  `src/lib/design/document/builders/`, outside the planner.

### Round 3


Round 3 of the revision (2026-10-30, Bedrock
`us.anthropic.claude-sonnet-4-6`). Logs and JSON reports are in
`/tmp/feat-multiframe/critique/u1r3/` (`eval-full-a` to `-e`, and
`eval-n5-a`, `-b` for the four carousels at N=5).

| Run | change | coverage | hook | last action | non-repetitive |
|---|---|---|---|---|---|
| full-a | one edit pass (repair + hook + editor review), price on the action frame, fact-only frames, recap by owner | 0.944 | 4.06 | 4.89 | 3.39 |
| full-b | review may give a repeated frame a new point; labels read venues as the product does | 0.944 | 3.94 | 4.83 | 3.61 |
| full-c | a second edit pass (re-read): measured, moved nothing, removed | 1.0 | 3.83 | 4.89 | 3.50 |
| full-d | coverage weighs double; the hook chosen on its own faults, not other frames' | 1.0 | **4.11** | 4.83 | 3.72 |
| full-e | a hook that spends a later frame's point counts once, below a label: reverted | 0.944 | 3.94 | 5.00 | 3.61 |

**As committed, the code is full-d's.** Its run holds every deterministic
check (coverage 1.0) and passes the hook threshold (4.11 against 4.0), but
**non-repetition still fails its frozen threshold (3.72 against 4.0)**.
Full-e, one change from it, also missed one fact on one run (the partner
deck's venue, split across two footer lines by the model): a coverage miss
the planner's own reader did not see, so the eval caught it as designed.

What moved the numbers, so the next attempt builds on it:

- **The hook was being chosen by code on faults of other frames.** A
  version sharing a word with frame 2 lost to a flat label ("Cold brew at
  our Yaba bar", judged 2). `hookScore` holds a version to the contract,
  invented claims and its own faults only; the rest is listed for the
  editor. Hook 3.83 to 4.11.
- **Coverage now outweighs an invented claim.** The partner deck traded
  "one room" for a hook naming nothing and lost the run.
- **One edit pass, not two.** A second read of the edited set cost a call
  and moved non-repetition from 3.61 to 3.50, inside the noise.

What still holds non-repetition under 4: five- and eight-frame carousels
where two middle frames make neighbouring points from a thin brief (the
cafe's process and its serve, the textile store's sourcing and its craft),
and the judge reads them as one point told twice. Short sets (N=3) score
4 to 5. Run-to-run swing on the same code is about 0.3.

Earlier rounds, kept so later runs can be compared against them:

| Round | Change | hook | non-repetitive | coverage |
|---|---|---|---|---|
| 1 | first build | 3.25 | 2.25 | 0.75 |
| 3 | repeat checks (`repeats.ts`), fact ownership | 3.75 | 3.75 | 1.0 (N=5 only) |
| 6 | first full run, beats in the outline | 3.83 | 3.33 | 0.944 |
| 9 | phone/time rule, hook subheadline rule | 3.76 | 3.65 | 0.889 |
| 11 | hook must name the brand when it is the subject | 3.50 | 3.31 | 0.944 |
| R2 | venue facts as the directions read them, hook versions every run, two drafts and an editor's choice, cross-frame recap drops, phrase, action and hook-preview checks | 3.78 | 3.61 | 1.0 |
| R2 full-a to -c (as delivered) | the round-2 pipeline, three full runs | 3.72 to 3.78 | 3.22 to 3.61 | 1.0 |
