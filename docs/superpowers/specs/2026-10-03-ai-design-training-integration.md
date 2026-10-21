# KOOS-AI-001 — Integrating the AI Design Training System

**Status:** proposed, awaiting approval before any code is written
**Ticket:** [KOOS-AI-001](https://app.clickup.com/t/123qy9rp1mw) (urgent)
**Source material:** `docs/design-training/koos_design_system/` — 11 modules, ~14,300 words
**Deliverable:** #1 of 9, "documented technical approach"

---

## 1. The finding that shapes everything else

**Most of this manual cannot be implemented by changing prompts, because KO OS does
not generate a design. It generates a background and draws the design in code.**

The composite route — the one that produces brand-font, brand-logo output — sends the
image model a prompt that ends with *"No text, no letters, no numbers, no words, no
logos"* (`src/lib/ai/prompts/design-spec.ts:119`). Every piece of type, the CTA, the
logo and its backing plate are drawn by satori from a hand-written React tree
(`src/lib/design/render/layouts.tsx:248-448`), across exactly **five** hard-coded
layouts (`src/lib/design/spec.ts:6-12`).

So when module 09 §13 tells the designer to choose among **twelve footer systems**, and
module 09 §5 among **nine layout families**, the renderer has:

| Manual asks for | Renderer has |
| --- | --- |
| 9 layout families | 5 layouts, each a hand-written branch |
| 12 footer systems | **no footer concept at all** |
| Grid / card systems | none |
| Multi-page carousels | none — `designSpecSchema` has no slide concept |
| Product cluster / orbital | none |

Writing those instructions into a prompt would produce a model that asks for a
curved-shoulder footer and a renderer that silently ignores it. The output would not
change, the ticket would look done, and nothing would be better. **That is the failure
mode this spec exists to avoid.**

Every instruction in the manual therefore lands in one of three buckets:

- **(A) Decision** — something the art-director LLM already chooses, or could, within
  what the renderer can draw. Implementable as prompt + schema. *Cheap, fast, testable.*
- **(B) Capability** — something the renderer cannot draw at all. Requires React/satori
  work in `layouts.tsx` and friends before any prompt can ask for it.
- **(C) Evidence** — something needing data we do not currently keep: recent layouts per
  brand, approved designs as brand-DNA evidence, per-brand anchor weighting.

---

## 2. Module inventory and where each lands

| Module | Content | Bucket | Target layer |
| --- | --- | --- | --- |
| 01 Design reasoning, brief interpretation | brief extraction, content ranking, creative idea, layout-family choice, conflict order | A | brief prompt + spec prompt |
| 02 Composition, alignment, hierarchy, spacing | visual skeleton, safe margins, alignment systems, reading paths, mobile test | A + **B** | spec prompt; margins/grids are renderer |
| 03 Backgrounds, contrast, depth, lighting | background by function, light/dark/gradient/photographic/textured, contrast system, text protection | **A** | `backgroundTreatment` vocabulary + plate prompt |
| 04 Typography, imagery, product, storytelling | type limits, headline construction, image role, camera angle, gaze, cropping, product presentation | A (imagery) + **B** (type hierarchy) | plate/native prompt; type is renderer-drawn |
| 05 Footer, CTA, lower-thirds | 12 footer systems and selection rules | **B** | renderer — does not exist today |
| 06 Brand consistency, controlled variation, loop, rubric | 3 brand layers, variation matrix, anti-repetition, **layout memory**, **evaluation rubric**, correction map | A + **C** | spec prompt + new layout history + runtime QC |
| 07 Autonomous decision protocol | no-question rules, information-source order, 3 classes of missing info, placeholders | **A** | brief + spec system prompts |
| 08 Design-type playbooks | 12 **category** playbooks (product, service, event, recruitment, school, food, tech, finance, celebration, personal brand, educational, offer) | **A** | new routing layer |
| 09 Master instruction | the compact execution standard | A | the system prompt itself |
| 10 Consistent design pack | campaign-level consistency across a set | A + **C** | later; needs campaign grouping |

---

## 3. A distinction the ticket blurs

The ticket says "identify the requested deliverable … social-media flyers, e-flyers,
carousels, YouTube thumbnails, posters, banners". Module 08 is organised by something
different: **what the design is selling** (product, service, event, recruitment, food,
finance…).

These are two independent axes and both matter:

- **Format** decides canvas, safe margins, copy budget, and whether it is multi-page.
  KO OS has 16 format labels today (`src/lib/design/tickets-ui.ts:86-103`) and uses them
  for almost nothing: `designType` is free `z.string()` at every boundary and only two
  code paths branch on it.
- **Category** decides priority order, composition, imagery, footer and what to avoid —
  the actual content of module 08.

**Proposal: derive both, store both, and route on both.** Format comes from the request
(already captured, needs an enum). Category is inferred by the brief step from the brief
text, because users will not reliably tell us "this is a recruitment design".

---

## 4. Current-state gaps, measured

From the pipeline audit (file references in the appendix):

1. **Deliverable type is decoration.** Free text at every boundary; reaches the art
   director as one line (`design-spec.ts:89`). 13 of 16 types have no representation.
2. **Four brief templates**, with flyer/banner/poster/story/ad collapsed into one
   "SINGLE (STATIC) DESIGN" (`brief-structures.ts:6-20`); the model picks, nothing routes.
3. **The art-director system prompt is 8 lines** (`design-spec.ts:74-84`), format-agnostic,
   and says "a single social media design" whatever was asked for. The entire
   art-direction vocabulary is `backgroundTreatment`'s five values.
4. **The two richest brand representations are not on the design path at all** —
   `src/lib/brand-codex.ts` (Brand Brain export) and `src/lib/ai/memory.ts` (rolling brand
   memory) are imported only by a download route and the chat route respectively.
5. **No variation, no memory.** No seed, no layout history; `design_generations.spec` is
   written and never read back. All parallel variants share one spec, so they share one
   layout, one headline, one palette.
6. **No pre-delivery quality check.** Both eval suites are offline-only — zero runtime
   imports. The job succeeds when "at least one variant produced bytes"
   (`run-design-generation.ts:548-550`). Faults it *does* detect (illegible logo, font
   fallback) are notifications sent *after* the image is stored and delivered.

---

## 5. Proposed phasing

### Phase 1 — Reasoning, routing, memory and a real quality gate (bucket A + C)

Chosen because every item changes output *with the renderer as it stands*, and each is
measurable. No renderer rewrite, no schema migration beyond one additive table.

**1.1 Deliverable format enum + category inference**
- `DesignFormat` union over the existing 16 labels, with canvas/safe-margin/copy-budget
  defaults per format. Parsed at the boundary, stored on the spec, never re-derived.
- `DesignCategory` union over module 08's 12 playbooks, inferred during brief generation.
- Both land on `designSpecSchema` so the stored spec can be audited by type.

**1.2 Playbook routing**
- One playbook per category: priority order, composition default, imagery direction,
  background guidance, footer intent, and an explicit "avoid" list — lifted from module 08.
- Format rules layered on top (copy budget, aspect, reading distance).
- Injected into both the brief prompt and the art-director prompt.

**1.3 The master instruction becomes the system prompt**
- Module 09 replaces the 8-line prompt, trimmed to what the renderer can honour, plus
  module 07's no-question rules and the Class A/B/C missing-information protocol —
  including `[PHONE NUMBER]`-style placeholders instead of invented facts.
- Module 03's background vocabulary expands `backgroundTreatment` and the plate prompt.

**1.4 Brand anchors on the design path**
- Put the Brand Brain (`brand-codex.ts`) and rolling memory (`ai/memory.ts`) into the
  art-director call — they already exist and are simply not wired in.
- Classify brand data into module 06's three layers (fixed anchors / controlled variables
  / free campaign elements) so the prompt can say what must not move.

