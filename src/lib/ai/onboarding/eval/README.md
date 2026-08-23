# Onboarding extraction eval

Periodic quality eval for conversational brand extraction — the step that turns
an onboarding chat into a filled brand profile. Every case is a real Bedrock
call, so this is the paid lane, not something to hang off a commit hook.

```
pnpm eval:onboarding                       # all cases
pnpm eval:onboarding --case sparse-two-facts   # one case
```

Exits non-zero if any case falls below threshold, so it can gate a release.
Writes `qa-reports/eval/onboarding-extraction.json` (gitignored).

## Cost

One short structured completion per case. Three default cases on
`us.anthropic.claude-sonnet-4-6` is a few cents per run, billed to Bedrock.

## What it checks, and why it is split

Only the extraction call is non-deterministic. Everything downstream of it has
exactly one right answer for a given transcript, so none of it goes to a judge:

| Question | Answered by |
| --- | --- |
| Did it fill the fields the transcript states? | key presence, computed |
| Does the value carry the transcript's facts? | required substrings, computed |
| Did it invent a field nobody mentioned? | forbidden-key set, computed |

Value checks are substring anchors (`targetAudience` must contain `25` and
`40`), not exact matches, so a reasonable rephrasing passes and a fabrication
does not.

## The three metrics

**Recall** is the headline. The whole promise is "you don't fill this form by
hand", and every miss puts a field back on the user. Threshold 0.80.

**Value accuracy** catches the field that was filled with the wrong thing —
worse than a blank, because the form looks done.

**Invention** is held near zero (max 1 per case) and is the metric that
matters most. A hallucinated value gets confirmed onto a real brand profile by
a user who has no reason to doubt it. `sparse-two-facts` exists solely to
apply that pressure: a transcript with one usable fact and fifteen forbidden
fields, which is exactly where a model is most tempted to fill the silence.

## Adding a case

Add to `EXTRACTION_EVAL_CASES` in `cases.ts`. List every field the transcript
genuinely supports under `expected` with lowercase `contains` anchors, and put
the tempting-but-unstated fields in `forbidden`. Gate tests in `score.test.ts`
check that no field is both, and that every expected field has an anchor.
