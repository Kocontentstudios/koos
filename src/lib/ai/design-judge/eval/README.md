# Design judge (rubric correction) eval

Measures **how often a real model's prescription survives the guards** —
the acceptance rate of `src/lib/design/quality/judge.ts`.

```
pnpm eval:design-judge                        # all cases
pnpm eval:design-judge --case crowded-composite
```

Paid lane. One `generateObject` call per case against `getModel("strategy")`,
with the rendered design attached on the cases that have readable pixels. The
designs are rendered **locally** through the real composite path
(`./images.ts`), so a run costs reasoning tokens and **no image generations**.
Run it before shipping a change to `judge.ts`, to the field guide inside it, or
to the model — and nightly. Not part of `pnpm test`.

## Why this lane exists

`judge.ts` has 101 gate tests and they protect the *refusals*. `correct()` has
seven ways to turn a prescription down and almost every one of them has a test
that goes red when it is removed. Every test that asserts an *accepted*
correction feeds `generateObject` a hand-written object constructed to pass.

So the suite cannot tell these two systems apart:

- a judge whose prescriptions land, which is AC-3; and
- a judge that returns a verdict and then has every prescription refused,
  which costs a strategy-tier reasoning call per failed variant and delivers
  the design the user already had.

The acceptance rate is the only number that separates them, and before this
lane nothing measured it. It could have been 0% with the whole suite green.

The refusal surface a free-string prescription has to cross is wide:
`layout` / `footerStyle` / `backgroundTreatment` must be exact enum members,
`logoPlacement` must be legal for the layout **and** survive the footer
re-resolution, `palette.*` must normalise as hex, `footerLines` must actually
change what `FooterBand` draws, `backgroundPrompt` must avoid a 21-term
lettering vocabulary, and every field must be one §11 treats the named symptom
with. Each refusal returns the design unchanged.

## What it scores

Deterministically, in `score.ts` — no second model, because each of these has
one correct answer for a given output:

| Metric | Meaning | Threshold |
|---|---|---|
| `acceptanceRate` | **The headline.** The prescription survived every guard | 0.67 |
| `verdictRate` | Ten scores, a symptom and a prescription came back | 1.0 |
| `symptomTreatsField` | §11 treats the named symptom with the prescribed field | 0.8 |
| `scoresInRange` | The verdict the caller receives satisfies §10's 1-5 scale | 1.0 |
| `sawImageAsExpected` | The judge looked at the render exactly when there was one | 1.0 |
| `undrawnFields` | The prescribed field is one the route does not draw | **0, hard** |
| `unchangedCorrections` | `corrected: true` on a spec that did not change | **0, hard** |
| `unattributedRefusals` | A refusal no guard accounts for | **0, hard** |

`refusals` counts which guard did the refusing, per run. That is the number
that tunes the guards and the field guide: "refused" on its own is not
actionable, "refused by `outside-symptom-map` six times" is.

The two hard failures are defects rather than low scores. An undrawn field is
the `bodyPoints` failure reached through the judge — a prescription the
pipeline silently discards. An unchanged correction is a byte-identical second
render reported as a correction, which is the dice re-roll this whole module
was written to remove. No threshold absorbs either.

Scoring decisions worth knowing:

- **`refusedBy` is re-derived, not reported by the judge.**
  `prescriptionOutcome` (judge.ts) is pure and total, so running it on the
  recorded prescription reproduces the module's own decision exactly. That is
  why `unattributedRefusals` is a hard failure: a refusal the ladder cannot
  account for means the lane has drifted from `correct()`.
- **`specChanged` compares structure, not identity.** `judgeAndCorrect` returns
  a fresh object from `designSpecSchema.parse`, so `!==` is true even when
  nothing moved.
- **`scoresInRange` is a post-clamp invariant.** `readScores` clamps to 1-5 and
  drops the whole verdict when a score is not a number, so this check cannot
  catch a model that answered 9 — that shows up as `verdictRate` instead when
  the answer is unusable, and is clamped when it is merely out of range. It
  guards what the *caller* receives, which is what `requiresRevision`,
  `weakestCategory` and `correctionSummary` all assume.
- **The symptom is recorded, never graded.** Each case names the symptom it was
  built to present (`presents`), and the report carries both that and what the
  judge said. Scoring the judge's read against the case author's would be
  grading taste, which is the one thing in this module that is genuinely
  latent. What *is* scored is the deterministic consequence: whether §11 treats
  the symptom it named with the field it then prescribed.

## What this lane CANNOT measure

**Whether the corrected design is better.** It measures that a prescription was
applicable, landed, and changed the spec — not that the second render is an
improvement on the first. That needs a second render per case and a human eye
on an A/B, and it is out of scope by Oluwaseyi's one-pass decision: the judge
runs once, the correction is applied once, and `betterResult` (quality/gate.ts)
decides between the two renders on fault severity, not on quality.

It also does not measure cost or latency against the route's 300s ceiling, and
it does not exercise `renderGuarded`'s wiring — the gate tests in
`src/lib/jobs/render-guarded.test.ts` own that.

## Runs — 2026-10-05, Bedrock `getModel("strategy")`

### Second run, after the symptom/field pairing landed — **PASS**

```
acceptance rate       0.89  (min 0.67)   PASS
verdict rate          1.00  (min 1)      PASS
symptom treats field  1.00  (min 0.8)    PASS
scores in range       1.00  (min 1)      PASS
saw image as expected 1.00  (min 1)      PASS
refusals              {"value-unusable": 1}
undrawn fields        0
unchanged corrections 0
unattributed refusals 0
PASS across 9 cases
```

