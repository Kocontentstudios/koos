# Outline step (KOOS-AI-002, rubric Addendum A)

A carousel or presentation is planned as an editable outline before any copy
is written or frame rendered. The user sees N points, edits them, then
generates. Types live in `contract.ts`; nothing here is a second source.

Behind `FEATURE_MULTI_FRAME` (`multiFrameEnabled()`). Off, the outline route
is a 404 and `/api/design/generate` ignores `approvedOutline` like any unknown
field, so the single-design path stays byte-for-byte as before (H6, O7).

## Flow

1. The dialog resolves a carousel or presentation brief (`sequenceKindOf`).
2. `POST /api/design/outline` plans N points (`planOutline`) and flags weak
   ones in code (`flagOutline`). No render, no job, no quota.
3. The user edits words, deletes, adds, changes N within `FRAME_BOUNDS`. The
   hook stays first and the action stays last. The generate button shows the
   quota units it spends: the number of approved points.
4. `POST /api/design/generate` with `approvedOutline`. The server re-validates
   it (`validateApprovedOutline`), checks quota for `points.length` units and
   starts the set job, which writes copy from the outline and renders.

## POST /api/design/outline

Request body, the same context fields `/api/design/generate` takes:

```ts
{
  brandId: string;              // uuid
  briefId?: string | null;      // uuid
  calendarItemId?: string | null;
  attachments?: AttachmentRef[];// at most 10, same parser as generate
  freeform?: string | null;     // at most 1000 chars
  aspectRatio?: AspectRatio | null;
  frames?: number;              // optional count; same name and parser as generate
}
```

The count is `frames`, not `frameCount`, so both routes read one field the
same way (`parseFrames`). Absent, the brief's own count is used
(`context.slides`), then `FRAME_BOUNDS[kind].fallback`. Out of bounds is
clamped by `clampFrameCount`, not refused, as generate does.

Order of checks, each before any model call:

| Check | Response |
|---|---|
| Flag off | `404 {error: "Not found"}` |
| Not signed in | `401` |
| Email unverified | `requireVerifiedEmail` response |
| Rate limit: `checkRateLimit({key: "design-outline:" + userId, ...OUTLINE_RATE_LIMIT})` (`src/lib/rate-limit.ts`, 30 an hour) | `tooManyRequests(verdict)` (429 + Retry-After) |
| Malformed body or field | `400 {error}` |
| `checkBrandAccess(userId, brandId, "manage_content")` fails | its status |
| `resolveDesignContext` throws `DesignContextError` | `404 {error}` |
| Brief is not a carousel or presentation | `400 {error: "Only a carousel or presentation has an outline."}` |

No quota is checked or spent: the outline makes no design. The rate limit is
the only spend control, because each call is a brief read plus one model
call on the best model.

Success: `200 {outline: PlannedOutline}`.

- `outline.points.length === outline.frameCount`, within `FRAME_BOUNDS[kind]`.
- `points[0].role === "hook"`, `points[N-1].role === "cta"`, every other
  `"body"` (`roleOf`).
- Ids are `"p1".."pN"` in frame order.
- `source` is `"brief"` or `"profile"`; the planner never returns `"user"`.
- `weak` is set by `flagOutline`, never by a model.

Trace: one log line `design.outline.planned` with `{kind, frames, weak:
{overlap, filler, profileFill}, modelCalls, ms}`. No brief text in the log.

## Weak flags (`flagOutline`, pure)

One flag per point, first match wins. Flags are advisory; generate is never
blocked by one.

| kind | When | Example reason |
|---|---|---|
| `overlap` | The point makes an earlier point's point (`claimsOverlap` over the brief facts, `namesFree` words ignored). `overlapsWith` is the earlier point's id. | "Says the same as point 2. Give this slide a different point." |
| `filler` | A body point whose only content is who it is for, when or where (audience, date, day, time, place facts and nothing else). | "Only says when it happens. Add what the reader gets." |
| `profile-fill` | A body point drawn from the brand profile because the brief ran out. Never on a `"user"` point. | "Taken from your brand profile, not this brief. Replace it with something about this offer." |

Only body points are flagged. The hook opens the set, so it repeats nothing;
the action's point is how to act, which a date or a place is, and swapping
it for another point would leave the set with no action. `filler` also
covers a body point that is one bare fact ("12 places") or too thin to fill
a slide (fewer than two words of its own beyond names, framing words, its
logistics and the audience). A body frame the brief and profile left no
point for gets a prompt to the owner as its words, flagged `filler`. The
eval (H13 recall) checks that every frame the judge scores 2 or lower for
repetition in lane AUTO was flagged.

## How the planner builds an outline (`planOutline`)

1. `readSequenceBrief` (`read.ts`): the same brief read `planSequence` makes.
2. `pointPool` and one arc call (`buildArcPrompt`), settled by `settleArc`:
   the outline is the settled arc, surfaced. The hook's point is the arc's
   angle; each body point is its pool point in its source's words; the
   action's point is the brief's sentence on how to act plus the facts the
   action frame carries that it leaves out (`actionPoint`).
3. Titles are the arc's, in sentence case with the brief's names kept
   (`sentenceCased`), cut at a word to `OUTLINE_LIMITS.titleChars`.
