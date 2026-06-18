# KO OS MVP — Implementation Design Spec

**Date:** 2026-06-17
**Status:** Approved for planning
**Source of truth:** `docs/KO_OS UI.Specification.md` (v1.1, June 2026). Where other docs
conflict with it, the UI Specification wins.
**Supporting docs:** `KO_Design_System.docx`, `KO Content Studios — Brand Operating
Guidelines.docx`, `Navigation Structure.docx`, `KO_OS Brand Onboarding Form.docx`,
`KO OS -- PDRAP.docx`, `KO Platform MVP – User Story & PRD.docx`.

---

## 1. Product Summary

KO OS is the dark-mode ("Night KO") product from KO Content Studios. The core MVP is a
single guided loop:

> **Sign up → (forced) Brand Profile → chat with AI to build a Content Strategy → AI
> generates a day-by-day Content Calendar → request a Design Ticket on any calendar item
> → a KO human designer fulfills and delivers the asset back inside the app.**

**Guiding principle — "AI plans, humans design."** In the MVP the AI produces the
strategy and the calendar (text/plan). It does **not** generate images, video, or
finished copy. When a visual asset is needed, the user submits a Design Ticket to KO's
human design team, who deliver the asset through the platform.

### 1.1 Decisions locked during brainstorming
1. **Monetization:** *No billing in the MVP.* Ship free, validate usage and retention,
   add billing later. **However**, the build must (a) sequence the monetizable core loop
   first and (b) capture the data future billing needs (see §8).
2. **Design ticket fulfillment:** *Lightweight in-app admin/designer view.* Designers log
   in, see the ticket queue, claim tickets, update status, and upload deliverables — all
   inside KO OS.
3. **Legacy code:** *Pivot and drop off-spec features.* Reuse auth, DB plumbing, and AI
   infrastructure; rebuild flows to match the spec; remove Knowledge Base, the 8-step
   onboarding wizard, the product/service campaign generator, and Support requests.
4. **Scope of this plan:** *App + entry page + legal pages.* The KO OS product plus the
   entry page, auth, and Privacy/Terms. The full light-mode marketing site
   (Solutions/Resources/Blog/Pricing) is deferred to a later phase.

### 1.2 Profitability stance (even with billing deferred)
- The first thing that must work end-to-end is the loop users would pay for:
  **Strategy → Calendar → Design Ticket → Delivery.** Everything else (dashboard polish,
  marketing site) comes after.
- The schema records the inputs billing will later need: per-ticket design type and
  dimensions (which map to a future price list), ticket counts per user/brand, and AI
  generation usage events. Adding subscription/credits/per-ticket checkout later is a
  slot-in, not a rebuild.
- A disabled "Get Invoice / Download Invoice" affordance is stubbed on the design-ticket
  confirmation screen (the spec explicitly anticipates it) so the payment hook has a home.

---

## 2. Architecture

### 2.1 Stack (reuse — already in place)
Next.js 16 (App Router) / React 19, Supabase (auth + SSR, Google OAuth), Drizzle ORM +
Postgres, Vercel AI SDK (`@ai-sdk/react`, `@ai-sdk/openai`), shadcn/ui + Tailwind v4,
TanStack Query, Zustand, nuqs, nodemailer, Biome.

### 2.2 Route structure (target)
| Route | Purpose | Access |
| --- | --- | --- |
| `/` | KO OS entry page (dark, two-column, looping visual) | public |
| `/privacy`, `/terms` | Legal pages | public |
| `/auth/login`, `/auth/register` | Auth (email + Google) | public |
| `/auth/callback` | OAuth callback (exists) | public |
| `/dashboard` | Overview of brands, strategies, calendars, tickets | auth |
| `/brand`, `/brand/create` | Brand Profile view/edit + forced create | auth |
| `/strategy`, `/strategy/:id` | AI strategy chat workspace + saved strategy | auth |
| `/calendar` | Content calendar (Month/Week/Day/Agenda) | auth |
| `/calendar/item/:id` | Calendar item detail (drawer/sheet) | auth |
| `/design-request` , `/design-request/:id` | Tickets list + ticket detail | auth |
| `/admin/tickets` (working name) | Designer/admin fulfillment queue | role: designer/admin |

**Removed routes:** `/knowledge`, `/requests`, `/campaigns` (replaced by `/strategy` +
`/calendar`), the multi-step onboarding wizard route.

### 2.3 Forced-routing rule
After auth, the app checks for a completed Brand Profile. If none → `/brand/create` with
all other nav disabled. If present → last workspace (`/strategy` or `/calendar`).

---

## 3. Data Model (Drizzle migration)

### 3.1 Keep / modify
- **`users`** — add `role` enum (`user` | `designer` | `admin`, default `user`).
- **`brands`** — reshape into the Brand Profile: add `overview`, `businessType`, `stage`,
  `targetAudience`, `offer`, `tone`, `primaryGoal`, `primaryColor`, `secondaryColor`,
  `additionalColors` (text[]), `logoUrl`. Keep `onboardingStatus`/`completionPercentage`.
