# Design Studio: sets of frames (KOOS-AI-002)

The client side of carousels and presentations. A set is one thing to the
user: one card in the history, one viewer, one ZIP or PDF.

| File | What it is |
| --- | --- |
| `set-model.ts` | Pure: rows to a `DesignSet` (every index, in order), the live row per index, gallery grouping, role labels, download URLs. |
| `use-frame-set.ts` | One set on screen plus per-frame regenerate (`POST /api/design/generations/[id]/regenerate-frame`, polled, swapped in place). Pending keys are `regen:${generationId}`. |
| `progress.ts` | Reads the progress the sequence job already sends (`{stage, done, total}`) as the set's: "Planning your carousel…", "Frame k of N…", "Checking your carousel…". |
| `set-viewer.tsx` | Stage (`set-stage.tsx`, with a failed frame's retry on the frame), filmstrip (`frame-rail.tsx`), the selected frame's actions (edit, regenerate, download this frame) and inline editor (`frame-editor.tsx`), whole-set downloads (`set-downloads.tsx`). |
| `set-progress.tsx` | The wait for a whole set in the directions dialog. |
| `set-card.tsx`, `set-viewer-dialog.tsx` | The history grid's card (aspect box and skeleton until the cover is in) and the dialog it opens. |

`use-design-generation.ts` composes `useFrameSet`: a job result with
`kind: "sequence"` loads its frames by id and exposes them as `set`.

## How the wait knows it is a set

The client is told nothing extra. `generate(args, { sequenceKind })` takes
the kind the entry point's design type names (`sequenceKindOf`; the dialog
reads it from `ticketContext.designType`). That only names the wait and
gives the poll `SET_POLL_TIMEOUT_MS`; the server alone decides whether a set
is built (FEATURE_MULTI_FRAME).

Whether the run IS a set comes from the job's progress: stage
`brief`/`render`/`checks` with a total above two. A directions run reports a
total of two at most, so a flag-off carousel brief keeps the directions wait.
The one blind spot is a two-frame carousel, which waits as directions and
still opens as a set. Design Studio has no design type to give, so its set
wait says "slides" rather than "carousel".

## A set that outlives the poll

A set resumes across 210s slices and can outlast any client timeout. When
the poll gives up, the hook asks `/api/jobs/[id]` once: anything short of
`failed` is "still running" (`stillRunning`), the dialog says so, and "Keep
waiting" polls the same job again. A second job is posted only once the
first is known to have failed, so a slow set is never billed twice.

## Frame copy on the wire

`SerializedGeneration` carries `headline`, `subheadline` and `cta` from the
spec, so the editor opens with the frame's own lines. The headline is
required and every field is held to the renderer's limit before anything is
sent; a cleared subheadline or CTA removes that line.

## Testing

`pnpm vitest run src/components/design/sequence src/components/design/use-design-generation.sequence.test.ts src/components/design/directions/design-directions-dialog.test.tsx`
