# Product Analytics (PostHog)

PostHog is wired throughout KO OS but is a **silent no-op until keys are set**.
No events leave the app (client or server) without them.

## Setup

1. Create a PostHog project (https://us.posthog.com — or EU cloud).
2. Set these env vars (Vercel → Project → Settings → Environment Variables,
   and `.env` locally if you want local events):

```
NEXT_PUBLIC_POSTHOG_KEY=phc_xxexampleonlyxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   # or https://eu.i.posthog.com
```

Redeploy. Client pageviews and server events start flowing immediately.
It must be a redeploy, not a restart: Next inlines `NEXT_PUBLIC_*` at build time.

### The variable name is load-bearing

`NEXT_PUBLIC_POSTHOG_KEY` is the only name that works. Nothing reads any
variant of it. `posthog-provider.tsx` returns `null` when it's unset and
`posthog-server.ts` no-ops, so a misspelling produces a green build, a green
deploy, and zero events, with no error anywhere. Production ran on
`NEXT_PUBLIC_POSTHOG_PROJECT_KEY` and collected nothing until someone opened
the dashboard and found only PostHog's sample data.

`scripts/public-env-guard.mjs` now fails the build on any `NEXT_PUBLIC_*`
variable that no source file reads, naming the likely intended variable. It
runs from `scripts/check-env.mjs` as part of `pnpm build`. Escape hatch:
`SKIP_PUBLIC_ENV_CHECK=1`.

### Telling a live project from an empty one

An empty PostHog project renders sample data (`Pageview`, `Sign up`,
`Purchase`, `Invite teammate`) over an empty events table, which reads as a
working dashboard. `Purchase` and `Invite teammate` are not events this app
emits. The reliable tell is the `LIBRARY` column in Activity: real events are
stamped `web` or `posthog-node`, sample rows have nothing.

## Identity

Server events use the **DB user id** as `distinct_id`. The browser generates
its own anonymous id. Without linking the two, every person exists **twice**
and no funnel can span a client event and a server event — which is exactly
what "where do users get stuck in the first 5 minutes" needs.

`PostHogIdentify` (mounted from the dashboard and admin layouts, the first
places a session is guaranteed) calls `identifyUser(dbUser.id)`. PostHog
merges the anonymous person into the identified one, retroactively, because
the `$identify` event carries `$anon_distinct_id`. Ordering against the first
`$pageview` therefore does not matter.

Two rules the code depends on:

- **Identify is guarded on the current `distinct_id`.** posthog-js only
  performs the merge while the id is still the generated one; identifying an
  already-identified browser as someone else is refused with a console warning
  rather than re-aliased. Re-calling with the same id would also emit a
  redundant `$identify` on every navigation.
- **Logout must reset.** `LogoutForm` calls `resetIdentity()` so the next
  person on a shared browser starts anonymous instead of inheriting the
  previous user's events. `reset()` only rewrites local storage, so it
  completes before the native form POST navigates away.

No person properties are sent. The user id is all a funnel needs, and email
and name would be PII leaving for a third party without being asked for.

## Event dictionary

All server events use the **DB user id as `distinct_id`** and carry
`brand_id` plus `session_id` (a 16-char prefix of the auth-session hash —
stable for the lifetime of one login) where available.

| Event | Fired when | Extra properties |
|---|---|---|
| `$pageview` | client route change | url |
| `signed_up` | account created (email or Google) | `provider` |
| `brand_brain_completed` | brand profile first saved as completed | — |
| `chat_started` | first message of a new conversation | `mode` (strategy/design) |
| `strategy_generated` | strategy generation job succeeds | `strategy_id` |
| `calendar_generated` | calendar generation job succeeds | `calendar_id`, `items` |
| `design_brief_generated` | AI design brief job succeeds | `design_type` |
| `design_ticket_submitted` | design ticket created | `design_type`, `from_calendar_item` |
| `design_request_start_opened` | Design Tickets chooser opened | `label` (which CTA) |
| `design_request_start_selected` | a start path chosen in the chooser | `option` (`direct`/`calendar`/`campaign`) |
| `access_gate_viewed` | (client) a pending account sees `/access` | `workspaceId` |
| `access_book_call_clicked` | (client) "Book a call" clicked on `/access` | `workspaceId` |
| `workspace_access_changed` | an admin approves or revokes a workspace; `distinct_id` is the workspace **owner** | `workspaceId`, `status`, `decidedBy` (admin user id) |
| `design_directions_generated` | a FEAT-033 directions job delivers at least one direction (two on a first run, one on a regenerate) | `source` (`upload`/`ko`), `directions` (how many were delivered), `quality_faults` (delivered directions still carrying a pre-delivery fault, each counted once however many faults it carries), `regenerated`, `image_calls`, `redrafted`, `layouts_forced`, `plates_rejected` (KO plates the plate check turned down at least once, for the wrong product or for painted lettering, counted from the rejections themselves, so a rejected plate whose retry got no answer still counts), `plates_failed` (plates turned down twice, for the wrong product or scene, painted lettering, or a face beside a person the brief names), `text_led` (KO directions delivered with no image because no plate passed, laid out as text and announced to the user in the bell) |
| `design_generated` | any design job succeeds, variants or directions | `source` (entry surface), `variants`, `quality_faults`, `judge_verdicts`, `corrections_kept` |

The two `design_request_start_*` events answer whether design requests actually
want to begin from the calendar: compare the `calendar` share of
`design_request_start_selected` against `from_calendar_item` on
`design_ticket_submitted`. `opened` minus the sum of `selected` is the
chooser's abandon rate — the evidence for whether it reads as simple.

`design_directions_generated` is the middle step of the FEAT-033 funnel,
image choice → directions delivered → download. It fires server-side from
`src/lib/jobs/run-design-directions.ts` after the job's one usage row is
written, so it counts deliveries, never attempts: an unusable upload or a job
where nothing rendered fires nothing. `image_calls` is the cost outcome the
feature names: always 0 when `source = upload`, one per direction when
`source = ko`, plus one for each plate the product check rejected (it is
painted once more; `plates_rejected` counts these). The same job also fires
`design_generated`, so the quality-gate
series on that event does not read as a drop to zero when the entry points
switch from variants to directions.

The pre-existing `usage_events` DB table keeps recording independently. A
directions job writes one `design_generated` usage row (one quota unit) whose
metadata carries `renderers` (`composite:upload` per direction on an upload,
`composite:<plate adapter>` on KO imagery) and `imageCalls`, so the cost
outcome is visible in Postgres even where PostHog is not configured. The same
row records the FEAT-033 round-2 quality outcomes: `plateChecks` (per plate:
`passed`, `passed-on-retry`, `failed` for the wrong product twice,
`failed-lettering` for made-up writing twice, or `unchecked`),
`fitAsked` and `fitFixed` (copy and reasons the model was asked to rewrite
because they ran over their limit, invented a fact, read as cut off or
claimed a position, light, colour or type, and how many rewrites passed),
`copyFallbacks` (copy that still could not be drawn as written and fell back
or was left off) and `reasonsDropped` (reasons not shown because they were
not true of the delivered design). Round 3 adds `qualityFaults` as delivered
directions with a fault (as on the event), `subjectKnown` (per direction:
whether the layout knew where the product or person was), `layoutsRelaid`
(directions moved to another layout to keep copy off the subject),
`subjectFaults` (per direction: null, the cropped fault, or the covered fault
that failed it), `briefFacts` and `briefFactsDelivered` (the brief's hard
facts and how many at least one delivered direction states), `factsAdded`
(footer lines drawn in for facts a direction left out), `factsLeftOff` (facts
a direction still does not state, with the reason) and `productSources`
(where each plate's product name came from: `model`, `sibling`, `brief` or
`none`).

Round 4 measures facts per direction, because the spec promises every fact on
every direction: `briefFactsDelivered` is now the count the worst delivered
direction states, read off its drawn document, `briefFactsByDirection` lists
each direction's (null for one that failed), and `factsLeftOff` lists every
fact missing from a delivered design with its reason (the footer had no room,
the fact was longer than a line, or "not on the design as delivered"). A
direction missing a fact carries a quality fault. `subjectFaults` also records
`SUBJECT_FACE_ONLY` (only a person's face was kept clear) and the soft craft
faults (a headline that does not lead the footer, a cut-out's pale rim on a
dark ground). `claimCheck` records the claim check's reading: `available`,
`flagged`, `rewritten`, `dropped` and the `statements` it flagged.
`platesRejected` lists per plate how many times the check turned it down.

Round 5 reads the brief with a model (`src/lib/jobs/directions/brief-read.ts`)
and holds the reading to the brief in code. `briefRead` records `available`
(false when the reader could not be reached, so no facts were covered),
`offering` (`product`, `event`, `service` or null), `people` (how many real
people the brief names) and `dropped` (what the reader returned that was not
the brief's own words, not a valid phone number, or the product itself, with
the reason). `briefFacts` counts the settled facts. `plateChecks` gains
`failed-people`. `footerRepeatsDropped` counts footer items dropped because
the copy above or another item already said them. `textLed` counts KO
directions laid out as text because no plate passed, and `subjectUnknown`
counts directions with an image whose subject could not be found (the look
was unavailable, or found only a face), each also a quality fault.
`productSources` gains `read` (the reader's phrase).

## Funnels

Both live on the **Activation funnels** dashboard in PostHog, already created:

1. **Brand Brain completion rate** — `signed_up` → `brand_brain_completed`,
   ordered, 7-day conversion window. Both steps are server-side and keyed on
   the DB user id, so they share an identity regardless of `identify()`.
2. **First campaign in the same session** — `brand_brain_completed` →
   `strategy_generated` restricted to a **matching `session_id`**. This one is
   HogQL, not a funnel: a funnel step cannot require that a property match the
   previous step's value, so a plain funnel would happily count a strategy
   generated weeks later in a different session.

3. **Access gate conversion** (interim paywall, see
   `docs/runbooks/access-gate.md`) — `signed_up` → `access_book_call_clicked`
   → `workspace_access_changed` where `status = approved`. Step 2 over step 1
   says whether the page persuades; step 3 over step 2 says whether calls
   close. All three are keyed on the client's user id.

Other useful views: `chat_started` broken down by `mode`;
`design_ticket_submitted` by `from_calendar_item` (AI-chat vs calendar flow);
`calendar_generated` `items` distribution.

## Plan limits (free tier)

Free covers 1M events/month, 5K session replays/month, 1M feature-flag
requests, 1-year retention, and unlimited team members. Two limits shape how
we use it:

**One project.** Staging cannot get its own PostHog project without a paid
plan, so staging and production land in the same bucket. Every client and
server event already carries an `environment` property from
`src/lib/analytics/environment.ts`, so filter every production insight on
`environment = production` rather than paying for project separation.

**Group analytics is a paid add-on.** The `workspace` group sent from the nine
server capture sites is inert on the free plan. The code is harmless, it just
buys no per-workspace rollups until the add-on is enabled.

## Where this does not belong

Counts and rollups (users, brands, tickets by status, generations per week,
designer throughput) are deterministic and already live in Postgres, in the
`usage_events` table and the domain tables. They belong in `/admin`, built on
`src/lib/db/queries.ts`, not read off a third-party chart. PostHog earns its
place on funnels, retention, session replay, and autocapture exploration.

Do not build admin pages on live PostHog `/query` calls: PostHog explicitly
does not support that endpoint as an export mechanism and reserves the right
to rate-limit it. Embed a shared insight if a PostHog chart is wanted in-app.
