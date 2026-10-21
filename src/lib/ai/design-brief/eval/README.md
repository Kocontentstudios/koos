# eval:design-brief — does the brief follow the deliverable's structure?

```
pnpm eval:design-brief            # all cases
pnpm eval:design-brief --case flyer-missing-number
```

Paid lane. Two structured completions per case, text only, 8 cases — so a full
run is 16 model calls and no images. Run it before shipping a change to
`src/lib/ai/prompts/design-request.ts`, `brief-structures.ts`,
`src/lib/design/formats.ts` or the model, and nightly.

## What it exists to catch

The brief generator had no eval at all. One `generateObject` call chose the
design type AND wrote the brief, against four templates and an instruction to
pick the matching one — with "post, flyer, banner, story, ad" collapsed into
the same template. A thumbnail that can carry four words was asked for
supporting copy; a flyer's venue and phone number had no section of their own.

It is now two calls: identify the deliverable, then write the brief against
that format's structure alone. This lane is what proves a real model follows
the routing, because nothing in a gate test can.

## What it measures, and why none of it goes to a judge

Each has one correct answer given the output, so all of it is computed
(`score.ts`):

| measure | question |
| --- | --- |
| `formatCorrect` | does the label the model chose resolve to the format the request asked for |
| `structureClean` | every heading the format declares is present, and no heading only another format declares |
| `withinBudget` | is the headline inside the format's word budget (+2 slack, because the prompt says "roughly") |
| `productionNotes` | does a format the renderer cannot produce actually state the limitation — a heading saying "none needed" fails |
| `slidesCoherent` | a sequence has a page count, a single frame does not |
| order | the declared headings appear in the declared order — `structureClean` requires it, because modules 01 §3 and 05 §2 ARE orderings and a brief with every heading reversed passed every other measure |
| `inventedNumbers` | **any** is a failed run, not a share |
| `unacknowledgedGaps` | a detail the user asked for and never supplied has to reach the designer, in a placeholder or in words |

Expectations are DERIVED from `sectionNamesFor(format)`, so adding a section to
a format automatically widens what the eval demands and a section borrowed from
another format is automatically a failure. Hand-listing three of eight headings
once let a brief carrying three sections score a clean structure.

## The baseline this lane has to beat

`resolveDesignFormat` run free on the raw conversation text — no model at all —
scores **6 of the 10 cases** (measured 2026-10-05; reproduce with the snippet
in `cases.ts`'s header comment). Six cases name the deliverable in the user's
own words, so they measure a regex on a copied label and are kept only as
regression. The four that need the model are the lane's real content:

| case | why a keyword scan fails |
| --- | --- |
| `unnamed-poster` | "something for the wall … A2 in the window … read it walking past" names no format at all; the regex says `other` |
| `decoy-keyword` | "don't make it look like a poster — something simple for the feed"; the regex matches the decoy and says `poster` |
| `no-keyword` | "on our WhatsApp status and the feed, nothing printed"; the regex says `print-collateral` |
| `packaging-not-generatable` | "the label design for the new 1kg pouch"; the regex says `logo` |

`changed-mind` (a request that asks for a flyer and then switches to a
carousel) is answered by pattern order alone, so it is regression too — kept
because a model that ignores a correction mid-conversation is a real failure.

## What it does not measure

Whether the briefs are any good. A designer reads them for that — the report
at `qa-reports/eval/design-brief-routing.json` keeps every brief the model
wrote under `briefs` so a verdict can be checked by eye.

Eight cases, one brand, one run each. Model output varies between runs; treat a
one-case difference as noise.

## Traps this lane has already hit

- **The scorer demanded a `[PHONE NUMBER]` token.** That is the design spec's
  convention, where the text is drawn onto the image. A brief is read by a
  human, so "client to supply the phone number" is the better output, and the
  first run scored correct behaviour as a miss. `acknowledgesGap` now accepts
  either.
- **A carousel scored a 189-word headline against a 7-word budget.** The
  carousel format declares no Headline section — each slide carries its copy —
  and the scorer searched the raw markdown and found a slide's internal
  heading. The headline is now read only where the format declares it.
- **`sectionBody` bounded on the next bold run.** The whole prompt is written
  in bold, so a model bolding its own headline measured as zero words and
  failed a correct brief. It is bounded on the next DECLARED heading.
