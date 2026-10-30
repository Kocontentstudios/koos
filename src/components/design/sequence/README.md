# Design Studio: sets of frames (KOOS-AI-002)

The client side of carousels and presentations. A set is one thing to the
user: one card in the history, one viewer, one ZIP or PDF.

| File | What it is |
| --- | --- |
| `set-model.ts` | Pure: rows to a `DesignSet` (every index, in order), the live row per index, gallery grouping, role labels, download URLs, `isBuilding` / `markStalled` / `mergeSets` for sets still on their way. |
| `use-frame-set.ts` | One set on screen plus per-frame regenerate (`POST /api/design/generations/[id]/regenerate-frame`, polled, swapped in place). Pending keys are `regen:${generationId}`. A frame whose job outlives the poll is `stillRunning`, and `keepWaiting(index)` follows the same job. `refresh(set)` takes a fresher read without dropping a regenerate in flight. |
| `progress.ts` | Reads the job's progress as the set's: "Planning your carousel…", "Frame k of N…", "Checking your carousel…". |
| `set-jobs.ts` | The set and frame jobs this browser started and has not seen end (localStorage, every access guarded). |
| `use-set-watch.ts` | Design Studio's watcher: polls those jobs (which resumes a set past its slice), reads pending frames again, adds what a finished job made, and says which sets have stalled. |
| `set-viewer.tsx` | Stage (`set-stage.tsx`, with a failed frame's retry on the frame), filmstrip (`frame-rail.tsx`), a `role="status"` line while frames are still coming, the selected frame's actions (edit, regenerate, download this frame) and inline editor (`frame-editor.tsx`), whole-set downloads (`set-downloads.tsx`). |
| `set-progress.tsx` | The wait for a whole set in the directions dialog. |
| `set-card.tsx`, `set-viewer-dialog.tsx` | The history grid's card (aspect box and skeleton until the cover is in; "k of N" while building), the placeholder card for a set of ours with no frame yet, and the dialog a card opens. |

`use-design-generation.ts` composes `useFrameSet`: a job result with
`kind: "sequence"` loads its frames by id and exposes them as `set`.

## How the wait knows it is a set

In order of trust:

1. The job's own mark on its progress, `{ sequenceKind, setId? }`
   (`src/lib/design/sequence/progress-mark.ts`). The server's `report()` adds
   it with `sequenceMarkFor(kind, setId)`.
2. `generate(args, { sequenceKind })`. The dialog passes it only when
   FEATURE_MULTI_FRAME is on (`MultiFrameProvider`) and the ticket's design
   type names a carousel or presentation, which is exactly when the server
   builds a set. The wait then opens as the set's ("Planning your
   carousel…") before the first report, and a two-frame carousel reads as a
   set.
3. With neither: stage `brief`/`render`/`checks` and a total above two,
   which no directions run reports.

With the flag off the dialog passes no options at all, so single designs and
flag-off briefs start, poll and fail exactly as before.

## A set that outlives the poll

A set resumes across 210s slices, and only while something polls its job.
`pollGenerationJob` throws `PollTimeoutError` or `PollConnectionLostError`
(`src/lib/generation/poll-errors.ts`) when it stops waiting, and a plain
error when the job failed. For a set the first is "still running": the
dialog says so, "Keep waiting" polls the same job, and no second job is
posted. A directions run keeps its old behaviour: any way the poll ends is
that run's error.

The set's job id is kept in `set-jobs.ts` from the moment the run is known
to be a set. Design Studio's `useSetWatch` polls it every 3s, which keeps
the set resuming after the brief's wait was closed, swaps frames into the
card and the open viewer as they land, and adds the set when its job ends.
Frames still pending once no job of ours could be building them (the job
failed, or the frame is older than `STALLED_AFTER_MS`) show as stopped,
with the on-frame retry.

## Frame copy on the wire

`SerializedGeneration` carries `headline`, `subheadline` and `cta` from the
spec, so the editor opens with the frame's own lines. Limits are
`COPY_LIMITS` from `src/lib/jobs/directions/schema.ts`, the ones the route
checks. The headline is required, and so is the action frame's button text;
a cleared subheadline removes that line.

## Testing

`pnpm vitest run src/components/design/sequence src/components/design/use-design-generation.sequence.test.ts src/components/design/directions/design-directions-dialog.sequence.test.tsx "src/app/(dashboard)/design-studio"`