**1.5 Controlled variation + layout memory**
- New `design_layout_history` (brand_id, layout, category, created_at), or read back from
  `design_generations.spec`, whichever survives review. Feed "recently used layouts" into
  the art-director prompt with module 06 §7's anti-repetition rule and §8's "repeat when
  it is a series" exceptions.
- Make parallel variants differ by construction rather than sharing one spec.

**1.6 Pre-delivery evaluation and one correction pass**
- Deterministic gates first, because they are free and already written offline: blank
  frame, dimension read-back, palette contrast, logo legibility (today these only notify
  *after* delivery).
- Then module 06 §10's 1-5 rubric via an LLM judge, with §11's correction map choosing
  what to fix. **One** revision attempt on a serious failure in brief accuracy, brand
  recognition or readability, then deliver with the fault recorded.

**1.7 Benchmark harness**
- 5 briefs × current vs updated = 10 generations per run (your call: small set).
- Scored on the module 06 rubric plus the deterministic checks, written to
  `qa-reports/benchmarks/`. This is deliverable #8.

### Phase 2 — Renderer capability (bucket B)

Footer systems, more layout families, grid/card, multi-page carousel. Each needs
`layouts.tsx`, `copy-fit.ts`, `logo-placement.ts` and `design-spec.ts` touched together;
today adding one layout means editing four files, so this phase starts by making layouts
data-driven.

