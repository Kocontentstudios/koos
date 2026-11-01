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
| `set-viewer.tsx` | Stage (`set-stage.tsx`, with a failed frame's retry on the frame), filmstrip (`frame-rail.tsx`), the viewer's one `role="status"` region, the slides the job left out and why (`leftOutNotice`, from the result's `framesLeftOut`; a static note, not a live region), the selected frame's actions (edit, regenerate, download this frame) and inline editor (`frame-editor.tsx`), whole-set downloads (`set-downloads.tsx`). |
| `outline-model.ts` | Pure: the outline the user edits before generating (`OutlineDraft`). Hook first and action last by construction, add and delete within `FRAME_BOUNDS`, `OUTLINE_LIMITS` held as typed, the client mirror of the server's empty/too-long/markup rules, source, facts and flags settled against the planner's points after every edit (a punctuation-only edit changes nothing), undo for deletes, overlap reasons renumbered after an edit, brief facts a deletion or retitle leaves unstated, `toApproved` for the generate body. |
| `use-outline.ts` | `POST /api/design/outline`: idle, loading, empty, error (429 says when to try again) and ready. A re-plan keeps the draft on screen until the new one lands; the latest request wins. |
| `outline-step.tsx` | The outline step in the directions dialog: one card per point (slide, role, source, title, point), weak flags as a callout with "Replace with my own point", add before the action, delete (with undo) and reorder body points, 44px targets on a phone, re-plan at a chosen count (a 44px native select with its own chevron, since the base layer's 12px select padding hides the number; asks first when edited), "Generate N slides · N units". Its geometry is checked in Chromium by `directions-dialog.layout.test.tsx`. |
| `set-progress.tsx` | The wait for a whole set in the directions dialog. |
| `set-card.tsx`, `set-viewer-dialog.tsx` | The history grid's card (aspect box and skeleton until the cover is in; "k of N" while building; a stated failure when no frame rendered), the placeholder card for a set job with no row yet, and the dialog a card opens. |

Outside this folder:

| File | What it is |
| --- | --- |
| `src/components/design/directions/design-flags-provider.tsx` | Server component. Reads FEATURE_KO_IMAGERY and FEATURE_MULTI_FRAME and hands both down. Design Studio, strategy (brief panel) and calendar pages wrap themselves in it; `src/app/(dashboard)/multi-frame-pages.test.tsx` checks all three. |
| `src/lib/design/sequence/progress-mark.ts` | The mark a set or frame job puts on its progress. |
| `src/lib/design/sequence/open-set-jobs.ts`, `.server.ts`, `src/app/api/design/set-jobs/route.ts` | `GET /api/design/set-jobs?brandId=`: the caller's open set and frame jobs for the brand, found by that mark or, without it, by the job's input and checkpoint. |
| `src/lib/design/generation-ids.ts` | `MAX_GENERATION_IDS`, the route's by-id limit, and `chunkIds`, which the watcher reads with. |

## The outline step

With FEATURE_MULTI_FRAME on and a design type that is a carousel or
presentation, choosing the image does not start the run. The brief panel and
the calendar drawer hand the dialog that type through `ticketContext`; Design
Studio hands it `designType={primaryDesignType(attached options)}`, read from
the `designType` each picker option now carries (`/api/design/context`), by
the same precedence the server merges attachments with
(`src/lib/design/attachments.ts`). The dialog moves to
the outline step (`outline-step.tsx`), plans the outline once, and keeps the
user's draft until the dialog closes, so going back to change the image never
loses an edit. Generate sends `approvedOutline` (`toApproved`) with the run;
the outline stays on screen, read-only with its button busy, while
`/api/design/generate` is answering (`posting`), so nothing typed then is
lost, and the set's own wait opens already knowing the approved count. A run that fails
offers "Edit outline", and a refused outline names the slide
(`Invalid outline. Slide 2: …`). Flag off, or a single design, there is no
outline step and no outline request (O7). The API contract is
`src/lib/design/sequence/OUTLINE.md`.

Weak flags are the server's (`flagOutline`). The client never invents one.
The draft keeps each planner point as it arrived (`planned`), and after every
change works source, facts and flags out against it (`settle`), so they
follow what is on screen:

- Source follows the claim, not the title. A point is `"user"` only while its
  words differ from the planner's (`sameClaim`: case, punctuation and spacing
  don't count). Appending "!" keeps "From your brand profile" and its flag;
  typing the planner's words back restores both. A retitle never moves it.
- Filler and profile-fill hold while the claim is unchanged.
- Overlap holds while the point still states a brief fact the earlier point
  states, or holds every word of the earlier claim. It goes when the earlier
  point is deleted or rewritten away, and comes back if that is undone.
- Facts: a fact the planner tied to an unchanged point stays while its words
  are on the slide; one only the old title stated goes with the title, so the
  "No slide says … any more" warning shows.
- Overlap reasons name the earlier slide by where it sits now.

Deleting a body point leaves an "Undo" row where the card was, named by the
slide's title rather than its number (a later move would make the number name
another card), and focus moves to it. The row and the Add button are
`role="none"`, so the outline list counts slides only. Undo puts the newest deletion back at its place with
its source and flag, newest first, and is held at the kind's maximum with a
note saying why. A re-plan clears it.

Once the outline is edited, closing would lose work a new plan can't give
back, so Escape and the X open `DiscardOutlineConfirm` instead, and a tap
beside the dialog does nothing: focus on "Keep editing", and Escape or a tap
beside the question keeps the edits. The guard follows the draft, not the
step: Back to change the image keeps the outline, and so does a failed run
that offers "Edit outline", so both the image step (choose and upload) and
that error are guarded too. It drops once a run that used the outline is
pending or done. `draft.edited` compares the points with the plan, so an edit
undone by hand, or a delete then Undo, closes at once like an untouched
outline. Escape in "Replace with my own point" still closes only that form
first.

Not guarded: a browser back (Android's back gesture included). The dialog
pushes no history entry, so back leaves the page, as it does from every other
modal in the app. The dialog's scroll box starts below the X, so no
field ever scrolls under it.

On a phone (below `sm`, or any `hover: none` screen) every control in the
step is a 44px target (UI spec 11.3): move and delete grow to 44x44 with 8px
between them, sharing the card heading's row from 360px (the source badge
wraps under the slide name) and wrapping under it below that, and the
`size="sm"` buttons grow to 44px tall. The count line sits above the count
control at every width, so the pending note never reflows the row.

Body points move up and down (hook and action stay put); the move is
announced and focus follows the moved card's button. A count chosen in the
select is only a proposal until Re-plan: the button reads "Re-plan as N
slides" and a note says the outline keeps its current count. After a 429,
"Try again" stays disabled until `Retry-After` passes (30 s when the header
is missing). While the run starts, the fields are read-only and dimmed.

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
   what the wait runs on. The server's set-job list (below) does not wait
   for the mark.
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
  site data was cleared. It trusts the mark (rule 1) when a job carries one.
  Without it, a job is a set's when the generate route wrote `sequence`
  into its input, and a frame's when the regenerate-frame route wrote
  `regenerateFrame`. A directions run has neither. The set and its kind
  come from the checkpoint (`setId`, `plan.kind`) once the plan is saved.
- `set-jobs.ts`, for jobs this browser started, with what the dialog knew
  at the start: the kind it expected, a frame job's set.

Pending frames are read again by id through `GET /api/design/generations`,
which answers at most `MAX_GENERATION_IDS` (20) ids per request. A 12-slide
deck and a 10-slide carousel building at once are 22, so the read goes out
in chunks (`chunkIds`). A chunk that fails is unknown, not unchanged: its
ids are asked for again next tick, and a set with a pending frame whose last
read failed is never shown as stopped, because that frame may have rendered
and a retry would bill it.

While the tab is hidden the watcher ticks every
`SET_WATCH_HIDDEN_INTERVAL_MS` (30s) instead of 3s. It keeps polling because
a set resumes only while something polls its job. Coming back ticks at
once, the set-job list included.

A set shows as stopped, with the on-frame retry, only when no running job
could be building it, no read of its pending frames just failed, and
either:

- the set job known to have built that set ended without delivering it, or
- its oldest pending frame is older than `STALLED_AFTER_MS`.

A running job could be building a set when it names that set, or when it
names none and started before the set's first row (allowing 30s of clock
skew). So a job started two minutes ago does not bring a set abandoned three
days ago back to "still being made".

A set job is known to have built a set when it named the set. A set job
that ended without naming a set stops nothing, and neither does a failed
frame job, which speaks only for its own frame. That set may belong to a job
this browser cannot see, and a retry would bill a frame that is already on
its way.

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

`pnpm vitest run src/components/design/sequence src/components/design/use-design-generation.sequence.test.ts src/components/design/directions "src/app/(dashboard)/design-studio" "src/app/(dashboard)/multi-frame-pages.test.tsx" src/app/api/design/set-jobs src/lib/design/sequence/open-set-jobs src/lib/design/generation-ids.test.ts`