- **`chat_conversations`, `chat_messages`** — keep; these back strategy sessions.
- **`brand_assets`** — keep (logo + uploaded assets).

### 3.2 New tables
- **`strategies`** — `id`, `brandId`, `conversationId?`, `name`, `structured` (jsonb:
  objective, target, keyMessage, channels, contentMix, timeline/phases, themes,
  postingSchedule), `status`, timestamps. *Replaces `campaigns`.*
- **`calendars`** — `id`, `brandId`, `strategyId`, `startDate`, `endDate`, timestamps.
- **`calendar_items`** — `id`, `calendarId`, `date`, `time`, `platform`, `contentType`,
  `title`, `brief`, `designRequired` (bool), `designType?`, `dimensions?`, `status`
  (`draft`|`in_progress`|`ready`|`published`), `designTicketId?`, ordering.
- **`design_tickets`** — `id`, `calendarItemId`, `brandId`, `userId`, `designType`,
  `dimensions`, `slides?`, `brief`, `notes?`, `dueDate?`, `status` (lifecycle below),
  `assignedDesignerId?`, `ticketNumber` (human-readable, e.g. DT-00124), timestamps.
  *Replaces `professional_requests`.*
- **`design_deliverables`** — `id`, `ticketId`, `fileUrl`, `fileName`, `slideIndex?`,
  `createdAt`.
- **`notifications`** — `id`, `userId`, `type`, `payload` (jsonb), `readAt?`, `createdAt`.
- **`usage_events`** (billing-readiness) — `id`, `userId`, `brandId?`, `kind`
  (`strategy_generated` | `calendar_generated` | `design_ticket_created`), `metadata`
  (jsonb, incl. design type for future pricing), `createdAt`.

### 3.3 Drop
`products_services`, `offers`, and any knowledge-base tables.

### 3.4 Design ticket lifecycle
`Submitted` → `Assigned` → `In Progress` → `Ready for Review` → `Delivered`, with a
`Revision Requested` side-path. Status colors per UI spec §8H.

### 3.5 Storage
Supabase Storage buckets: `logos`, `reference-images`, `deliverables`. Signed URLs for
private deliverables; RLS so users only see their brand's assets and designers see
assigned tickets.

---

## 4. AI Layer

- **Strategy generation:** conversational chat (existing `@ai-sdk/react` streaming) that,
  when ready, emits a **structured strategy** via `generateObject` + a Zod schema matching
  UI spec §2.1 (Campaign Name, Objective, Target, Key Message, Channels, Content Mix,
  Timeline, Themes, Posting Schedule). Rendered as the in-chat strategy card.
- **Calendar generation:** from an approved strategy, `generateObject` produces an array of
  calendar items (date, time, platform, contentType, title, brief, designRequired +
  type/dimensions) per UI spec §2.2.
- **Grounding:** every AI call is grounded in the Brand Profile (name, overview, audience,
  tone, colors) plus prior conversation. System prompts live in `src/lib/ai/prompts/`.
- **Failure handling (spec §3.6):** quota/network errors render an explicit error bubble
  with a **Try Again** action. No infinite spinners.
- Each successful generation writes a `usage_events` row.

---

## 5. Design System Alignment

Implement the exact KO OS dark token set (UI spec §9.2) as CSS variables / Tailwind theme:
- **Surfaces:** Base `#000D20`, Surface 1 `#00162E`, Surface 2 `#001F3D`, Nav `#00204F`.
- **Action:** Primary `#138BC8`, Hover `#0F7EB8`, Active `#0C5F8A`, Disabled `#1A3A4A`,
  Accent glow `rgba(19,139,200,0.15)`.
- **Text:** Primary `#FFFFFF`, Secondary `#A7B6C7`, Muted `#6F8599`.
- **Status colors, borders, dividers, shadows, backdrop** per spec tables.
- **Spacing:** 4/8/12/16/24/32/40/48/64/80/96 only.
- **Motion:** easing `cubic-bezier(0.2,0,0,1)`; durations XS 120 / S 160 / M 220 / L 320ms;
  deepen-not-brighten hovers; respect `prefers-reduced-motion`.
- **Typography (reconciliation):** **Manrope** for app UI text (per UI spec §9.3);
  **Bricolage Grotesque** reserved for the entry-page display headline as a brand moment.
  Type scale per spec §9.3 / §11.4.

Core components built/aligned once and reused: buttons (primary/secondary/ghost/icon),
inputs (text/textarea/select + states), cards, chips/badges/status pills, calendar
mini-card & cards, modal, right drawer, mobile bottom sheet (with drag handle/swipe),
toasts, banners, segmented control (view toggle), progress steps, file upload (drag/drop +
progress + preview + error), color picker.

---

## 6. Feature Units (each independently testable)

1. **Entry page** — two-column dark layout, ambient looping KO mark, Start Creating /
   Login, Privacy link, auth-down banner. Mobile single-column.