### Phase 3 — Evidence (bucket C)

Brand DNA from approved deliverables (module 06 §2), per-brand anchor weighting (§3),
candidate plans — safe/balanced/exploratory (§9), campaign-level packs (module 10).

---

## 6. Decisions needed before phase 1 starts

1. **Does the judge run on every generation?** The rubric is an extra model call per
   design. Options: (a) every generation, (b) composite route only, (c) only when a
   deterministic gate is borderline. Cost vs quality, and it is your bill.
2. **Which route is the priority — composite or native?** The composite route guarantees
   brand fonts and a real logo but can only draw 5 layouts. The native route can honour far
   more of the manual directly but has no layout guarantee and weaker text fidelity. The
   manual implicitly assumes a designer who can draw anything, which is closer to native.
3. **Is multi-page carousel in scope for phase 2?** It is the single largest structural
   gap — `designSpecSchema` has no slide concept, so a carousel brief currently produces
   one image. It may deserve its own ticket.
4. **Revision budget**: one correction pass, or keep going until the rubric passes? One is
   bounded and predictable; "until it passes" can loop on an unachievable brief.

---

## 7. How phase 1 will be proven

- **Gate tests**: format/category parsing, playbook selection, anchor classification,
  anti-repetition selection, each deterministic check. No model calls.
- **Paid evals**: `eval:design-spec` extended with the new fields; a new rubric eval over
  the judge; `eval:design` unchanged as the image lane.
- **Benchmark**: the 5-brief comparison above, current vs updated, same brand and assets.
- **Honest limitation to state up front**: an LLM judge scoring an image it cannot see at
  full fidelity is weaker evidence than a designer's eye. The benchmark is a direction
  indicator, not proof of quality. A human review of the 10 outputs is the real gate, and
  I will ask for it.

---

## Appendix — key files

| Stage | File |
| --- | --- |
| Request → brief | `src/lib/design/request-form.ts`, `src/lib/ai/prompts/design-request.ts`, `brief-structures.ts`, `improve-brief.ts` |
| Brief → spec | `src/lib/design/context.ts`, `attachments.ts`, `spec.ts`, `palette.ts`, `src/lib/ai/prompts/design-spec.ts` |
| Spec → image | `src/lib/jobs/run-design-generation.ts`, `src/lib/ai/image/index.ts`, `adapters/*` |
| Compositing | `src/lib/design/render/composite.ts`, `layouts.tsx`, `copy-fit.ts`, `logo-overlay.tsx` |
| Brand data | `src/lib/jobs/brand-summary.ts`, `src/lib/ai/prompts/strategy.ts` (`brandBlock`), `brand-codex.ts` (unused here), `ai/memory.ts` (unused here) |
| Offline evals | `src/lib/ai/image/eval/`, `src/lib/ai/design-spec/eval/` |

---

# Phase 1 results and implementation notes

*Deliverable #9. Written after building phase 1, before it ships.*

## What was built

