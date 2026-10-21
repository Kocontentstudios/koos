# Design directions eval

Measures whether one real model call gives the user **two different concepts**
for the same brief, inside the contract, with "why this works" reasons that
say something about *their* brief (FEAT-033).

```
pnpm eval:design-directions                       # all cases
pnpm eval:design-directions --case conference-ko
pnpm eval:design-directions --image path/to/photo.png
```

Paid lane. One `generateObject` call per case against `getModel("strategy")`
(two when the redraft rule fires), text plus the photograph on the upload
cases, **no image generation**. Run it before shipping a change to
`src/lib/jobs/directions/`, `src/lib/ai/prompts/design-directions.ts` or the
model, and nightly. Not part of `pnpm test`.

It calls the production function, `draftDirections`, so finalising, the
redraft rule and the layout rule are measured exactly as they ship. The
upload cases attach `--image`, defaulting to
`/tmp/feat-033/fixtures/cutout.png` when it exists; without one they run
text-only and the report says so. The JSON report lands in
`qa-reports/eval/design-directions.json` with every direction's copy and
reasons.

## What it scores

Deterministically, in `score.ts`. Each metric has one right answer given the
output, so nothing goes to a judge.

| Metric | Meaning | Threshold |
|---|---|---|
| `twoDirections` | Every case delivered two | 1.0 |
| `layoutsDiffer` | The two layouts differ (after the forcing rule) | 1.0 |
| `withinLimits` | Every delivered direction parses `directionSpecSchema` (title ≤ 40, 2-4 reasons ≤ 90) | 1.0 |
| `groundedShare` | Delivered reasons sharing a content word with the brief or brand facts (`isGroundedReason`) | ≥ 0.8 |
| `fillerShare` | Delivered reasons that are praise and name nothing ("eye-catching", "stands out") | ≤ 0.1 |
| `jargonShare` | Delivered reasons that read out the spec (a layout id, a hex code) or the prompt ("Direction 1") | 0 |
| `cutShare` | Delivered reasons that are a model sentence shortened to fit | ≤ 0.2 |
| `meanDistinctness` | Mean of `1 - worst overlap` between a case's two directions | ≥ 0.7 |
| `finalNearDuplicates` | Pairs still near-duplicate after the redraft rule | 0 |

The structural rows are enforced in code after the model answers, so anything
below 1.0 there is a bug. The quality rows are the model's own, with margin.
Model-alone figures (layouts, limits, grounding, first-call duplicates) are
printed beside them: they show how much of each pass is the model and how
much is the deterministic rules.

### Distinctness

`text-overlap.ts` compares content-word stems (stopwords dropped, plurals and
verb endings folded) as Jaccard overlap on four views: headline, title, all
copy, and the painted scene (KO cases only; on an upload both directions use
the same photograph by design). Distinctness is one minus the worst of them.

The brand name is ignored everywhere. The brief's own words are ignored in
the copy and scene views only: both directions must carry the brief's facts
(the price, the deadline, "apply by"), so those are compared on what each
direction added. The headline and title are the concept and are compared
whole. This was calibrated on the first run, where two genuinely different
concepts for the bakery scored 0.39 copy overlap purely from both stating
"₦4,500 a slice from Monday, 7am pickup".

A pair is a near-duplicate at headline ≥ 0.5, title ≥ 0.5, copy ≥ 0.45 or
scene ≥ 0.6. At runtime that triggers one redraft of the later direction.

### Grounding

A reason is grounded when it shares a content stem with the brief, the title,
the design type or what the brand says about itself, minus design vocabulary
any reason could use ("brand", "colour", "layout"). A brief holding a date or
a price also grounds the words "date", "time", "deadline" or "price", "fee",
"free", since "the date sits in the footer" answers "Friday 14 March" without
repeating it.

## Cases

| Case | Category | Image | What it covers |
|---|---|---|---|
| `bakery-upload` | food | upload | Product launch with price and pickup time, photograph attached |
| `valentine-box-upload` | offer | upload | An occasion and a deadline on the same photograph |
| `fintech-ko` | finance | KO | A promise with three numbers |
| `conference-ko` | event | KO | Speaker, date, venue: the facts both directions must keep |
| `recruitment-ko` | recruitment | KO | No logo; a role and a deadline |
| `eid-greeting-ko` | celebration | KO | No facts and no offer: difference must come from the concept alone |
| `fitness-ko` | service | KO | A schedule and a free first class |
