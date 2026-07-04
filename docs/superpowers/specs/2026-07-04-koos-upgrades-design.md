# KO OS Upgrades — Design Spec

**Date:** 2026-07-04
**Status:** Confirmed — decisions locked via user Q&A 2026-07-04
**Branch:** `feat/upgrades`

> This spec covers six independent work items requested together. Each is scoped
> to be shippable on its own. The decisions below are the user's confirmed choices.

## Decisions (confirmed)

| Question | Choice | Rationale |
|----------|--------|-----------|
| Sequencing | Quick wins first, then big items, one design/approval per batch | Bugfixes #1/#3 are low-risk and independent; big items get their own review |
| Bedrock (#4) | **Add** as another provider (not a replacement); **env-driven, nothing hardcoded** — user supplies region/keys/model id later | Matches the existing provider-agnostic design; lowest risk |
| Chat persistence (#5) | **Postgres** — wire the already-defined `chat_conversations`/`chat_messages` tables | Tables + helpers already exist unused; cross-device; no new infra |
| Email scope (#6) | Tiers A + B + C (skip low-value D) **plus the landing "Contact us" form** | Notification fan-out, ticket lifecycle, auth emails, and lead capture |
| Suggest button (#2) | **Both** Suggest + Enhance, on the long-text fields (overview, target audience, offer, values, differentiators) | Highest-value fields; one control does fill-empty and improve-existing |
| Password reset (#7) | **Build now**, as its own batch (largest email sub-piece) | Net-new flow: routes + token table + email |
| Brand duplicates (#1) | **Fix the bug and dedupe existing** orphan rows | Stops new dupes and cleans up rows the bug already created |

---

## Item 1 — Edit Brand should pre-fill and update (not start blank / duplicate)

### Problem
"Edit Brand" on `src/app/(dashboard)/brand/page.tsx` (lines 273–278) is a plain
`<Link href="/brand/create">` with no brand id. The create form
(`src/app/(dashboard)/brand/create/create-brand-form.tsx`) initializes from
`DEFAULT_STATE` and only hydrates from `localStorage` — it never reads the saved
DB brand. So editing opens a blank form.

Worse, on save `saveBrandProfile` (`src/app/(dashboard)/brand/actions.ts:56–60`)
branches on `onboardingStatus`:

```ts
const existing = await getActiveBrandForUser(dbUser.id);
const brand =
  existing && existing.onboardingStatus !== "completed"
    ? await updateBrand(existing.id, profile)
    : await createBrand({ userId: dbUser.id, ...profile });
```

A completed brand has `onboardingStatus === "completed"`, so editing takes the
`createBrand` branch and **inserts a duplicate row**. `getActiveBrandForUser`
returns the most-recently-updated row, so the newest wins but orphans accumulate.

Additional gap: `updateBrand` (`src/lib/db/queries/index.ts:147–176`) has a `Pick`
allow-list that omits ~13 newer columns (`values`, `wordsLove`, `wordsAvoid`,
`hasLogo`, `brandStyle`, `competitors`, `competitorStrengths`, `differentiators`,
`platforms`, `primaryPlatform`, `postingFrequency`, `additionalNotes`,
`helpfulLinks`). Even when the update branch runs, those fields are silently dropped.

### Design
1. **Pre-fill:** `brand/create/page.tsx` should fetch the active brand
   (`getActiveBrandForUser`) and pass it as an `initialBrand` prop to
   `CreateBrandForm`. The form's state initializer uses `initialBrand` (mapped to
   `CreateBrandState`) when present, falling back to `localStorage`/`DEFAULT_STATE`
   for a genuinely new brand.
   - localStorage precedence: an existing saved brand should win over a stale
     draft. When `initialBrand` exists we seed from it and ignore the draft
     (optionally clear `ko-os:brand-create`).
2. **Update instead of duplicate:** change the save branch so an `existing` brand
   is always updated regardless of `onboardingStatus`. New brand is created only
   when `existing` is null.
   ```ts
   const brand = existing
     ? await updateBrand(existing.id, profile)
     : await createBrand({ userId: dbUser.id, ...profile });
   ```
3. **Extend `updateBrand`'s allow-list** to cover all columns present in `profile`
   so edits persist every field. (Alternatively, drop the `Pick` and accept the
   full profile type — decide during implementation; extending the `Pick` is
   safer/more explicit.)
4. **Dedupe existing orphans (confirmed in scope):** a one-off migration/script
   that, per user, keeps the most-recently-updated brand row and removes (or
   reassigns dependents from) older duplicate rows. Must first check whether any
   child records (`strategies`, `calendars`, etc.) reference the older brand ids
   before deleting — reassign or block deletion accordingly. Report counts before
   destructive action.

### Files touched
- `src/app/(dashboard)/brand/create/page.tsx` (fetch + pass `initialBrand`)
- `src/app/(dashboard)/brand/create/create-brand-form.tsx` (accept prop, seed state)
- `src/app/(dashboard)/brand/actions.ts` (update-when-existing branch)
- `src/lib/db/queries/index.ts` (`updateBrand` column allow-list)

### Testing
- Unit: `saveBrandProfile` updates the same row id for a completed brand (no new
  row); all fields round-trip through `updateBrand`.
- Manual: edit a completed brand, change several fields across steps, save, reload
  `/brand` — values persist, brand count unchanged.

---

## Item 2 — "Suggest / enhance" button on brand fields

### Design
Add a small AI helper next to enhance-able brand fields (e.g. `overview`,
`targetAudience`, `offer`, `values`, `differentiators`) that either **suggests** a
value from the rest of the brand context or **enhances** the current draft text.

- **New AI feature key:** extend `AiFeature` in
  `src/lib/ai/provider-config.ts` from `"chat" | "strategy"` to include
  `"brand"`, so it gets its own optional env overrides
  (`AI_BRAND_PROVIDER` / `AI_BRAND_MODEL`) and inherits the global provider
  (which will include Bedrock after #4).
- **New route:** `src/app/api/brand/suggest/route.ts` — auth-gated `POST`
  taking `{ field, currentValue, brandContext }`, building a focused prompt, and
  returning a single suggested string. Use `generateText` (or `generateObject`
  with a `{ suggestion: string }` schema for robustness) with `getModel("brand")`.
  Mirror the auth + `recordUsageEvent` pattern from
  `src/app/api/strategy/generate/route.ts`.
- **New prompt builder:** `src/lib/ai/prompts/brand.ts` — `buildBrandFieldPrompt(field, currentValue, brandContext)`
  with per-field guidance (tone, length limits) so suggestions fit each field.
- **UI:** a reusable `<SuggestButton field=... onApply=... />` rendered inside the
  step components (`step-*.tsx`) beside the target inputs. Shows a spinner while
  loading; on success applies the returned text to the field (user can edit before
  saving). Meter usage via existing `recordUsageEvent` / `usageKindEnum`.

**Dependency:** value from #4 — this feature works with the current provider, but
if Bedrock is the chosen backend we want #4 landed (or at least the `bedrock` case
present) first so `getModel("brand")` resolves to the intended model.

### Files touched
- `src/lib/ai/provider-config.ts` (add `"brand"` feature)
- `src/lib/ai/prompts/brand.ts` (new)
- `src/app/api/brand/suggest/route.ts` (new)
- `src/app/(dashboard)/brand/create/*` step components + a new `SuggestButton`
- `src/lib/db/schema.ts` — add a `usageKindEnum` value for brand suggestions if
  metered separately

### Testing
- Route returns a non-empty suggestion for a valid field + rejects unknown fields.
- Prompt builder unit test for field-specific instructions.
- Manual: click Suggest on an empty field → sensible draft; click Enhance on
  existing text → improved version; Apply populates the input.

---

## Item 3 — KO OS wordmark on auth pages links to the landing page

### Problem
The **top-bar** brand mark in `src/app/(auth)/layout.tsx` already links to `/`.
But the **in-card wordmark** — a static `<div>` — does not link:
- `src/app/(auth)/login/page.tsx:59–72`
- `src/app/(auth)/register/page.tsx:77–90`

### Design
Wrap the in-card wordmark in a `next/link` to `/` (the landing page,
`src/app/page.tsx`), preserving current styling and adding
`aria-label="KO OS — back to home"`. Trivial, no data flow.

### Files touched
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/register/page.tsx`

### Testing
- Manual: click the KO OS wordmark on `/login` and `/register` → lands on `/`.

---

## Item 4 — Add Amazon Bedrock as an AI provider

### Design
The app already resolves models through a provider-agnostic switch
(`src/lib/ai/provider.ts` `getModel()` + `resolveProviderConfig`). Bedrock is
added as one more case — chat/strategy/calendar (and #2 brand) inherit it.

1. **Dependency:** `npm i @ai-sdk/amazon-bedrock`.
2. **Config (`provider-config.ts`):**
   - Add `"bedrock"` to `AiProvider`, `AI_PROVIDERS`.
   - `DEFAULT_MODELS.bedrock` = a Bedrock model id (recommend an Anthropic Claude
     model on Bedrock, e.g. `anthropic.claude-sonnet-4-5-20250929-v1:0` — exact id
     TBD against the account's enabled models / inference profiles).
   - `PROVIDER_KEY_ENV.bedrock` — Bedrock uses AWS credentials rather than a single
     API key; handle its env requirements in `provider.ts` (see below) rather than
     a single key var.
3. **Client (`provider.ts`):** add
   ```ts
   case "bedrock":
     return createAmazonBedrock({
       region: requireEnv("AWS_REGION"),
       accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
       secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
       // sessionToken: process.env.AWS_SESSION_TOKEN, // if using temp creds
     })(model);
   ```
4. **Preflight/env:** update `scripts/check-env.mjs` and `.env.example` with the
   new provider + AWS vars.

**Confirmed:** nothing hardcoded. The `bedrock` case reads region/keys/model from
env only; `DEFAULT_MODELS.bedrock` may hold a placeholder default but the real
model id + AWS credentials are supplied by the user in the deployment env later.
No default AWS region is baked in.

### Credentials the user must provide
To use Bedrock the deployment (Vercel) env needs:
- `AWS_REGION` — e.g. `us-east-1` (a region where the target model is enabled)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- (optional) `AWS_SESSION_TOKEN` if using temporary STS credentials
- `AI_PROVIDER=bedrock` (and/or per-feature `AI_CHAT_PROVIDER=bedrock`, etc.)
- `AI_MODEL=<bedrock model id>` (or per-feature model vars)

Plus, in the AWS account: **Bedrock model access must be granted** for the chosen
model in that region (Bedrock console → Model access), and the IAM user/role needs
`bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` permissions. Some
newer Claude models on Bedrock require an **inference profile** id rather than the
raw model id — we'll confirm the exact string against the account.

### Files touched
- `package.json` (dependency)
- `src/lib/ai/provider-config.ts`
- `src/lib/ai/provider.ts`
- `scripts/check-env.mjs`, `.env.example`

### Testing
- Unit: `resolveProviderConfig` returns `bedrock` + default model when
  `AI_PROVIDER=bedrock`.
- Integration (manual, needs creds): set env, run a chat turn and a strategy
  generation, confirm both stream/return from Bedrock.

---

## Item 5 — Persist chat before a strategy is created (Postgres)

### Problem
Chat lives only in `useChat` in-memory state
(`src/app/(dashboard)/strategy/strategy-client.tsx`). `/api/chat/route.ts`
streams but never writes. The schema already defines `chat_conversations` and
`chat_messages` (`src/lib/db/schema.ts:199–220`) plus helpers
(`createConversation`, `createMessage`, `getConversationMessages`,
`getRecentConversations` — `queries/index.ts:237–265`), all **unused**.
`strategies.conversationId` exists but is never set. Reload = chat lost.

### Design (wire the existing scaffolding)
1. **Conversation lifecycle:** when a user starts chatting on `/strategy`, ensure
   a `chat_conversations` row exists for their brand (create lazily on first
   message; keep the id client-side, e.g. in the `useChat` transport body /
   component state).
2. **Persist each message:** in `/api/chat/route.ts`, before/while streaming,
   persist the incoming user message and the completed assistant message via
   `createMessage` (use `streamText`'s `onFinish` to store the final assistant
   text). Pass `conversationId` in the request body from the client.
3. **Rehydrate on load:** `strategy` page loads the most recent (or selected)
   conversation's messages via `getConversationMessages` and seeds `useChat`'s
   `initialMessages`, so a refresh restores the real conversation — replacing the
   current single synthetic "recap" message behavior in `handleSelectStrategy`.
4. **Link chat → strategy:** when `handleBuildStrategy` calls
   `/api/strategy/generate`, pass the `conversationId`; `createStrategy` stores it
   in `strategies.conversationId` so a strategy is traceable to its origin chat.

**Decision — storage backend:** Postgres (already provisioned; tables exist).
Rejected alternatives: localStorage (per-device, leaves DB dead), Redis (new infra,
no benefit over the existing Postgres).

### Files touched
- `src/app/api/chat/route.ts` (persist on receive + `onFinish`)
- `src/app/(dashboard)/strategy/strategy-client.tsx` (track `conversationId`,
  seed `initialMessages`)
- `src/app/(dashboard)/strategy/actions.ts` (load conversation messages)
- `src/app/api/strategy/generate/route.ts` + `createStrategy` call (pass
  `conversationId`)
- Possibly `queries/index.ts` if helper signatures need small extensions

### Testing
- Unit: posting a chat turn writes a user + assistant `chat_messages` row under a
  conversation; `getConversationMessages` returns them in order.
- Manual: chat a few turns, refresh the page → conversation restored; build a
  strategy → `strategies.conversationId` set.

---

## Item 6 — Map and wire all outgoing emails

### Current state
Infra: Nodemailer over Zoho (`src/lib/email.ts` → `sendMail`). Templates in
`src/lib/email-templates.ts`. The only wrapper is `src/lib/design/notify.ts`, used
by exactly two events:
- Design request submitted → `sendDesignRequestEmails` (`api/design-tickets/route.ts:91`)
- Deliverables uploaded → `sendDesignDeliveryEmail` (`api/admin/tickets/[id]/deliverables/route.ts:118`)

### The full email map (audit output)

| # | Event | Location | Recipient | Tier |
|---|-------|----------|-----------|------|
| ✅ | Design request submitted | `api/design-tickets/route.ts:91` | team + requester | live |
| ✅ | Deliverables uploaded | `api/admin/tickets/[id]/deliverables/route.ts:118` | requester | live |
| 1 | Admin changes ticket status | `api/admin/tickets/[id]/manage/route.ts:89–108` (has in-app notif) | requester | A |
| 2 | Designer posts progress update | `api/admin/tickets/[id]/updates/route.ts` (has in-app notif) | requester | A |
| 3 | Designer status change (claim/in-progress) | `api/admin/tickets/[id]/status/route.ts:49` | requester | B |
| 4 | Customer approves / requests revision | `api/design-tickets/[id]/review/route.ts:37,46` | team | B |
| 5 | Admin overrides user role | `api/admin/users/[id]/role/route.ts:38` | affected user | B |
| 6 | Welcome on signup | `(auth)/actions.ts:42` + `auth/callback/route.ts` | new user | C |
| 7 | Password reset | *no flow exists* | user | C |
| 6b | **Landing "Contact us" form** | `components/marketing/landing-page.tsx` (currently fake — discards input) | support inbox (`hello@kocontentstudios.com`) | C |
| 8 | Strategy generation complete | `api/strategy/generate/route.ts:67` | user | D (skip) |
| 9 | Deliverable deletion | `api/design-tickets/[id]/deliverables/[deliverableId]/route.ts` | requester | D (skip) |

### Design (Tiers A + B + C)
- **Reusable notify helpers:** extend the pattern in `src/lib/design/notify.ts`
  (or a new `src/lib/notify/*`) so each event has a small, error-swallowing
  `sendXxxEmail()` wrapper — mail failure must never fail the underlying request
  (matches existing behavior).
- **New templates in `src/lib/email-templates.ts`:** ticket status change, progress
  update, designer-claimed, customer-action-to-team, role-change, welcome, and
  password-reset. Reuse the existing `shell`/`row`/`detailsTable`/`escapeHtml`
  helpers for visual consistency.
- **Tier A (cheapest):** at the two sites that already call `createNotification`,
  also call the matching email wrapper.
- **Tier B:** add wrappers at the three lifecycle sites.
- **Contact form (confirmed in scope):** the landing "Get in touch" form
  (`components/marketing/landing-page.tsx`) currently fakes success and discards
  the input. Add a real submission path: a `/api/contact` route (or server action)
  that validates name/email/message (reuse `src/lib/validation/email.ts`) and
  `sendMail`s to the support inbox with `replyTo` = the submitter, then have
  `handleContactSubmit` await it and show real success/error. Route the support
  address through config (env `CONTACT_EMAIL` / DB setting) instead of the current
  hardcoded `hello@kocontentstudios.com` in landing + legal pages. Consider basic
  anti-abuse (honeypot or rate-limit) since this endpoint is public/unauthenticated.
- **Tier C — auth:**
  - Welcome email on first signup (email/password in `(auth)/actions.ts:42` and
    Google first-time in `auth/callback/route.ts`).
  - **Password reset is net-new:** requires a `/forgot-password` + `/reset-password`
    route pair, a `password_reset_tokens` table (or signed token), a request action
    that emails a reset link, and a reset action that validates the token and
    updates the password. This is the largest sub-piece of #6 and may warrant its
    own mini-spec.

### Files touched
- `src/lib/email-templates.ts` (new templates + tests in `email-templates.test.ts`)
- `src/lib/design/notify.ts` or new `src/lib/notify/` wrappers
- The event route files listed in the table (Tiers A/B)
- Auth: `(auth)/actions.ts`, `auth/callback/route.ts`, new forgot/reset routes +
  pages, new token table + migration (Tier C password reset)

### Testing
- Template unit tests (subject/html contain expected fields; `escapeHtml` applied).
- Route tests assert the wrapper is invoked on each event and that a mail failure
  does not fail the request.
- Password reset: token issued, single-use, expiry enforced; password actually
  changes; invalid/expired token rejected.

---

## Build order (confirmed)
1. **Batch 1 (quick wins):** #1 edit-brand fix + dedupe, #3 KO OS link.
2. **Batch 2:** #5 chat persistence (Postgres wiring).
3. **Batch 3:** #4 Bedrock provider (env-driven; creds supplied at deploy).
4. **Batch 4:** #2 brand suggest/enhance button (after #4).
5. **Batch 5:** #6 emails — Tier A → B → contact form → C welcome, then
   **password reset as its own sub-batch** (routes + token table + email).

Each batch: short plan → implement → tests → review before the next.

## Resolved / remaining inputs
- **Resolved:** sequencing (quick wins first), Bedrock additive + env-driven,
  Postgres chat, email A+B+C + contact form, Suggest+Enhance on the 5 text fields,
  password reset built now as its own batch, brand fix + dedupe.
- **Still needed from user (not blocking early batches):** AWS region, Bedrock
  credentials, and the exact Bedrock model id / inference-profile string — supplied
  in the deployment env when Batch 3 ships. The support inbox address for the
  contact form (default: existing `hello@kocontentstudios.com`, made configurable).