Eight of nine prescriptions survived every guard, and **every** prescription
was a field §11 treats the named symptom with. No hard failure fired. No
threshold was moved between the two runs.

The one refusal is `weak-cta-native`, and it is the logo vocabulary guard
(`LOGO_GUARD`, KOOS-BUG-022) rather than the symptom map. The judge rewrote
`nativePrompt` and wrote *"the upper quarter of the frame is clear dark ground
so a brand logo can sit top-right"* — reserving space rather than asking for a
mark, and it closed with *"No illustrated or rendered logo mark anywhere in the
scene."* The prohibition strip removes the second clause and the first still
reaches for the vocabulary, so the prescription is refused.

That refusal is correct under the guard's stated trade ("over-refusing costs
one correction; a plate full of garbled type costs the design"), but the field
guide is looser than the guard: `FIELD_GUIDE.nativePrompt` says *"Never ask for
a logo"*, and the judge did not ask for one. **Open, one-line follow-up:** say
in the guide that the word itself must not appear, even to reserve room —
`nativeLogoClause` in `prompts/design-spec.ts` already reserves that space on
every native render, so the judge never needs to.

### First run, before the pairing — FAIL

```
acceptance rate 0.78 (min 0.67) | symptom treats field 0.78 (min 0.8) -> FAIL
refusals {"outside-symptom-map": 2}
```

Both refusals had one cause: the judge may name any symptom and then pick any
field the **route** draws, while `prescribableFields` requires the field to be
one §11 treats **that symptom** with — and the prompt listed the symptoms and
the fields as two separate menus, so the rule was invisible.

| Case | Symptom named | Field prescribed |
|---|---|---|
| `crowded-composite` | `artificial` | `logoPlacement: "top-left"` |
| `weak-cta-native` | `weak-cta` | `nativePrompt` |

Two fixes followed, both in `judge.ts`:

1. `buildJudgeSystemPrompt` now pairs each symptom with exactly the fields it
   allows, generated from `prescribableFields` — the same function the guard
   calls, so the prompt and the code cannot drift.
2. `SYMPTOM_CORRECTIONS["weak-cta"]` gained `nativePrompt`. The native route
   draws no layout and no action pill, so the whole-design instruction is the
   only thing on it that draws the action at all; without it the symptom
   reached one lever there, `cta`, which changes only the words while §11's
   remedy is about separation and component.

§11's `artificial` row was **not** widened to admit `logoPlacement`. The
manual's `artificial` is light, shadow, perspective and texture; stretching it
to cover placement would make the map mean nothing. With the pairing shown, the
model re-judged `crowded-composite` as `artificial` and prescribed
`backgroundPrompt`, which that row does own — and it was accepted.

**Stated gap: no §11 symptom owns "an element collides with the copy".**
`logoPlacement` appears only under `off-brand` ("restore approved type, colour,
logo…"), which is about identity, not composition. The nearest shape in the
manual is `pasted-footer` — "connect its geometry, colour, overlap, or spacing
to the composition" is exactly the right remedy — but it is scoped to the
footer by name. This gap is probably not §11's to close: `resolveLogoPlacement`
and `cornersBlockedByFooter` already keep the mark off footer bands and layout
copy zones deterministically, and they miss this case only because they reason
from the layout template rather than from the rendered pixels — a hero-center
headline that wraps into the top-right corner is invisible to them. The honest
home for it is a mark/copy overlap check in `quality/checks.ts`, measured from
the render, not a new row in the correction map.

## Cases

Every case is a design that has already failed `checkRenderedDesign`, which is
the only state the judge is reached from. Fault codes are limited to the three
in `CORRECTABLE` (`blank-frame`, `unreadable-image`, `unreadable-logo`):
`wrong-dimensions` never reaches the judge, so a case built on it would measure
a path production does not have.

| Case | Route | Fault | Image | Presents |
|---|---|---|---|---|
| `crowded-composite` | composite | unreadable-logo | render | crowded |
| `empty-composite` | composite | blank-frame | flat (withheld) | empty |
| `flat-composite` | composite | unreadable-logo | render | flat |
| `generic-composite` | composite | unreadable-logo | render | generic |
| `off-brand-composite` | composite | unreadable-logo | render | off-brand |
| `repetitive-composite` | composite | unreadable-logo | render | repetitive |
| `pasted-footer-composite` | composite | unreadable-logo | render | pasted-footer |
| `weak-cta-native` | native | unreadable-logo | render | weak-cta |
| `artificial-native` | native | unreadable-image | none | artificial |

Both routes are covered because the refusal surface is route-sensitive: the
native route draws no layout and no footer band, so half the guards are
unreachable from the composite cases alone. `artificial-native` also runs with
`hasLogo: false`, which takes `logoPlacement` off the table entirely.

All three image states are covered because `visualEvidence` has three answers:
send the pixels, withhold a frame the blank-frame check has already described
in words, and send nothing when there are no bytes. The last two must leave the
judge reasoning from the spec, which `sawImageAsExpected` asserts.

## Output

- `qa-reports/eval/design-judge.json` — totals, thresholds, and one row per
  case carrying the full verdict and the prescription: the symptom, the ten
  scores as a total, the weakest category, the field and the exact value the
  judge asked for, its stated reason, and both sides of the change when it was
  applied. A human can read what the judge actually wanted without re-running.
- `qa-reports/eval/design-judge/<case>.png` — the design each case handed the
  judge, so a surprising verdict can be checked against the pixels that
  produced it.

Both are gitignored (`/qa-reports`), like every other lane's output.
