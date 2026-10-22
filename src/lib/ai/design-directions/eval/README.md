# Design directions eval

Measures whether the model gives the user **two different concepts** for the
same brief, written to length, stating only the brief's facts, with "why
this works" reasons that are true of the design, and whether KO imagery shows
the product the brief names (FEAT-033).

```
pnpm eval:design-directions                         # all cases
pnpm eval:design-directions --case bakery-ko
pnpm eval:design-directions --image path/to/photo.png
pnpm eval:design-directions --no-plates             # skip the plate model
pnpm eval:design-directions --out /tmp/plates       # where plates are saved
```

Paid lane, Bedrock. Run with `AWS_BEARER_TOKEN_BEDROCK=` (empty) so the SigV4
keys are used; the runner clears it too. Per case: one `generateObject` call,
one more when the fit pass or the redraft rule fires. On KO cases that name a
product, the real plate model paints each direction's plate through
`paintCheckedPlate` (with its check and one retry), and the eval takes its own
look at every plate it keeps. Plates are never uploaded; they are written to
`--out` (default `qa-reports/eval/design-directions-plates`) for a person to
look at. Run it before shipping a change to `src/lib/jobs/directions/`,
`src/lib/ai/prompts/design-directions.ts`, `src/lib/design/quality/` or either
model, and nightly. Not part of `pnpm test`.

It calls the production functions (`draftDirections`, `paintCheckedPlate`),
so the fit pass, finalising, the redraft rule, the layout rule and the plate
retry are measured as they ship. The upload cases attach `--image`,
defaulting to `/tmp/feat-033/fixtures/cutout.png` when it exists. The JSON
report lands in `qa-reports/eval/design-directions.json` with every
direction, every draft, every dropped reason with its cause, and every plate.

## Two lanes

Round 1 scored only what `finalizeReasons` selected, with the same grounding
rule the selection used, so part of its pass was true by construction. Round
2 scores two lanes apart:

- **The model's own answer**: `drafts`, exactly as the first call returned
  them, before the fit pass rewrites anything and before `finalize.ts`
  settles it. These say whether the prompt works.
- **Delivered**: `directions`, after every rule. Most of these are enforced in
  code (`claims.ts`, `finalize.ts`), so anything short of the threshold is a
  bug. They are invariants, not a measure of the model.

## What it scores

Deterministically, in `score.ts`, except the plate look.

| Lane | Metric | Meaning | Threshold |
|---|---|---|---|
| model | `modelWithinLimits` | Drafts with every field inside the contract unaided (title 40, headline 70, subheadline 140, CTA 32, footer line 60, 2-4 reasons of 90) | ≥ 0.8 |
| model | `modelGroundedShare` | Reasons naming a specific fact of the brief (`isGrounded`) | ≥ 0.8 |
| model | `modelSpatialShare` | Reasons claiming a position, size, light, colour or type (`spatialClaim`) | ≤ 0.1 |
| model | `modelInventedShare` | Copy fields and reasons stating a number, day, month or claim the brief and brand never gave (`inventedFacts`) | ≤ 0.05 |
| model | `modelCutOffShare` | Reasons that read as unfinished (`looksCutOff`) | ≤ 0.05 |
| delivered | `countRight` | Two directions, or one on a regenerate | 1.0 |
| delivered | `layoutsDiffer` | The pair's layouts differ; a regenerate avoids both existing layouts | 1.0 |
| delivered | `withinLimits` | Every direction parses `directionSpecSchema` | 1.0 |
| delivered | `groundedShare` | Delivered reasons that are grounded | ≥ 0.8 |
| delivered | `fillerShare` | Praise that names nothing ("eye-catching") | ≤ 0.1 |
| delivered | `jargon`, `spatial`, `cutOff`, `falseClaims`, `invented` | Counts of delivered reasons or copy that read out the spec, claim geometry, were cut, are not true of the copy (`reasonHolds`), or state an invented fact | 0 each |
| delivered | `meanDistinctness` | Mean of 1 - worst word overlap (pair, or regenerate against both existing) | ≥ 0.7 |
| delivered | `finalNearDuplicates` | Pairs still near-duplicate after the redraft rule | 0 |
| delivered | `productNamed` | Product cases where every direction named the brief's product | 1.0 |
| plates | `plateShowsProduct` | KO plates on product cases that the eval's own look says show the product; a plate drawn flat after two misses counts as not showing it | ≥ 0.8 |
| plates | `wrongProductPlates` | Delivered plates showing something else: what round 1 shipped | 0 |

