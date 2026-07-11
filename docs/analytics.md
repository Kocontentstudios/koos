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
