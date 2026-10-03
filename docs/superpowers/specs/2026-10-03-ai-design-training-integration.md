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
- **Five briefs, one brand, one run.** Model output varies between runs; a
  single pass is an indication, not a measurement.
- **Specs, not images.** The training system does its work at the spec stage,
  but the user sees a rendered image, and the renderer can still fail a good
  spec.

## Known gaps, in the order I would fix them

1. **A placeholder is not preferred when the brief asks for the element.** In
   the benchmark the training arm stopped inventing a number but omitted it
   rather than writing `[PHONE NUMBER]`. Module 07 permits either; when the
   brief explicitly asks for the number, the placeholder is better, because
   omission silently drops something the user asked for. A prompt fix.
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
