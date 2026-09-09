# Design image eval

Periodic quality eval for the Google image adapter. Renders real images and
scores them, so it is the paid lane — not something to hang off a commit hook.

```
pnpm eval:design                          # all cases
pnpm eval:design --case square-wordmark   # one case
pnpm eval:design --model gemini-3.1-flash-image   # compare models
```

## Cost

One image per case at the model's per-image rate. With the five default cases
on `gemini-3-pro-image` that is 5 × $0.134 ≈ **$0.67** per run, billed to the
Google Cloud trial credit via the Vertex transport.

## What it checks, and why it is split

Two kinds of question, deliberately answered by two different mechanisms.

**Computed, not asked.** Dimensions, aspect ratio and "is this frame blank"
have exactly one correct answer given the inputs, so `run.mts` derives them
with `sharp`. Asking a model would add cost, latency and variance to a question
arithmetic already settles. Structural checks must pass at **100%** — a wrong
aspect ratio is a bug, never model variance.

The aspect-ratio assertion is the sharp end of this. The image-model argument
takes an enum with no 4:5, so `toGoogleAspectRatio` substitutes 3:4 there — but
the adapter also sends the true ratio in `imageConfig`, which accepts 4:5 and
whose value replaces the SDK's own. So 4:5 is served as 4:5, and
`expectedPixelRatio` asserts the requested ratio rather than a substituted one.
Change what the adapter sends and this expectation has to move with it, or the
run fails on `portrait-true-ratio` every time.

**Judged.** Whether rendered copy is legible and correctly spelled is a
genuine judgement call, so it goes to the local Claude Code CLI (`judge.mts`),
per the project rule that our software calls Claude Code rather than a hosted
LLM API. Legibility passes at **80%** — it is model behaviour and allowed to
wobble.

## Cases

Chosen to cover what can silently break: every supported aspect ratio, the 4:5
substitution, short and multi-word copy, and the text-free plate the composite
renderer depends on. The plate case inverts the assertion — any lettering at
all is a failure.

`cases.test.ts` is the free gate lane over these fixtures: unique ids, valid
ratios, full ratio coverage, and expected copy actually present in its own
prompt. A malformed case fails on commit rather than halfway through a paid run.

## Output

Images and `report.json` land in `qa-reports/eval/` (gitignored). The process
exits non-zero when either threshold is missed, so it can gate a release.

## Credentials

Reads the service-account JSON at `~/dev247/envs/koos/vertex-sa-key.json` and
sets the same env vars the app uses in Vercel, so the eval exercises the real
Vertex transport rather than a local-only shortcut.
