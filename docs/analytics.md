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

The pre-existing `usage_events` DB table keeps recording independently.

## Funnels to create in PostHog

1. **Brand Brain completion rate** — `signed_up` → `brand_brain_completed`
   (Insights → Funnel, order sequential, conversion window e.g. 7 days).
   Answers: *% of users completing their Brand Brain.*
2. **First campaign in the same session** — `brand_brain_completed` →
   `strategy_generated`, with a funnel **breakdown/filter on matching
   `session_id`** (add "session_id equals" as a correlation property or use
   HogQL: `funnel where step1.properties.session_id = step2.properties.session_id`).
   Answers: *% of Brand Brain completers who generate a first campaign in the
   same session.*

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
