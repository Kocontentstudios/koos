# Design Studio: sets of frames (KOOS-AI-002)

The client side of carousels and presentations. A set is one thing to the
user: one card in the history, one viewer, one ZIP or PDF.

| File | What it is |
| --- | --- |
| `set-model.ts` | Pure: rows to a `DesignSet` (every index, in order), the live row per index, gallery grouping (every set gets a card, cover or not), role labels, download URLs, `isBuilding` / `markStalled` / `mergeSets` for sets still on their way. |
| `use-frame-set.ts` | One set on screen plus per-frame regenerate (`POST /api/design/generations/[id]/regenerate-frame`, polled, swapped in place). Pending keys are `regen:${generationId}`. A frame whose job outlives the poll is `stillRunning`, and `keepWaiting(index)` follows the same job. `refresh(set)` takes a fresher read without dropping a regenerate in flight. |
| `progress.ts` | Reads the job's progress as the set's: "Planning your carousel…", "Frame k of N…", "Checking your carousel…". |
| `set-jobs.ts` | The set and frame jobs this browser started and has not seen end, with what it knew at the start: the kind the dialog expected, a frame job's set (localStorage, every access guarded). |
| `use-set-watch.ts` | Design Studio's watcher: polls the open jobs (which resumes a set past its slice), reads pending frames again, adds what a finished job made, says which sets have stalled (`stalledSets`) and which jobs still need a placeholder card (`placeholderJobs`). |
| `set-viewer.tsx` | Stage (`set-stage.tsx`, with a failed frame's retry on the frame), filmstrip (`frame-rail.tsx`), the viewer's one `role="status"` region, the selected frame's actions (edit, regenerate, download this frame) and inline editor (`frame-editor.tsx`), whole-set downloads (`set-downloads.tsx`). |
| `set-progress.tsx` | The wait for a whole set in the directions dialog. |
| `set-card.tsx`, `set-viewer-dialog.tsx` | The history grid's card (aspect box and skeleton until the cover is in; "k of N" while building; a stated failure when no frame rendered), the placeholder card for a set job with no row yet, and the dialog a card opens. |

Outside this folder:

| File | What it is |
| --- | --- |
| `src/components/design/directions/design-flags-provider.tsx` | Server component. Reads FEATURE_KO_IMAGERY and FEATURE_MULTI_FRAME and hands both down. Design Studio, strategy (brief panel) and calendar pages wrap themselves in it; `src/app/(dashboard)/multi-frame-pages.test.tsx` checks all three. |
| `src/lib/design/sequence/progress-mark.ts` | The mark a set or frame job puts on its progress. |
| `src/lib/design/sequence/open-set-jobs.ts`, `.server.ts`, `src/app/api/design/set-jobs/route.ts` | `GET /api/design/set-jobs?brandId=`: the caller's open set and frame jobs for the brand, found by that mark. |

`use-design-generation.ts` composes `useFrameSet`: a job result with
`kind: "sequence"` loads its frames by id and exposes them as `set`.

## How the wait knows it is a set

In order of trust:

1. The job's own mark on its progress, `{ sequenceKind, setId?, frameIndex? }`
   (`src/lib/design/sequence/progress-mark.ts`).
   **Not emitted yet.** The producer is the sequence job and the
   regenerate-frame job (unit U2), neither of which is on this branch. They
   must spread `sequenceMarkFor(kind, setId)` (set job, `setId` from the
   moment the plan is saved) or `frameMarkFor(kind, setId, index)` (frame
   job) into every `reportProgress` call. Until they do, rules 2 and 3 are
   what the app runs on, and the server's set-job list (below) is empty.
2. `generate(args, { sequenceKind })`. The dialog passes it only when
   FEATURE_MULTI_FRAME is on (`useMultiFrameOffered()`, from
   `DesignFlagsProvider`) and the ticket's design type names a carousel or
   presentation, which is exactly when the server builds a set. The wait
   then opens as the set's ("Planning your carousel…") before the first
   report, and a two-frame carousel reads as a set. This is live for the
   brief and calendar entry points. Design Studio's own prompt has no ticket
   and no design type, so it falls to rule 3.
3. With neither: stage `brief`/`render`/`checks` and a total above two,
   which no directions run reports.

With the flag off the dialog passes no options at all, so single designs and
flag-off briefs start, poll and fail exactly as before.

## A set that outlives the poll

A set runs as several slices, each under the 300s serverless limit, and
resumes into the next only while something polls its job.
`pollGenerationJob` throws `PollTimeoutError` or `PollConnectionLostError`
(`src/lib/generation/poll-errors.ts`) when it stops waiting, and a plain
error when the job failed. For a set the first is "still running": the
dialog says so, "Keep waiting" polls the same job, and no second job is
posted. A directions run keeps its old behaviour: any way the poll ends is
that run's error.

Design Studio's `useSetWatch` polls every open set and frame job every 3s.
That keeps a set resuming after the brief's wait was closed, swaps frames
into the card and the open viewer as they land, and adds the set when its
job ends. The jobs come from two places:

- `GET /api/design/set-jobs`, read on arrival, when the tab comes back into
  view, and every fifth tick while anything is being watched. This is what
  drives a set started on another device, in a private window, or before
  site data was cleared. It finds jobs by the mark (rule 1).
- `set-jobs.ts`, for jobs this browser started. This covers a job's first
  seconds before it has reported, and every job until U2 emits the mark.

A set shows as stopped, with the on-frame retry, only when no running job
could be building it, and either:

- the set job known to have built that set ended without delivering it, or
- its oldest pending frame is older than `STALLED_AFTER_MS`.

A set job is known to have built a set when its mark named the set. A set
job that ended without naming a set stops nothing, and neither does a
failed frame job, which speaks only for its own frame. That set may belong to a job this browser cannot see, and a retry
would bill a frame that is already on its way.

The placeholder card is per job. A job that names its set gets no
placeholder once that set has a card. A job that does not name its set
takes the earliest unclaimed set first written after it started. So a set
in its checks stage never shows twice, and an older set still building
never hides a new one.

## Downloads

ZIP and PDF wait while frames are still landing ("Downloads open once every
frame is in. 3 of 5 so far."). A set that ended short is labelled with what
the file holds ("Download ZIP · 4 of 5"). A set with no rendered frame
offers nothing to download.

## Frame copy on the wire

`SerializedGeneration` carries `headline`, `subheadline` and `cta` from the
spec, so the editor opens with the frame's own lines. Limits are
`COPY_LIMITS` from `src/lib/jobs/directions/schema.ts`, the ones the route
checks. The headline is required, and so is the action frame's button text;
a cleared subheadline removes that line.

## Testing

`pnpm vitest run src/components/design/sequence src/components/design/use-design-generation.sequence.test.ts src/components/design/directions "src/app/(dashboard)/design-studio" "src/app/(dashboard)/multi-frame-pages.test.tsx" src/app/api/design/set-jobs src/lib/design/sequence/open-set-jobs`