4. `flagOutline`, then the trace line.

## How a source is recomputed (`outlineSourceOf`)

A point is `"brief"` when the brief holds its words verbatim or 80% of its
content words, else `"profile"` by the same test against the profile's
statements, else `"user"`. The planner's points restate a clause or join
two, so they keep most words but not every one; an owner's sentence keeps
few. A `"user"` point is added to the ledger (`sequenceLedger(..., stated)`)
and the title sources, so copy may say it.

## Client editing rules (O3)

- Edit `title` and `point` in place; `OUTLINE_LIMITS.titleChars` (40) and
  `OUTLINE_LIMITS.pointChars` (200) are enforced in the input, not only on
  submit.
- A point the user edits or adds is sent with `source: "user"`; the server
  recomputes it anyway.
- Delete and add operate on body points only. The hook cannot be deleted or
  moved; the action cannot be deleted or moved. Added points go before the
  action. N stays within `FRAME_BOUNDS[kind]`: add is disabled at `max`,
  delete at `min`.
- Changing N re-plans through the outline route (counts against its rate
  limit); edits to existing points are lost only after the user confirms.
- A new point gets a client id matching `^[a-z0-9-]{1,40}$`, unique in the
  outline (e.g. `u-<counter>`).
- Waits: outline loading uses `<Skeleton>` rows inside `role="status"` with
  real text; empty (no points returned) and error (with retry) are distinct
  states; Generate is `<Button loading loadingText>` and its label carries
  the unit count ("Generate 5 slides · 5 units").

## POST /api/design/generate with `approvedOutline`

Adds one optional field to the existing body:

```ts
approvedOutline?: ApprovedOutline; // {kind, points: {id, role, title, point, source}[]}
```

Read only when `multiFrameEnabled()` and the request takes the set path
(image choice present, no `regenerateOf`, `sequenceKindOf(context.designType)`
non-null). Otherwise it is ignored.

On the set path:

1. `validateApprovedOutline(body.approvedOutline, {kind, briefText,
   profileStatements})`. Failure is `400 {error: "Invalid outline",
   problems: OutlineProblem[]}`. Rules:
   - `shape`: not an object of the contract's shape (zod, unknown keys
     stripped);
   - `kind`: the client's `kind` is not the brief's;
   - `count`: points outside `FRAME_BOUNDS[kind]`;
   - `hook-first`, `cta-last`, `cta-only-last`: roles are not position;
   - `id`, `id-repeat`: an id not matching `^[a-z0-9-]{1,40}$`, or repeated;
   - `empty`, `too-long`: title or point blank after trimming, or past
     `OUTLINE_LIMITS`;
   - `markup`: `<`, `>`, `{{`, `}}`, a backtick, or a control character.
     The words are drawn on a frame and sent to the copy model, so neither
     may receive markup or a template.
2. Sources are recomputed, never trusted: a point whose words the brief
   holds is `"brief"`, the profile's `"profile"`, anything else `"user"`. A
   `"user"` point counts as stated: copy may use it and the ledger does not
   flag it invented.
3. `frames` becomes `outline.points.length`. A `frames` field that
   disagrees with it is `400 {error: "frames does not match the outline"}`.
4. Quota is checked for `points.length` units (`checkDesignQuota(...,
   points.length)`), as today.
5. The validated outline rides on the job input
   (`SequenceJobInput.sequence.approvedOutline`) so a resumed slice re-plans
   from it, and reaches the planner as `PlanSequenceInput.approvedOutline`.

The planner, given an approved outline (O5):

- writes each frame from its own point only, told the other points so it
  does not repeat them;
- states nothing from a point the user deleted (the deleted points are not
  sent, and the ledger holds only the approved points plus the brief's hard
  facts);
- keeps a `"user"` point's claim as written: its copy may shorten it, never
  turn it into a different claim;
- still holds every hard brief fact on some frame (H5).

How (`plan.ts`, `outline-arc.ts`):

- The pool is the approved points (`outlinePool`); the arc call is told the
  order is settled (`buildArcPrompt` with `fixed`) and only chooses titles,
  layouts and the shared brand frame. Code then holds frame k to point k
  whatever the model assigned (`fixedArcAnswer`, `settleArc` with `fixed`):
  a point the owner approved is never swapped for a "more distinct" one.
- The action frame's claim is the approved action point.
- The copy call is told each `"user"` claim is the owner's words, to keep
  its figures and terms and only shorten, and that the owner took other
  points out, so nothing else the brief gives is said.
- No spare points exist, so no fix call can bring a removed point back.
- `ownerPointsChanged` (faults.ts) is a blocking fault when a frame loses
  any figure of the owner's point or more than half its words
  (`ownerPointKept`); the ship gate gives the point back
  (`withOwnerPoints`).

A hard brief fact a deleted point carried is still drawn on some frame,
since H5 outranks the deletion. A clause of the brief that no approved point
holds is not sent as a point but stays in the request the copy model reads;
the copy prompt tells it to leave such points out, and the eval counts any
that leak (`deletedLeaks`).

Response unchanged: `202 {jobId, frames, notice}`.