2. **Auth** — login/register card, validation rules, password show/hide + strength,
   loading/error/success states. Reuse Supabase email + Google OAuth.
3. **App shell** — sidebar (Dashboard · Brands · Campaigns · Calendar · Design Tickets) with
   collapse + mobile drawer; top bar (title, active brand name, notification bell w/ unread
   dot, avatar + dropdown: Account Settings [disabled], Privacy, Logout).
4. **Brand Profile** — 3-step create (Business Basics / Brand Direction / Brand Assets) with
   logo upload + color pickers, progress steps, localStorage persistence, forced routing;
   plus `/brand` view/edit.
5. **Strategy Workspace** — empty state + prompt chips, chat bubbles, typing/loading,
   error+Try Again, structured strategy card with Edit / Generate Calendar; left history
   panel (desktop) + right strategy-preview panel (collapsible).
6. **Content Calendar** — Month / Week / Day (list) / Agenda views, segmented toggle,
   Today + prev/next nav, campaign selector; responsive rules per §11.
7. **Calendar Item Detail** — right drawer (desktop) / bottom sheet (mobile): brief, design
   section (states: not required / required-no-ticket / submitted / delivered), status
   dropdown, Request Design.
8. **Design Request** — modal/sheet with auto-filled brief, design type + dimensions,
   slide count (conditional), brand assets preview, notes, reference image upload, due
   date; confirmation screen with ticket summary + deferred-invoice stub.
9. **Design Tickets** — list page + filter tabs + ticket detail; lifecycle statuses;
   delivery view (thumbnail grid, Download All ZIP, lightbox).
10. **Designer admin** — `/admin/tickets`: incoming queue, claim/assign, status updates,
    upload deliverables, mark delivered (triggers user notification). Role-gated.
11. **Notifications** — "design ready" toast + bell badge; notifications backed by the
    `notifications` table (polling or realtime).
12. **Dashboard** — overview cards: brands, recent strategies, calendars, ticket statuses,
    quick actions (New Strategy, Open Calendar, View Tickets).
13. **Legal** — Privacy Policy + Terms pages (content from PDRAP legal modules), linked from
    entry footer and profile dropdown.

---

## 7. Phased Delivery

Each phase leaves the app in a usable, demoable state.

- **Phase 0 — Foundation:** design tokens + fonts + core components; app shell + nav;
  route restructure; remove off-spec features; schema migration; Supabase Storage; user
  roles.
- **Phase 1 — Front door:** entry page; auth to spec; forced Brand Profile (3-step) +
  view/edit; Privacy/Terms.
- **Phase 2 — AI core:** strategy chat → structured strategy output; history/preview
  panels; Edit / Generate Calendar.
- **Phase 3 — Calendar:** AI calendar generation; 4 views + toggle/nav; item detail drawer.
- **Phase 4 — Design Tickets + fulfillment:** request modal → ticket; confirmation
  (+invoice stub); tickets list/detail; lifecycle; delivery + ZIP download; notifications;
  designer admin view.
- **Phase 5 — Dashboard + hardening:** dashboard overview; responsive QA; WCAG AA / focus /
  reduced-motion; error & empty states across the app.

**Deferred (post-MVP):** billing (subscription + credits + per-ticket checkout +
invoices); full marketing site; AI design/video/copy generation; auto-posting; analytics;
team collaboration; multi-brand polish; saved AI chat history beyond MVP needs.

---

## 8. Future Billing Readiness (design-now, build-later)
- `usage_events` records every strategy generation, calendar generation, and ticket
  creation (with design type) — the metering substrate for credits/plans.
- `design_tickets.designType` + `dimensions` map cleanly to a future per-design price list.
- Confirmation screen carries a disabled invoice affordance as the payment entry point.
- No Stripe, credits ledger, or paywalls are built in the MVP.

---

## 9. Non-Functional Requirements
- **Accessibility (spec §12):** WCAG AA contrast; visible KO-blue focus rings; focus trap +
  restore in modals/drawers; aria labels on icon buttons; `aria-live` for AI responses,
  toasts, status; `prefers-reduced-motion` respected.
- **Responsive (spec §11):** mobile ≤480 (drawer nav, bottom sheets, stacked), tablet
  481–768, desktop ≥769 (fixed sidebar, max-width 1280). 44px min tap targets; no
  horizontal scroll; body text ≥14px.
- **Security:** Supabase RLS so users access only their brands/strategies/calendars/tickets;
  designers access only assigned/queued tickets; admins broader. Signed URLs for
  deliverables.
- **Reliability:** explicit AI error/empty/loading states everywhere; no silent failures.

---

## 10. Open / Watch Items
- **Font reconciliation** (default chosen): Manrope for app UI, Bricolage Grotesque for the
  entry-page display headline. Revisit if brand team objects.
- **Notification transport:** start with polling on the `notifications` table; upgrade to
  Supabase Realtime if needed.
- **`ticketNumber` generation:** sequence/format `DT-#####`.
- **Designer admin scope:** intentionally minimal in MVP (queue + status + upload); not a
  full project-management tool.