Thresholds were written before the first round-2 run and are frozen in
`cases.ts` (`DIRECTIONS_EVAL_THRESHOLDS`).

### Grounding

`isGrounded` (finalize.ts) counts a reason as grounded when it names a
specific fact of the brief, or two of the brief's own words. Specific facts
are the product's words, the brief's numbers and day or month names, the
words for a price, a time or a date when the brief holds one, and the
brand's audience where the brief names it too ("commuters"). Design
vocabulary ("brand", "colour", "layout", "new", "launch") never counts.
Round 1 needed one shared word with the brief or the whole brand profile, so
"Warm tones feel inviting and friendly" passed because the tone said "warm".

### Invented facts

`inventedFacts` (claims.ts) lists every number (digits or words, money with
any currency spelling, times, percentages), day, month and claim word (free,
delivery, award, organic, limited and so on) in a text that the brief and
brand profile do not hold. A count must count the same thing: "12 artisans"
does not borrow the twelve of "twelve throws", while "12 new throws" does.
"Free" is accepted for "zero fees"; "handmade" for "handwoven".

### True reasons

`reasonHolds` (claims.ts) rejects a reason that invents a fact, makes a
spatial, colour or type claim, names a piece of copy that does not carry
what it says ("the subheadline gives the price" when it does not), quotes
copy that is not drawn, or describes an image nobody checked: anything about
the image on a design drawn flat, and on KO imagery, any prop or setting from
the plate's scene that the plate check never looked for. The job applies it
twice: when the directions are written, and again on the design delivered,
after the gate's correction and the plate check.

### The plate

The product's check (`quality/plate-check.ts`) asks whether the plate's main
subject is the named product, whatever the angle or plating. The eval's own
look asks a different question first (name the main subject), then whether
that is the product, through the same vision path (`quality/vision.ts`).

### Distinctness

`text-overlap.ts` compares content-word stems as Jaccard overlap on four
views: headline, title, all copy, and the painted scene (KO only). The brand
name is ignored everywhere; the brief's own words in the copy and scene
views; and the product's description in the scene view, because every KO
scene must now show the same product. A pair is a near-duplicate at headline
≥ 0.5, title ≥ 0.5, copy ≥ 0.45 or scene ≥ 0.6, which triggers one redraft.

## Cases

| Case | Category | Image | What it covers |
|---|---|---|---|
| `bakery-upload` | food | upload | The live run's brief: price, day and pickup time, photograph attached |
| `bakery-ko` | food | KO | The same brief on KO imagery, where round 1 painted a tart, a cake and bread rolls |
| `textile-launch-ko` | product | KO | A count ("twelve throws") that round 1 turned into "12 Artisans" |
| `textile-launch-regenerate` | product | KO | One new direction apart from two existing ones |
| `valentine-box-upload` | offer | upload | An occasion and a deadline on the same photograph |
| `fintech-ko` | finance | KO | A promise with numbers and no physical product |
| `conference-ko` | event | KO | Speaker, date, venue: the facts both directions must keep |
| `recruitment-ko` | recruitment | KO | No logo; a role and a deadline |
| `eid-greeting-ko` | celebration | KO | No facts and no offer: difference must come from the concept alone |
| `fitness-ko` | service | KO | A schedule and a free first class |

## Results, 2026-10-22

Run 4 on `us.anthropic.claude-sonnet-4-6` and Bedrock stable-image-core:
PASS across 10 cases. Model lane: within limits 1.00, grounded 0.80, spatial
0.07, invented 0.03, cut off 0.00. Delivered: every structural row at its
threshold, grounded 0.97, distinctness mean 0.81 (worst 0.60), product named
1.00. Plates: 5 of 5 show the product, none wrong, none retried. Run 3 also
passed; runs 1 and 2 failed on the model lane and led to the prompt and
checker changes in this round.
