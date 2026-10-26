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

## The rendered lane (round 3)

Round 2 never drew a design, so it could not see headlines on the pastry, a
cropped product, facts the brief gave and the design dropped, gibberish on a
plate, or a blank photo accepted as a hero. Each case now runs as the job
does, without storage or the judge gate: the upload normalised as the
browser would (`normalise.ts`) and passed through every loader check
(`designImageFromBytes`), the subject looked at (`lookAtPhoto`, a plate's own
look, or a cut-out's alpha), the layout chosen (`chooseLayout` with the
builders' subject check), and the document rendered. Renders, layer
documents and plates land in `--out` (default
`qa-reports/eval/design-directions-renders`). Two metrics are measured twice
on purpose, so neither is true by construction: copy over the subject (the
document's geometry, and a look at the PNG) and invented facts (a text judge
reading the copy against the brief and profile, not `inventedFacts`, which
filtered it). Scored in `render-score.ts`; thresholds in `RENDER_THRESHOLDS`,
frozen before the first round-3 run.

| Metric | Meaning | Threshold |
|---|---|---|
| `copyOverSubject` | Delivered directions with copy, a button, the rule or the logo on the drawn part of a known subject (`measureSubject`) | 0 |
| `lookTextOverSubjectShare` | The eval's look at the PNG says text sits on the product or a face | ≤ 0.15 |
| `croppedShare` | Known subjects cut by their frame or under 35% of the shorter side | ≤ 0.25 |
| `caseFactCoverage` | The brief's hard facts (`briefFacts`) stated by at least one direction | 1.0 |
| `directionFactCoverage` | The same, per direction | ≥ 0.9 |
| `judgeInventedShare` | Directions where the judge finds a statement the brief does not support | ≤ 0.15 |
| `letteredPlateShare` | Delivered plates the eval's look finds any writing on | ≤ 0.1 |
| refusals | `workshop-blank-upload` (photo-a.jpg, near-white) refused; no good photo refused | all / 0 |

Reported, not gated: `subjectKnownShare`, `lookCutShare` (the look calls a
framed photo "cut" far more often than the geometry does), `craftSoftShare`.

### Round 4 additions, frozen before the round-4 run

The round-3 critic showed three rendered metrics passed by construction:
copy over the subject was measured against the box the layout kept clear
(the face, on a fallback), fact coverage used the detector that drew the
facts in, and the correction path never ran. Now:

- `copyOverSubject` and `croppedShare` are measured against the whole
  subject, whatever box the layout kept clear.
- The copy is read off the drawn document (`drawnCopyOf`), so a footer line
  the builders dropped is not counted, and facts include the case's product.
- `judgeMissingShare` is gated, independent of `briefFacts`.

| Metric | Meaning | Threshold |
|---|---|---|
| `judgeMissingShare` | Directions where the judge says a hard fact of the brief is missing | ≤ 0.15 |
| `craftHard` | Delivered directions with a headline under other copy, copy over copy, or copy across a card edge (`craft.ts`) | 0 |
| `productNamedShare` | Product cases whose rendered copy names the product | 1.0 |
| `placeholders` | "[LINK]", "TBC" and the like in rendered copy | 0 |
| `correctionsProbed` | Directions run through the gate's correction path for real (`probeCorrection` cases): the first render is reported as failing the logo check, the real judge prescribes on its pixels, the job's own rules (`directionGateRules`, `correctionHolds`) keep or refuse it | ≥ 1 |
| `correctionLostFacts` | Brief facts the delivered design lost to a kept correction | 0 |
| `correctionOverSubject` | Corrections delivered with copy on the box the layout kept clear | 0 |

`judgeInventedShare` stays the independent check of the claim check
(`claim-check.ts`): both are model readings of the copy against the brief,
but the product's asks for a rewrite of each field before delivery and the
eval's asks, after rendering, for every unsupported statement in the drawn
copy, with a different prompt and on the copy as drawn.

### Round 5 additions, frozen before the round-5 run

The brief's facts are now read by a model (`brief-read.ts`) and held to the
brief in code, so the eval measures the reader itself, and measures coverage
against facts a person labelled rather than against what the reader found:

```
pnpm eval:design-directions --read-only   # the reader alone, every labelled brief
```

Before the cases, every brief in `read-cases.ts` (the shapes rounds 3 and 4
broke on: an address before its days, a price for a set, a phone before a
bare hour range or a comma, two numbers, a handle, a shop prefix, a US
number, a named speaker, a renamed product, a greeting with nothing) is read
alone, one small call each; each case's own read is scored the same way.
Facts are compared by where they sit in the brief (`read-score.ts`): a fact
is precise when every labelled fact it reaches is whole inside it or holds
it whole, so "9 Bourdillon Road, Thursday" across the address and "Thursday
to Sunday" is wrong, while "every weekday from 8am" over two labels, or
"Yaba" of "Yaba and Surulere bars", is right. Optional labels mark what two
careful readers would disagree about.

| Metric | Meaning | Threshold |
|---|---|---|
| read precision | Settled facts made only of whole labelled facts | ≥ 0.95 |
| read recall | Required labels the facts that reach them say in full | ≥ 0.9 |
| read offering | Offering kind and phrase right, where labelled | ≥ 0.85 |
| read people | The real people named, exactly | 1.0 |
| read unavailable | Briefs the reader did not answer | 0 |
| `emptyImageRegions` | An accent panel where the picture would be, with no picture (round 4: event-ko's empty half) | 0 |
| `footerRepeats` | Directions with a footer item the copy above or another item already says | 0 |
| `productInFooter` | A footer item that is only the product's name | 0 |
| `imageOverFrame` | A picture drawn over its card's border | 0 |
| `copyProbes` | Probe directions run through copy-changing corrections: the footer emptied, a fact invented, the headline set to the brief's title, each through `directionGateRules` | ≥ 1 |
| `copyProbeFailures` | Probes where the rules decided wrong: a lossy or invented correction kept, or the title rewrite refused though it lost nothing (or kept though it did) | 0 |
| `copyProbeOverSubject` | A kept rewrite whose render lays copy on the whole subject | 0 |

`textLed` (KO directions laid out as text because no plate passed) is
reported on every case, not gated: the job's answer to a failed plate is a
text-led layout, and how often it happens is the plate model's number to
watch. Brief facts per direction and on any direction are now measured
against the labels, so a fact the reader missed counts as missing from the
design.

### Round 6 additions, frozen before the round-6 run

The round-5 critics found defects every metric passed: a portrait on 16:9
delivered cut at the mouth, a named speaker left off one direction, footer
repeats in other words, "Zero transfer fees for your" printed, a price
detached from its unit, an AI person beside "architect Ada Obi", and a
precision score that could not see "₦3,000 an amazing". The eval now
mirrors the job's refusals (a layout that cuts the subject or keeps only a
face clear is refused on an upload, and a KO plate no layout shows whole is
left off and the direction laid out as text), counts the people a case
names as facts, and asks two independent questions of every delivered
design: the copy judge also lists footer repeats and fragments, and the
plate look also says whether any person appears.

| Metric | Meaning | Threshold |
|---|---|---|
| read precision | A fact is also imprecise when it carries a word no label it reaches has, ends on a dangling word, or is a part of a label whose rest no fact reads ("Shop 4" of "Shop 4, Sunday Market, Ikeja") | ≥ 0.95 (unchanged) |
| `deliveredSubjectCut` | Delivered directions whose known subject is cut by its frame | 0 |
| `textLedShare` | KO directions laid out as text: paid image calls that bought no image | ≤ 0.25 |
| `peopleNamedShare` | Directions naming every real person the case names | 1.0 |
| `personPainted` | Plates on which the eval's look sees any person, on a case naming a real one | 0 |
| `judgeRepeatedShare` | Directions where the judge reads a footer item that only repeats the copy, in any words | ≤ 0.15 |
| `fragments` | Footer items that end mid-phrase (`looksCutOff`) | 0 |
| `pricesDetached` | A labelled price drawn in the footer as a bare number without its unit, and not given above the footer | 0 |
| `imageAgainstFrameAvoidable` | A picture narrower than its card, flush against the card's edge, delivered while the layout chooser had judged a clean layout (whole subject uncut, no hard fault, picture off the edge; `cleanLayouts` on each direction) | 0 |
| `imageAgainstFrame` | Every flush picture, including those with no clean layout to take, which are delivered with the fault recorded (Oluwaseyi's ruling, round 6) | reported |

Brief facts per direction now include the people a case names. Three
cases copied word for word from the round-4 critic's live briefs
(`cups-photo-upload`, `coat-portrait-upload`, `sourdough-class-ko`) are
replaced by five written fresh and held out from every critic brief:
`kimono-wide-upload` (a portrait at 16:9), `tutoring-ko` (a service with no
product), `pottery-evening-ko` (an event naming a real person, every hard
fact), `storefront-reopening-upload` (a 24 MP storefront, two prices with
their units) and `retreat-sky-upload` (a landscape on a 9:16 story).
`cases.test.ts` holds every label to the brief's own words.

### Round 6b: the judge's "missing" question, made literal

The run at f2ce91c read 0.21 for `judgeMissingShare`, and part of it was
the judge, not the designs: `retreat-sky-upload` direction 0 was said to
be missing "stillwater.ng" with "stillwater.ng · Friday 12 December to
Sunday 14 December" in its footer, direction 1 with "stillwater.ng" as its
button; `bakery-upload` was missing "Lekki", which the brief never gives;
`kimono-wide-upload` was missing "Hand-finished", a description. The
question now says to look on every line, the button included, and not to
list descriptions or anything the brief itself does not give. The
threshold is unchanged; what it gates is still every real omission
(`masterclass-ko` direction 0 left its address off, and that was real).

### Round 6c: texture backdrops and repeats in other words

KO plates for an event, a service or a brief with no physical product are
now object-free texture backdrops (check `scene`, Oluwaseyi's decision).
**The subject look (`lookTextOverSubjectShare`, and the "cut" look beside
it) skips them** (Oluwaseyi's ruling): a texture has no subject for copy to
cover, so the question "does text sit on the subject" can only answer yes
for a design that puts its copy on the backdrop by intent. At 4315cd6 all
13 of the look's flags were such plates. The threshold (≤ 0.15) is
unchanged and still applies to every product plate and every uploaded
photo; the contrast, veil and craft checks still run on texture plates.

Footer items that repeat the copy above in other words are marked by a
small model call (`footer-repeats.ts`, the directions model) and dropped by
code only when every brief fact the direction states is still stated
without them. Each case logs what was marked and whether it was dropped
(`footer repeats marked …`, and `footerRepeats` in the report). The judge's
footer-repeat gate (≤ 0.15) is unchanged.

### Round 6d: the first-draft lane reported; footer detail merged up

`modelInventedShare` (the model's first draft, before the fit pass, the
claim check and finalising) is **reported, no longer a pass/fail gate**
(Oluwaseyi's ruling). Six runs read 0.04 to 0.06 against the old 0.05 on
"now", "only", "today" and counts in reasons, and every one of them was
caught before delivery: the delivered lane's `invented` gate stays at 0
and holds in every run. The figure is still printed, beside the 0.05 it
used to be held to.

A footer item the paraphrase check marks as only adding detail to the copy
above ("Friday 12 December to Sunday 14 December" under "12–14 December")
is merged up: the model writes that field again with the detail, and code
keeps the rewrite only when it fits its limit, holds to every rule a
correction must (the brief's facts and language, the offering, the claim
check), and loses no fact; then the footer item goes. Each merge is in the
case log (`footer repeats marked … "merged"`). The judge's footer-repeat
gate (≤ 0.15) is unchanged.

### Round 6e: judged gates read three times

Every gate the copy judge decides (`judgeInventedShare`,
`judgeMissingShare`, `judgeRepeatedShare`) is now a stable reading: the
judge reads each direction three times, and a direction counts as flagged
for a category only when at least two of the three readings flag it
(`majorityJudge`, render-score.ts). On the same delivery rules a single
reading put the invented share anywhere from 0.03 to 0.21 across six runs,
so one sample, not the designs, decided the gate. A reading that fails is
no vote, and a direction with fewer than two readings is not flagged.
Thresholds are unchanged. It triples the judge's calls.

The footer merge also asks again: every marked item that carries a fact
and came back without a rewrite gets a second, targeted ask for one (so
each gets a merge attempt; if none holds, the item stays and why is
recorded). A merge never rewrites the button, which stays an action, and
no footer item is left as a lone time, date, number or contact
(`withoutBareItems`).

### Round 6f: the footer-repeat gate is a known trade-off

The judge's footer-repeat gate (`judgeRepeatedShare` ≤ 0.15) fails, and is
left failing on purpose. Three rules the delivered copy now keeps cost it:

- every brief fact stays stated: an item that carries a fact said nowhere
  else in full stays in the footer unless a merge carries it;
- no headline merges: the headline is the idea, never the carrier of a
  footer detail (a merge of "from 7am" into a headline made the bakery
  pair near-duplicates); the detail may go to a fresh subheadline instead;
- no list-like subheadlines: a merge leaving more than two clauses is
  refused, and the item stays below.

Items that only say the button's action again are dropped
(`dropButtonEchoes`). What is left are footer items the judge reads as
saying again, in other words, a fact the copy above already carries, and
some readings the judge argues against itself ("this count ... appears
nowhere else ... so it is not repeated") or aims at the headline and
subheadline, not the footer. Measured, two runs each:

| HEAD | `judgeRepeatedShare` |
|---|---|
| 966d108 (headline merges allowed with no subheadline) | 0.147, 0.147 |
| 10e7278 (no headline merges, no list merges) | 0.18, 0.21 |
| 8447620 (plus button echoes dropped, fresh-subheadline merges) | 0.18, 0.24 |

The deterministic footer-repeat gate (`footerRepeats`) stays at 0.

The flush-photo gate changes in the same round: `imageAgainstFrame` is
reported, and only `imageAgainstFrameAvoidable` (a flush photo delivered
while a clean layout existed) is gated, at 0. When a KO plate is left off
because no layout showed it whole, the case log lists every layout judged
(`plate layouts judged: …`).

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
| `cafe-photo-upload` | food | busy-cafe-espresso.jpg | A busy scene with bright windows: copy must find room off the machine |
| `fashion-portrait-upload` | product | portrait-fashion.jpg | A person: copy may never cover the face |
| `masterclass-ko` | event | KO | Round-3 live critic's event: a weekday with its date, an age limit, a street address, inclusions, a count and a phone number |
| `workshop-blank-upload` | event | photo-a.jpg | A near-white photo the loader must refuse before any model call |
| `kimono-wide-upload` | product | portrait-fashion.jpg, 16:9 | Round 6: a portrait on a wide canvas, an address followed by days, a count |
| `tutoring-ko` | service | KO | Round 6: a service with no product, whose plates must not be paper or screens |
| `pottery-evening-ko` | event | KO | Round 6: an event naming a real person (no person painted), with every hard fact |
| `storefront-reopening-upload` | offer | busy-storefront-24mp.jpg | Round 6: a 24 MP photo, two prices with their units |
| `retreat-sky-upload` | event | sky-over-stone.jpg, 9:16 | Round 6: a landscape on a story, a date range, a website |

The photo fixtures are royalty-free stock in `/tmp/feat-033/fixtures` (kept
out of the repo, they are binaries).

## Results, 2026-10-22

Run 4 on `us.anthropic.claude-sonnet-4-6` and Bedrock stable-image-core:
PASS across 10 cases. Model lane: within limits 1.00, grounded 0.80, spatial
0.07, invented 0.03, cut off 0.00. Delivered: every structural row at its
threshold, grounded 0.97, distinctness mean 0.81 (worst 0.60), product named
1.00. Plates: 5 of 5 show the product, none wrong, none retried. Run 3 also
passed; runs 1 and 2 failed on the model lane and led to the prompt and
checker changes in this round.

## Results, round 3 (2026-10-22)

Three full runs on `us.anthropic.claude-sonnet-4-6` and Bedrock
stable-image-core, 13 cases each. All three FAIL; the failures are real and
listed, not tuned away.

| Metric | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| model: within limits / grounded / spatial | 1.00 / 0.84 / 0.09 | 1.00 / 0.82 / 0.10 | 1.00 / 0.82 / 0.07 |
| model: invented (max 0.05) | **0.09** | **0.07** | **0.12** |
| delivered: invented, false, cut, spatial | 0 | 0 | 0 |
| distinctness mean / worst | 0.80 / 0.60 | 0.75 / 0.60 | 0.82 / 0.67 |
| plates show the product (min 0.8) | 0.80 | 1.00 | **0.40** |
| copy over subject (max 0) | **1** | 0 | 0 |
| look: text over subject | 0.00 | 0.00 | 0.00 |
| cropped | 0.06 | 0.00 | 0.18 |
| brief facts, any direction / per direction | 1.00 / 1.00 | **0.82** / 1.00 | 1.00 / 1.00 |
| judge: invented (max 0.15) | **0.43** | **0.26** | **0.39** |
| lettered plates (max 0.1) | 0.00 | **0.17** | 0.00 |
| blank photo refused | 1/1 | 1/1 | 1/1 |

What changed between runs, from what each found: after run 1, the subject
check counts a layout as covering when the drawn document puts copy on the
subject whatever the builder reported (the conference case), lettering on
unreadable screen detail stopped drawing six non-product plates flat, and a
count joined by "and" stays whole. After run 2, `measureSubject` counts
overlap only on the drawn part of a cropped subject (every textile layout had
failed), and an off-list `backgroundTreatment` is repaired (the textile case
errored, which is run 2's 0.82 fact coverage). Run 3 lost the photo looks on
the last four cases to Bedrock "unable to process" errors (subject known
0.48), and its plate check passed a man in striped robes as aso-oke throws;
the check's question now rules out a person wearing the product.

Open: the judge's invented share. The detector catches every fact-shaped
invention the probes named, but the model also writes claims no pattern can
see ("designing for Lagos's climate", "One weave", "Your first month is
free" for "zero transfer fees for your first month", "just show up" on a
book-on-WhatsApp brief). Closing it needs a semantic check of the copy in the
product, a paid call per job, which is a decision, not a fix.

## Results, round 4 (2026-10-23)

One full run, 14 cases, `us.anthropic.claude-sonnet-4-6` and Bedrock
stable-image-core. FAIL on five counts; the failures are listed, not tuned
away.

| Metric | Round 3, run 3 | Round 4 |
|---|---|---|
| model: within limits / grounded / spatial | 1.00 / 0.82 / 0.07 | 1.00 / 0.85 / **0.13** |
| model: invented (max 0.05) | **0.12** | **0.12** |
| delivered: invented, false, cut, spatial | 0 | 0 |
| distinctness mean / worst | 0.82 / 0.67 | 0.82 / 0.67 |
| plates show the product | 0.40 | 1.00 (5 of 5, 2 retried) |
| copy over the whole subject (max 0) | 0 | 0 |
| cropped | 0.18 | 0.10 |
| brief facts, any direction / per direction | 1.00 / 1.00 | 1.00 / 0.99 |
| judge: invented (max 0.15) | **0.39** | **0.16** (4 of 25) |
| judge: missing (max 0.15, new gate) | (0.30, ungated) | 0.08 |
| craft faults delivered (max 0) | not measured | 0 |
| rendered copy names the product (min 1) | not measured | **0.91** |
| placeholders (max 0) | not measured | 0 |
| correction path probed / prescribed / kept / lost facts / copy on subject | not run | 4 / 4 / 0 / 0 / 0 |
| lettered plates (max 0.1) | 0.00 | **0.17** (2 of 12) |
| blank photo refused | 1/1 | 1/1 |

The model lane is the model's first answer before any check, and the
detectors behind it are stricter this round (plural days, superlatives,
"one" counts, "warm", type and composition words), so the same prompt reads
higher; nothing it flags is delivered. After the run, from its findings:
the "product" a brief introduces now needs a launch verb and "new" (the run
read "month" out of "Zero-fee launch month" and "panel 'Building" out of
"Announce our panel"); a model's product name grows to the brief's whole
phrase ("single-origin espresso flight", the 0.91); "the zero-fee promise"
and "delivers the greeting" are no longer claims; "all-inclusive" is one;
and a claim-check rewrite may not copy the sibling's headline. Still open:
"Your first month is free" for "zero transfer fees for your first month"
(the "free" licence for "zero fees" lets it through), and the eval's look
finding writing on two plates the product's check passed.

## Results, round 5 (2026-10-23)

One full run, 17 cases (16 scored, one refused as it must be) plus 14
labelled briefs read alone, `us.anthropic.claude-sonnet-4-6` and Bedrock
stable-image-core. FAIL on six counts; listed, not tuned away. Report:
`qa-reports/eval/design-directions.json` (kept at
`/tmp/feat-033/u3-r5/eval-report.json`, log `/tmp/feat-033/u3-r5/eval.log`).

| Metric | Round 4 | Round 5 |
|---|---|---|
| reader: briefs / precision / recall / offering / people | (no reader) | 30 / 1.00 / 1.00 / 0.92 / 1.00 |
| model: within limits / grounded / spatial (max 0.10) | 1.00 / 0.85 / 0.13 | 0.97 / 0.85 / **0.11** |
| model: invented (max 0.05) | 0.12 | **0.11** |
| delivered: invented, cut, spatial | 0 | 0 |
| delivered: false reasons (max 0) | 0 | **2** |
| distinctness mean / worst; near-duplicates delivered (max 0) | 0.82 / 0.67; 0 | 0.79 / 0.40; **1** |
| plates show the product (product cases) | 1.00 | 1.00 (5 of 5, 3 retried) |
| copy over the whole subject; look: text over subject | 0; – | 0; 0.00 |
| cropped | 0.10 | 0.04 |
| brief facts, any direction / per direction (labels) | 1.00 / 0.99 (reader's own) | **0.99** / 0.98 |
| judge: invented / missing (max 0.15) | 0.16 / 0.08 | 0.13 / 0.13 |
| craft faults delivered | 0 | 0 |
| rendered copy names the product (min 1) | 0.91 | **0.80** |
| lettered plates delivered (max 0.1) | 0.17 | 0.00 |
| KO directions laid out as text (no plate passed) | 7 of 22 (drawn with an empty half) | 5 of 19, none with an empty region |
| empty image regions / footer repeats / product in footer / picture over frame | not measured | 0 / 0 / 0 / 0 |
| correction path: probed / kept / lost facts / copy on the whole subject | 4 / 0 / 0 / 0 | 8 / 1 / 0 / 0 |
| copy-changing corrections: probed / rules wrong / copy on the whole subject | not run | 8 / 0 / 0 |
| blank photo refused | 1/1 | 1/1 |

What the failures were, and what changed after the run (measured on the
live run, not on a second eval):

- **False reasons (2):** both true when settled and made false when coverage
  later dropped a footer repeat ("the footer carries adirehouse.ng" after
  the footer lost it). Reasons are now settled again after coverage.
- **Product named 0.80 and one fact on no direction:** a direction that never
  said "stoneware cups" or "aso-oke", and a footer of three model lines
  with no room for the address or "apron and starter". The fit pass now
  asks a direction that does not name the reader's offering to name it in
  the subheadline (a rewrite that still does not is refused), and a full
  footer gives up a line of the model's that states no brief fact before a
  fact is left off.
- **Text-led directions (5 of 19):** every one was a plate rejected twice for
  lettering on a phone, laptop or gym wall. The plate prompt now asks for no
  screens facing the viewer, signs, posters or printed clothing. No event
  plate was rejected for its scene.
- **Model spatial 0.11, invented 0.11, one near-duplicate pair (recruitment, "Two Senior React Engineers Wanted" against "Senior React engineers"; the second is the brief's title word for word):** the
  model's first answer, nothing of which was delivered; the near-duplicate is delivered and still open.
