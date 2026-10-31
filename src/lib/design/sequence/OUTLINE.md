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
- `title` is about its own point (`outlineTitles`): the arc's title follows
  the point it was written for when `settleArc` moves points, and a title
  that shares no word or figure with its point is remade from the point's
  opening words (`pointTitle`).
- `sig` is the server's HMAC over `kind`, the brief, `source` and `point`
  (`outline-sign.ts`). The client sends it back unchanged with an unedited
  point, and drops it (or lets it go stale) when the user edits the words.

Trace: one log line `design.outline.planned` with `{kind, frames, weak:
{overlap, filler, profileFill}, modelCalls, ms}`. No brief text in the log.

## Weak flags (`flagOutline`, pure)

One flag per point, first match wins. Flags are advisory; generate is never
blocked by one. A flag is advice only if most points do not carry one, so
the profile source alone is not a flag: the UI already shows `source`.

| kind | When | Example reason |
|---|---|---|
| `overlap` | The point makes an earlier point's point (`claimsOverlap` over the brief facts, `namesFree` words ignored), or the hook's (`echoesHook`: it gives one of the hook's figures, or shares two of its words beyond the names). `overlapsWith` is the earlier point's id. | "Says the same as point 2. Give this slide a different point." / "The first slide already says this. Give this slide a point the first slide does not make." |
| `filler` | A body point whose only content is who it is for, when or where (audience, date, day, time, place facts and nothing else); a point of three words or fewer ("Six Saturdays", "₦150 per kWh", "Ngozi Ade"); or the prompt left where nothing was found (`EMPTY_POINT`, checked before overlap and never named as the earlier point another overlaps). A bare figure the reader weighs (a quantity, offer, condition or age with a number: "Only 12 places", "Ready in 3 days") is not filler. | "Only says when it happens. Add what the reader gets." |
| `profile-fill` | A body point drawn from the profile because the brief ran out that states what the brand is, sells or believes (`genericProfile`: overview, offer, values). Never on a `"user"` point, never on one drawn from `differentiators`: a concrete profile fact ("Beans from the Mambilla Plateau") shows its `source` and is not flagged. | "Taken from your brand profile because the brief ran out: it says what the brand is or believes, which the first slide already says. Replace it with a fact about this offer." |

Only body points are flagged, plus a hook that only names the offer (no
figure, under three words of its own): "Names the offer but gives no reason
to swipe." The action's point is how to act, which a date or a place is,
and swapping it for another point would leave the set with no action.

The eval prints flag recall (every frame the judge scores 2 or lower for
repetition in lane AUTO should be flagged; at least 0.8), the flag rate
(flagged body points of all body points), precision at the same bar as
recall (flagged body points the judge scored 2 or lower) and the same
share among unflagged body points, so a flag that discriminates shows
precision well above it.

Calibration (274 judged lane AUTO body points from four earlier runs): concrete
profile points scored 2 or lower 8 of 79 times (10%), generic ones 25 of 88
(28%), bare scarcity or turnaround figures 0 of 12. Unflagging the first and
the last keeps recall at 53 of 61 (0.87) and drops the flag rate from 93%
to about 60%.

## How the planner builds an outline (`planOutline`)

1. `readSequenceBrief` (`read.ts`): the same brief read `planSequence` makes.
   The read offering is widened over an acronym or a mid-sentence name the
   brief writes in front of it (`widenedOffering`: "maths crash course" in
   "WAEC maths crash course"), so the hook names the whole offering.
2. `pointPool` and one arc call (`buildArcPrompt`), settled by `settleArc`:
   the outline is the settled arc, surfaced. The hook's point is the arc's
   angle; each body point is its pool point in its source's words. A brief
   fact that is a point on its own is offered in the sentence the brief
   gives it in (`factPoints`: "Customers pay ₦150 per kWh against ₦420 for
   diesel" is one point, not two bare prices); a sentence that is the
   action gives no point, so "Ngozi Ade" from "Contact Ngozi Ade" is not a
   slide. The action's point is the brief's sentence on how to act plus the
   facts the action frame carries that it leaves out, each in the brief's
   own short sentence where it has one ("We are raising $750,000."), else
   the brief's words up to the figure when they are little more than it
   ("We are raising $1.2 million" of a longer sentence; `leadUpTo`), else
   bare (`actionPoint`).
2a. Every hard brief fact is on a point (`withEveryFactPlaced`, H5). A
   claim fact no point states (a count, an offer, a condition) takes the
   emptiest body slot in the brief's own sentence (an empty slide first,
   then one the profile filled; a brief point is never displaced). A
   when, where, contact or price the reader pays (`atAction`; a revenue
   figure is a claim, not a price beside the button), and a claim fact
   with no slot left, joins the action's point: on a slide of its own it would be filler the
   owner is told to replace, and replacing it would take the fact off the
   set. Only then is
   a slide left to the owner (`EMPTY_POINT`), with source `"user"`: it is
   theirs to write, never "brief".
2b. No point repeats another (`withOverlapsSwapped`). A body point
   `flagOutline` would flag `overlap` is given the next spare pool point
   (one the arc left unused that overlaps no point) in its place, unless
   it alone states a brief fact. With no distinct spare left, the slide is
   handed to the owner to write or delete (`EMPTY_POINT`, source `"user"`,
   flagged filler) rather than one claim twice; only a point that alone
   states a brief fact keeps its overlap flag. The trace counts them
   (`overlapsSwapped`). Overlap is read through `concepts.ts`: "for free",
   "at no cost", "pay nothing" and "fully sponsored" are one concept, so
   "At no cost to families" overlaps a hook on learning "for free"
   (`echoesHook`), while "free of sulphates" or "sugar-free" is never the
   price.
2c. No point stops mid-phrase (`stopsMidPhrase`, `phrase.ts`): a pool
   clause or the part of a sentence beside the ask that ends on an
   article, a preposition or a verb waiting for its object ("Weekday
   bookings get a", once its offer went to the action) is never offered,
   and any point that still does is flagged filler: "Stops mid-sentence,
   so the slide would too."
3. Titles follow their points (`outlineTitles`). The arc's title is kept
   when it is 4 words or fewer and about its point (`titleFits`); else
   `pointTitle` takes a whole phrase of 2 to 4 of the point's own words: a
   run in its first clause (a comma inside "1,200" does not end it) that
   starts and ends on a word of its own, with a joining word or the
   clause's edge on either side, the brand's names that open it left out,
   "is" and "are" dropped, the run on the clause's subject first ("Coach on
   the floor", "Cracked iPhone screen", "Revenue grew 3x"). An empty slide
   is titled "Add a point". Titles are in sentence case with the brief's
   names kept (`sentenceCased`: camel-case names like "FreshFold",
   "WhatsApp" and "iPhone", "M-Pesa", a person a sentence opens on, and
   the first word of a name used alone, "Join Ironclad today" for
   "Ironclad Gym"), every name spelt as its sources spell it ("Visit
   crown & coil" is "Visit Crown & Coil", "wuse 2" is "Wuse 2";
   `nameSpellings`), and cut at a whole word to
   `OUTLINE_LIMITS.titleChars` with no ellipsis (`titleWithin`). A clause
   of 5 words or fewer whose best run is 2 words is titled whole ("Keep
   riders on the road", never "Keep riders").
   The offering is refused when the read's phrase ends on a pronoun
   ("replaces it"), and is never widened over half of the brand's name
   ("Hub" of "Fixit Hub"; `settledOffering`).
4. Each point is signed (`signPoint`), then `flagOutline`, then the trace
   line.

## How a source is recomputed (`validateApprovedOutline`)

1. A point whose `sig` is still the server's signature over its words keeps
   the source it was planned with (`signedSource`). The planner's own words,
   a hook angle above all, are never the owner's: before signing, a client
   that sent the outline back untouched turned "hemmed to your exact length"
   into an owner fact the copy was then forced to keep.
2. Any other point is `"brief"` when the brief gives its words as they are
   (case and punctuation aside), else `"profile"` when one profile
   statement does (`outlineSourceOf`), else `"user"`. There is no share of
   words: an owner who corrects one figure ("open 5am to 11pm" over the
   brief's "5am to 10pm") has written their own point, and a share test
   read it as the brief's and wrote the brief's hours back.
3. The signature covers the role too, so a planned body point moved into
   the hook's slot is read again.

A `"user"` point is added to the ledger (`sequenceLedger(..., stated)`) and
the title sources, so copy may say it. The key is `OUTLINE_SIGNING_SECRET`,
else one derived from `DATABASE_URL` (shared by every instance), else a
per-process key for tests and scripts. A signature binds the brief, so one
from another brief does not verify.

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
   - `markup`: `<`, `>`, `{{`, `}}`, a backtick, or a control character,
     after NFKC folding, so fullwidth `＜script＞` is refused too. The words
     are drawn on a frame and sent to the copy model, so neither may
     receive markup or a template.
   - `link`: a link or domain the brief and profile never give
     (`unsourcedLinks`): "Visit http://evil.example" is refused, the
     brief's own `crownandcoil.ng` is not; the owner adds a new link to
     the brief first.
   - `injection`: words written to the model, not the reader ("ignore all
     earlier instructions", "system prompt", "you are now", "write X on
     every slide"). Read as a class, not a list: a sentence that names the
     set's own parts (slides, frames, headlines, footers, titles, buttons,
     "everywhere", "anywhere") and also says what to write there (say,
     write, copy, put, print, mention, repeat, replace); words addressed to
     the writer ("Note to the copywriter"); an order to drop what the
     writer was given ("Disregard the brief."); a directive label
     ("Override:"). Narrow on purpose: "Ignore the queue, book online",
     "Every frame includes a free fitting" and "Each slide of your ride
     matters" are copy.
2. Sources are recomputed, never trusted: a signed, unedited point keeps
   its planned source; otherwise a point whose words the brief holds is
   `"brief"`, the profile's `"profile"`, anything else `"user"`. A `"user"`
   point counts as stated: copy may use it and the ledger does not flag it
   invented.
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
- states nothing from a point the user deleted or replaced (see "Removed
  points" below);
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

### Removed points (O5)

Not sending a point is not enough: the copy model still reads the brand
profile and the whole brief. The planner builds the pool it would have
offered (`pointPool`) and takes every pool point no approved point makes as
removed (`removedPoints`). Then:

- every prompt reads the profile without the removed clauses
  (`profileWithout`), so a deleted differentiator is never in front of the
  writer;
- the copy prompt names the removed points the brief still holds
  (`removedFromBrief`); a profile point is not named, since naming it would
  put it back;
- `removedFaults` is a blocking fault on any frame whose headline or a
  subheadline sentence makes a removed point and not its own claim;
- the ship gate cuts such a sentence, or sets such a headline to the
  frame's claim (`withoutRemoved`).

When the owner edits the outline (a `"user"` point, or a planned id
missing: ids are planned in order and the hook and action cannot go),
`releasedFacts` names the brief facts no approved point states that a
deleted or replaced point carried, or whose figure the owner's words
correct. H5 asks every brief fact on some frame and O5 says nothing removed
appears; the approved outline is the owner's decision, so O5 wins:

- a released fact is not asked of any frame (`factsUncovered`,
  `validateSequence`, the gate's `keepsCoverage`) and is never drawn by
  code (`withFactsDrawn`), nor is a drawn line put where it would make a
  removed point;
- a frame that states a released fact is a blocking fault
  (`releasedFaults`), and the gate drops it from a footer, a subheadline
  or a headline (`withoutRemoved`);
- `removedFaults` reads every line a reader sees (`linesOf`): headline,
  subheadline sentences, footer items and the button;
- the result lists `factsReleased`, so the outline UI can warn which hard
  facts a deletion leaves unstated before Generate.

The rule when H5 and O5 meet on one fact: a brief fact stated only by a
point the owner deleted or replaced is released, and no frame says it; a
fact any kept point still states stays required, and the frame that
point is on may say it. A removed point's words count against every line
except a when, where or contact still required (`removalFree`) and the
words of the frame's own point; a price, a product or a claim the owner
took out is never free. So clinic's "One 60-minute session", deleted as
a point and stated by no other, is released and leaks if any footer
gives it; left in the outline, it is required and drawn.

An outline approved untouched releases nothing and removes nothing: the
planner's unused pool points are spare, not taken out, and H5 holds in
full. The eval counts replaced points that leak
(lane APPROVED, `deletedLeaks`) and runs a deletion probe on every outline:
the first body point deleted, the rest sent back signed, and any frame that
still makes it counted (`withPointDeleted`, "deleted points said anyway").

### Two drafts and an editor

The copy call is made twice at once: the first writer and a second one
told to write its own draft from scratch (`SECOND_DRAFT`). An editor call
(`buildPickPrompt`) reads both from frame 2 on and every opening written
for frame 1, and picks a draft and an opening. Code keeps the pick
(`settlePick`) unless the picked draft carries more than one blocking fault
more after frame 1 than the other, or the picked opening scores a coverage
fault worse than the best one. A failed second draft or pick leaves the
first draft and its fewest-fault opening.

Response unchanged: `202 {jobId, frames, notice}`.

### No blocking fault ships

After the gate, coverage, titles and casing, `lastResort`
(`last-resort.ts`) rewrites in code every frame still carrying a blocking
fault (`blockingFaults`: weight `MAJOR` or more). For each fault it tries
the frames that could clear it (`framesToTry`): the faulted frame and any
frame the fault names ("the hook already says what frame 4 is for"), a
later frame before the hook, since the hook earned the swipe. Each frame's
versions, in order:

- the copy the writers already gave it (`alternates`: the other draft's
  version of the frame, and for the hook every opening both writers
  offered), at no extra call;
- its own point (the approved words) split into a headline and a sentence
  (a subjectless second half given "It" or "They"); on the hook, the
  point's reason over its name ("Made in small batches in Ibadan" over
  "Ata Kitchen's scotch bonnet sauce.");
- the point under its headline, the frame's title over its point, the
  point as the headline;
- a sentence the brief, the profile or the owner gives on the point, under
  the headline or under the point, never one that makes another frame's
  point;
- a hook's or action's subheadline cut, or one line (a subheadline
  sentence, a footer item) cut;
- a writer's subheadline cut to its first clause (`clauseCuts`), where
  its tail added what no source gives;
- an invented single word ("only", "free") taken out of the line that
  says it (`inventedWordCuts`); a figure is never cut word by word;
- every headline above paired with every subheadline above
  (`crossVersions`): one writer's headline over another's sentence is
  often the clean frame neither wrote whole.

A version is kept only where the whole set ends with fewer blocking
faults, titles and casing settled again after each. A fault between two
frames that no single rewrite clears is tried on both at once
(`PAIR_VERSIONS` of each). With nothing blocking left to clear on a
frame, its minor faults (a headline past its word budget, a price read
wider than the brief prices it) are cleared the same way, where that adds
no blocking fault. Then
`withBreachesCut` cuts any line that still breaches (`CopyFault.breach`: a
claim no source gives, a point or fact the owner took out, the owner's
point turned into another claim), kept only where no brief fact or
offering is newly left off.

What still blocks goes back to the fix call once, named, and through the
gate, the facts, the casing and the last resort again. A set still
carrying a blocking fault after that is planned afresh, up to
`SHIP_ATTEMPTS` (3) times, the brief read once; the set with the fewest
is kept. With any left, `planSequence` throws `SequenceShipRefusedError`
(`onBlocked: "refuse"`, the default, which production uses), and the job
turns it into a `SequencePlanError` (rule `blocking-fault`) before any
frame is rendered or billed, whose message names the slides and the
outline points to change ("We couldn't write slide 2 of this carousel
without repeating another slide or going beyond your brief. Change point
2 in the outline, or try again."). Each
fresh plan logs `design.sequence.replanned`. The eval passes
`onBlocked: "report"` so it can still score the set, and prints what is
left as "blocking faults left (production refuses these sets before any
render)"; the panel counts it against the zero-fault gate.

The hook never ships as a headline alone, and never as a label. Both
are blocking (`hookFaults`): a hook with an empty subheadline, and a
headline that past the offering's and brand's names, the places and the
schedule (weekdays, months, the brief's dates and times) keeps at most
one word of its own, with no figure, no question and no "you", "your",
"we" or "our" (`isLabelHeadline`: "Scotch bonnet pepper sauce,
restocked", "FreshFold laundry pickup: Monday to Wednesday"). A rule on
what is left, not a list of announcement words. The gate never empties
the hook's subheadline to clear another fault: in its place goes its
stake (`hookStake`), the brief's or profile's own sentence that names
what the hook leaves out and spends no later frame's point, else the
hook's angle, else the names, each kept only where the set ends with
fewer blocking faults than the hook with nothing under it.

Two blocking faults name broken copy the gate used to pass: a line cut on a verb or preposition
still waiting for its object ("Ironclad Gym's monthly membership
includes"), and a subheadline that gives only names ("FreshFold.", "Fixit
Hub.").