| § | Landed | Where |
| --- | --- | --- |
| 1.1 | Format resolution (12 formats, reading conditions, copy budget, whether the renderer can produce it) + category inference | `src/lib/design/formats.ts`, `src/lib/ai/design-training/infer-category.ts` |
| 1.2 | The 12 category playbooks from module 08, as data | `src/lib/ai/design-training/playbooks.ts` |
| 1.3 | Module 09's autonomy rules and module 07's missing-information protocol | `src/lib/ai/prompts/design-spec.ts` |
| 1.4 | Brand anchors (module 06 §1) + the rolling brand memory on the design path | `src/lib/ai/design-training/anchors.ts` |
| 1.5 | Layout memory and anti-repetition (module 06 §7-8), read back from stored specs | `src/lib/ai/design-training/recent-layouts.ts` |
| 1.6 | Pre-delivery checks with one correction pass | `src/lib/design/quality/` |
| 1.7 | Benchmark, both arms in one process | `src/lib/ai/design-spec/eval/benchmark.mts` |

`AI_DESIGN_TRAINING=off` turns the whole thing off without a deploy. It is how
the benchmark runs both arms, and it is the rollback.

## Benchmark, 2026-10-03

Five briefs, each art-directed twice against the same brand and model.

| Measure | Before | After |
| --- | --- | --- |
| Headline within the format's budget | 4/5 | 5/5 |
| Invented phone-like numbers | **1** | **0** |
| Distinct layouts across five briefs | 2 | 3 |

The one that matters: a brief saying "put our number on it" with no number
supplied produced `Call to Order: 0800 000 0000` in the baseline. A plausible
invented number on a flyer is the failure nobody catches, because it looks
finished.

## What the benchmark does NOT show

- **It does not say the designs are better.** Headline length, invented numbers
  and layout variety have one correct answer each and are computed. Hierarchy,
  brand fit and freshness are not scored, because a judge from the same model
  family grading its own output is weak evidence. **A human has to look at the
  outputs.**
- **Six briefs, one brand, one run.** Model output varies between runs, and
  visibly so: across runs of the same case the baseline invented a phone number
  once and not the next time, and placeholder counts moved. A single pass is an
  indication, not a measurement. Treat a difference of one or two as noise.
- **Specs, not images.** The training system does its work at the spec stage,
  but the user sees a rendered image, and the renderer can still fail a good
  spec.

## Known gaps, in the order I would fix them

1. ~~A placeholder is not preferred when the brief asks for the element. A
   prompt fix.~~ **Wrong on both counts; corrected after investigating.**

   The prompt rule was strengthened (the brief naming an element means a
   placeholder, never an omission) and it does work — a brief asking for the
   event date now yields `[EVENT DATE]` and `[EVENT TIME]`.

   But two other things were actually going on, and neither was a prompt:

   - **The benchmark scorer read three of four copy fields.** It reported "0
     placeholders" for a spec carrying four of them in `bodyPoints`. A
     benchmark that under-reports its own result is a broken instrument, and
     it nearly sent this investigation in the wrong direction.
   - **`bodyPoints` existed in the schema and nowhere else** — no layout drew
     it, no prompt mentioned it. The art director filled it because the schema
     offered it, and the renderer discarded every word. The benchmark caught it
     writing `[EVENT DATE] · [EVENT TIME]` and `[VENUE NAME], Lagos` into a
     field that is silently dropped. A field that eats the user's information
     is worse than no field, so it is gone.

   **What remains, and it is structural:** a phone number belongs in a footer,
   and the renderer has no footer zone at all (module 05: twelve footer systems,
   renderer has none). Contact details have nowhere to live that is actually
   drawn. That is phase 2, not a prompt.
2. **Category inference is keyword-based** on the form and quick paths. The
   chat path could be asked for the category directly and is not yet.
3. **Most of the manual is still renderer work** — 12 footer systems, 9 layout
   families, grids, multi-page. Phase 2, and `KOOS-AI-002` for carousels.
