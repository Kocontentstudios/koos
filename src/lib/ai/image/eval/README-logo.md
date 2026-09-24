# Brand logo eval

Measures whether the brand's own logo actually survives to a finished design.

```
pnpm eval:design-logo                             # all cases
pnpm eval:design-logo --case native-wordmark      # one case
```

## Why this lane exists

`eval:design` does not cover it. That suite hands literal prompt strings to the
image adapter and never builds a `DesignSpec` or calls a renderer, so the code
that actually places the logo — the composite overlay in `render/layouts.tsx`
and the native stamp in `render/logo-overlay.tsx` — had no eval coverage at
all.

The regression it guards is real and shipped (KOOS-BUG-022). Four things went
wrong at once and every one of them returned a perfectly valid PNG:

- `logoPlacement` includes `"none"` and the art-director prompt said nothing
  about the logo, so the model chose `"none"` freely.
- resvg does not fail loudly. Handed an image it cannot decode — a damaged
  IDAT, a truncated upload, a CMYK JPEG — it skips the node and returns a
  valid PNG of everything else, so a design rendered with an empty corner and
  nothing threw. `probeLogo` draws the mark on its own first and looks at the
  result, because there is no exception to catch.
- A dark mark on a dark ground is drawn perfectly and is invisible. The probe
  measures the mark's luminance and `groundLuminanceUnderLogo` reads the
  picture where the mark will land, so a backing plate appears only when the
  contrast is actually short.
- The loader labelled every logo `image/png`, while uploads accept JPEG and
  SVG — satori cannot decode either through the wrong mime.
- The logo was recovered as `references[0]`, which was the logo only while the
  logo loaded; a brand whose logo failed got its own attachment drawn instead.
- A logo that could not be loaded was dropped silently.

Verified to have teeth: making `<Logo>` return null drops `present` to 0% and
the run exits non-zero.

## Cost

Only two cases spend. `native-wordmark` generates a design and
`composite-square-plate` generates a background plate — 2 × ~$0.134 ≈ **$0.27**
per run on `gemini-3-pro-image`. The other three render locally through satori.

## What it scores

Deterministically in `logo-score.ts`, from one vision reading per image. No
second opinion: once the pixels have been read, "is there exactly one logo, in
the corner the spec asked for, undistorted and off the text" has one answer.

| Metric | Meaning | Threshold |
|---|---|---|
| `present` | Exactly one logo mark is visible (zero for a logo-free case) | 1.0 |
| `placed`  | It sits in the corner `spec.logoPlacement` named | 0.8 |
| `clean`   | Not stretched, cropped, or overlapping any copy | 1.0 |

`present` has no tolerance, because a missing logo is the entire ticket. Two
marks fail it as hard as none — that means the image model drew its own beside
the one we composited, which looks deliberate and is worse. `placed` allows one
case in five to drift, since a native model chooses its own composition and may
leave the clear space slightly off-corner.

## What this lane does NOT cover

The art-director half. Whether the model stops reaching for `"none"`, and
whether it can tell a brief asking for the mark to be REMOVED from one
insisting it be KEPT, needs a real `generateObject` call — that lives in
`pnpm eval:design-spec` as the `logo-placed`, `logo-free-brief` and
`logo-insisted-brief` cases. This lane hand-writes its specs so it is testing
the renderer, not the model.

## Cases

| Case | What it covers |
|---|---|
| `composite-square-flat` | The mark survives the renderer at all, on a flat ground |
| `composite-wordmark-card` | A wide mark in `quote-card` — the shape and layout that used to put it on the centred copy |
| `composite-square-plate` | Over real photography, where contrast against the plate is the risk |
| `native-wordmark` | The model composes and we stamp; doubling is the failure to watch |
| `composite-logo-free` | A brief that asked for none must get none — the fix must not trade one wrong behaviour for another |

Note that the logo-free case reaches the renderer **with** a logo loaded. The
assertion is that placement suppresses it, not that nothing was available.

`logo-cases.test.ts` and `logo-score.test.ts` are the free gate lane over the
fixtures and the scorer: unique ids, both routes and both mark shapes covered,
no case that expects a logo from a placement of `"none"`, and the paid-image
count pinned so adding a case shows up as a cost change in the diff.

## Fixtures

The marks are generated, not checked in — no binaries in the repo. `logoPng`
in `render/logo-fixtures.ts` writes real RGBA PNGs: a ring for the square mark
and three discs for the wordmark.

Circles rather than rectangles, deliberately. A vision judge asked "is this
mark distorted or cropped" cannot answer for a bar or a block — every rectangle
looks like a rectangle, and an L-shaped one reads as a rectangle that got cut
off. An early run failed every case on `distorted` for exactly that reason,
with the render being correct. A squashed ring is visibly an ellipse, and a
ring cannot plausibly be a crop of anything, so the verdict is about the
renderer rather than about the fixture.

## Two lessons worth keeping

**A coverage floor is not a proxy for "did it draw."** The probe first asked
whether at least 1% of its frame got ink. A 20:1 wordmark and a mark sitting
inside a roomy artboard both draw perfectly and cover almost nothing, so the
floor deleted real logos and told the user their file was damaged — the
reported bug again, with a worse message. The only question a probe can
honestly answer is whether *anything* appeared.

**A transient judge failure is not a content failure.** A CLI timeout scored a
case as FAIL, which is how a lane becomes something you learn to ignore. The
judge call retries once; a genuinely bad answer still fails, because it is the
same question asked twice.

## Output

Images land in `qa-reports/eval/logo-<case>.png` with `logo-report.json`
alongside (gitignored). Non-zero exit when a threshold is missed.

## Credentials

Same as `eval:design`: the service-account JSON at
`~/dev247/envs/koos/vertex-sa-key.json`, plus the `claude` CLI on PATH for the
judge.