4. **The quality gate is deterministic only.** It catches blank frames, wrong
   shapes and unreadable marks. A design that is technically sound but generic
   passes. The rubric judge (module 06 §10) is the answer and is deliberately
   not wired in yet — per the decision, it runs only when a deterministic check
   has already failed, which means a design that fails nothing is never judged.
5. **Variants still share one spec**, so the parallel renders share a layout,
   a headline and a palette. Real variant diversity needs more than one spec.


---

# Phase 2 — closing the ticket's remaining acceptance criteria

*Written after building, before it ships. Deliverable #9 continued.*

Phase 1 left three of the ticket's acceptance criteria unmet. The audit below
is what a blind critic found when it was asked to reject the work, not a
self-assessment; its verdicts are in `/tmp/koos-ai-001-finish/critique/`.

## What was still unmet, and why

| Criterion | Why phase 1 did not meet it |
| --- | --- |
| "KO OS identifies the correct design type **before** writing the brief" | One `generateObject` call chose `designType` AND wrote `briefMarkdown` together. The structure was picked by the pass that was already committing to prose. |
| "Brief structure changes appropriately for each deliverable rather than using one social-media-flyer template for everything" | `formats.ts` knew the per-format constraints and was imported by the art-director prompt only. The brief step saw four templates with "post, flyer, banner, story, ad" collapsed into one, and the model chose. |
| "The system evaluates and corrects weak outputs before delivery" | `renderGuarded` re-rendered the **identical** spec on a retryable fault. That is a dice re-roll, not a correction, and nothing implemented module 06 §10's rubric or §11's correction map. |

## Unit A — the brief is routed on the deliverable

Two calls where there was one.

1. **Identify** — `deliverableSchema` + `deliverableIdentificationSystemPrompt`
   return the label, the stated size and the page count, and nothing else.
2. **Write** — `buildDesignBriefSystemPrompt(brand, format)` carries exactly
   one structure, the one `resolveDesignFormat` selected.

`assembleDesignBrief` composes the two back into the shape the Design Brief
Card and the ticket submit already store, so nothing downstream changed. The
canvas default moved out of the prompt and into `formatRules().defaultDimensions`
— "Instagram posts are 1080x1350" is a fact, not a judgement, and every default
it offers is a size `canvas.ts` can actually render.

Twelve section sets, built from module 01 §2's required-content list and §3's
four content levels, with module 05 §1-2's footer ordering. Four properties are
enforced by test rather than asserted in prose:

- no two formats share a section set;
- no two formats differ by only one heading (a rename is not a difference);
- a format the renderer cannot produce declares a Production Note section, and
  the prompt names that section exactly once — the first version named it twice,
  which let the test pass with the heading deleted from all five formats;
- the brief's headings appear in the declared ORDER. Order is the substance of
  the criterion, not decoration: modules 01 §3 and 05 §2 *are* orderings, and a
  flyer brief with all eight headings reversed satisfied every other measure.

Two content errors came out of review. The social-post footer listed its
priorities in the wrong order — module 05 §2 puts the action or primary contact
first, and `footerLines` holds three lines, so the wrong order drops the
manual's first item first; a real run demoted an order line below a handle. And
the format the renderer draws most often had nowhere to carry a date, time or
price the user supplied, which is module 01 §3's secondary level.

**Measured, 10 of 10 cases, `pnpm eval:design-brief`:** format correct 1.00,
structure clean 1.00, headline within budget 1.00, production notes 1.00, slide
count coherent 1.00, invented numbers 0, no gap dropped.

The comparison is the number that matters, not the score.
`resolveDesignFormat` run FREE on the raw conversation scores 6 of these 10;
the identification step scores 10, including all four the regex gets wrong — a
request naming no format ("something for the wall … A2 in the window"), one
carrying a decoy ("don't make it look like a poster — something simple for the
feed"), one with no keyword at all ("on our WhatsApp status … nothing
printed"), and a packaging label the regex reads as a logo. The other six name
the deliverable in the user's own words and are kept only as regression.

Three of the scorer's own measures were wrong and failed correct briefs before
this run was trusted: a heading name matching as a prefix of a longer one
(`Action` inside the poster's `Action & Access`), an optional bold marker that
let any body line starting with the word count as a heading, and a forbidden
check that read a carousel's per-slide `**Headline:**` as a flyer section
leaking in — a borrowed section stands alone on its line, an inline field does
not. Each is now a test. **An instrument that under-reports is worse than no
instrument**, and this lane has produced that failure three times.

## Unit B — the correction pass is now a correction

`src/lib/design/quality/judge.ts`. Module 06 §10's ten scored categories and
§11's symptom-to-remedy map, as one model call that returns a verdict plus
**one** prescribed change. Built as a two-variant tournament; the losing
variant's source-reading field test was the single best idea in either and was
ported into the winner.

The load-bearing constraint: a prescription may only name a field the renderer
on that route actually draws. Enforced three ways — the decoding schema's field
enum is built per renderer, `applyPrescribedChange` re-checks the field against
§11's map for the named symptom and re-validates the patched spec, and a test
reads `layouts.tsx`, `footer.ts`, `composite.ts` and the two prompt builders off
disk and fails if a correctable field is absent from the source that would draw
it. That test exists because of `bodyPoints`: a spec field nothing drew, which
the art director filled with the user's event date.

**The gate had to be split before any of it could work.** `isRetryable` is "a
fresh roll of the same spec might differ" — a blank frame or unreadable bytes.
`isCorrectable` is "a changed spec might fix it", which adds `unreadable-logo`.
While the two were one set, the only faults reaching a second render were the
two with nothing to look at, and the judge's vision half was unreachable. The
wrong shape stays out of both: adapters substitute aspect ratios
deterministically, so no spec change alters what comes back.

`renderGuarded` renders at most twice, ever, and the second render receives the
corrected spec. The row stores the spec that produced the delivered bytes, not
the draft — the layout memory reads that column back to shape the brand's next
design, and storing an uncorrected spec would teach it a layout that was never
rendered. `design_generated` now carries `quality_faults` and
`corrections_kept`, so the question "is the judge correcting anything or just
costing a call" has an answer in PostHog.

Fail-soft at both boundaries: the judge module documents itself as fail-soft,
and the job wraps the call anyway. A user never loses a rendered design because
the critic was unavailable. Past the slice deadline the correction is skipped
entirely — it costs a reasoning call plus a second image render, and this
project has measured single images at 55-663s against a 300s route.

**`logoFault` has four producers and only one is a measurement.** Only the
compositor's contrast comparison measures a mark against its ground; the other
three mean the mark never reached the design — satori could not decode the
file, the image model returned a format the overlay cannot stamp, or the stamp
threw. `markReads()` keeps them apart. Conflating them would spend a reasoning
call and a full second image render, on every generation, forever, for every
brand whose logo file we cannot read, while `checkRenderedDesign` asserted a
pixel measurement that never happened.

`betterResult` ranks by the worst fault before the count. A count alone made a
blank rectangle and a real design with one hard-to-read mark equally bad, so a
correction that produced the real design was discarded and the empty frame
delivered.

**New paid lane `pnpm eval:design-judge`.** The 101 gate tests on `judge.ts`
protect its *refusals* — `correct()` has seven ways to turn a prescription down
and nearly every one has a test that goes red when removed — while every test
asserting an accepted correction feeds it a hand-written object built to pass.
So the suite cannot tell a judge whose prescriptions land from one that returns
a verdict and then refuses itself, which costs a reasoning call per failed
variant and delivers the design the user already had. The lane measures the
acceptance rate against all seven guards, renders its designs locally through
the real composite path (reasoning tokens, no image generations), and treats an
undrawn field, an unchanged spec reported as corrected, or a refusal it cannot
attribute as hard failures.

**Measured, 9 cases:** acceptance rate 0.89, symptom-treats-field 1.00, verdict
rate 1.00, zero undrawn fields, zero unchanged specs reported as corrected,
zero unattributable refusals.

Its first run earned its keep immediately. Two prescriptions were discarded
that were *correct*: the decoding schema constrains the field to the route's
drawn set, `prescribableFields` then requires it to be in the symptom's §11
row, and the system prompt never stated the second rule — **the model was held
to a constraint it could not see**, and in one case it was refused for
prescribing that a mark be moved off the headline it was sitting on. Fixed by
generating each symptom's allowed fields into the prompt from the same map the
guard reads, and by applying the map's own documented principle to `weak-cta`
on the native route, where `nativePrompt` is the only thing that draws the
action. §11's `artificial` row was deliberately NOT widened to admit
`logoPlacement`: the manual's `artificial` is light, shadow, perspective and
texture, and bending the map to pass a threshold would make it mean nothing.
No threshold was lowered.

With the pairing shown, the model re-judged that case as `artificial` and
prescribed `backgroundPrompt` — a field that row genuinely owns — and it was
accepted. The map did not need bending.

Two gaps that run named and left open:

1. **No §11 symptom owns "an element collides with the copy."** `logoPlacement`
   sits only under `off-brand`, which is about identity, not composition; the
   nearest shape is `pasted-footer`'s "connect its geometry, colour, overlap or
   spacing to the composition", and that is scoped to the footer by name.
   Stretching either would make the map mean nothing. The honest home is the
   deterministic layer: `resolveLogoPlacement` and `cornersBlockedByFooter`
   already keep a mark off footer bands and layout copy zones, but they reason
   from the layout TEMPLATE, so a headline that wraps to four lines into the
   top-right corner is invisible to them. A mark/copy overlap check in
   `quality/checks.ts`, measured from the render the way the logo contrast
   already is, would raise it as a named fault — and then the existing
   `off-brand` → `logoPlacement` path is a legitimate remedy for it.
2. **The native field guide is looser than the guard it is held to.** It says
   "never ask for a logo"; the judge did not ask for one, it reserved space for
   one ("the upper quarter is clear dark ground so a brand logo can sit
   top-right"), and the vocabulary guard refused it. The guard's behaviour is
   correct — that vocabulary is KOOS-BUG-022 — but the guide should say the word
   must not appear at all, even to reserve room, because `nativeLogoClause`
   already reserves that space on every native render.

## What this still does not do

1. **Nothing measures whether a corrected render is better than a re-roll.**
   The gate checks that the correction is applicable and that it changes what is
   drawn, never that it improved anything — measuring improvement needs a third
   render, which is the loop Oluwaseyi ruled out. The PostHog counters are the
   first evidence; a paid eval comparing corrected renders against re-rolls is
   the honest next step and is not built.
2. **A technically clean but generic design is still never judged.** That is
   the chosen trigger working as specified: the judge runs only after a
   deterministic check has failed. It remains the knob to turn if quality
   complaints continue.
3. **The calendar brief writer is unrouted.** `buildCalendarChunkPrompt` drafts
   briefs for a chunk of slots whose formats differ from each other in one call,
   so no single structure can serve it, and it keeps the four-template block.
   Per-format routing there is possible — the format is settled per slot in the
   outline call — and is the next brief-side improvement. It has no eval, which
   is why it was not touched in the same change.
4. **`improve-brief.ts` is deliberately unrouted.** It polishes a brief the
   client typed into the request form, in plain text, preserving their words. A
   section structure is the wrong tool for that job.
5. **A story is briefed as a social post.** `resolveDesignFormat` maps `/story/`
   to `social-post`, which defaults to 4:5 rather than 9:16. Adding a format
   touches the playbooks, the section sets and the canvas table together.
6. **Variants still share one spec.** Deliberate, and Oluwaseyi's decision: the
   parallel renders exist so the user can compare the composite and native
   ROUTES on the same design. Making them differ by spec would replace that
   comparison with two unrelated designs.
7. **Six briefs and eight cases, one brand.** Model output varies between runs.
   Treat a one-case difference as noise.

**The open ask is unchanged: a designer has to look at the output.** Every
measure in both lanes is deterministic, because a judge from the same model
family grading its own work is weak evidence. Routing, section sets, word
budgets, invented numbers, which fields are drawn and how many renders happen
are all computed. Whether the designs are good is not, and no harness here can
answer it.
