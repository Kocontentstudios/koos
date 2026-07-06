# Batch 5a: Email Wiring (Tiers A+B+C-welcome + Contact Form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real email delivery into every confirmed lifecycle event (ticket status change, progress update, designer claim, customer review, role change, welcome) and make the landing-page contact form actually send mail.

**Architecture:** Extend the existing template module (`src/lib/email-templates.ts`, shell/row/escapeHtml helpers) with six new builders. Ticket-lifecycle events get error-swallowing wrappers in `src/lib/design/notify.ts` (existing pattern: mail failure never fails the request). Account events (role change, welcome) get a new `src/lib/notify/account.ts`. The contact form posts to a new public `/api/contact` route — there, unlike everywhere else, a mail failure DOES fail the request (delivering the message is the whole point) — guarded by a honeypot field and length caps.

**Tech Stack:** Nodemailer over Zoho (`src/lib/email.ts` → `sendMail`), vitest + RTL, Next.js App Router route handlers.

## Global Constraints

- Before EVERY commit: full `npx vitest run` green, `npx tsc --noEmit -p tsconfig.json` clean, `npx biome check <touched files>` clean. tsc is mandatory — vitest and Biome do not type-check.
- Lockfile: `pnpm-lock.yaml` is tracked, `package-lock.json` gitignored. NO new dependencies in this batch.
- Ticket-lifecycle and account wrappers must NEVER throw (log + swallow), matching `sendDesignRequestEmails`. Only `/api/contact` propagates mail failure (as 500).
- Recipient for requester-facing ticket emails: `ticket.deliveryEmail || owner.email` (same rule as the existing delivery email).
- Email links use `appUrl(path)` from `src/lib/design/notify.ts` (`NEXT_PUBLIC_APP_URL` base).
- Support inbox: env `CONTACT_EMAIL`, falling back to `"hello@kocontentstudios.com"`. Nothing else hardcoded.
- All user-supplied strings in HTML go through the module's `escapeHtml` (it's private to email-templates.ts — new builders live in that file).
- Status display names: use the STATUS_LABELS map from Task 1 — never render raw enum values like `ready_for_review` to users.

---

### Task 1: Six new email template builders

**Files:**
- Modify: `src/lib/email-templates.ts`
- Modify: `src/lib/email-templates.test.ts`

**Interfaces:**
- Consumes: existing private helpers `shell`, `row`, `escapeHtml`; `formatTicketNumber` from `@/lib/design/ticket`.
- Produces (all return `BuiltEmail = { subject: string; html: string }`):
  - `STATUS_LABELS` — exported const object mapping the six ticket statuses (`submitted` … `revision_requested`) to human labels.
  - `ticketStatusEmail(i: TicketStatusEmailInput): BuiltEmail` where `TicketStatusEmailInput = { ticketNumber: number; designType: string; status: string; ticketUrl: string }`
  - `ticketProgressEmail(i: TicketProgressEmailInput): BuiltEmail` where `TicketProgressEmailInput = { ticketNumber: number; designType: string; message: string; status: string | null; ticketUrl: string }`
  - `ticketReviewTeamEmail(i: TicketReviewTeamEmailInput): BuiltEmail` where `TicketReviewTeamEmailInput = { ticketNumber: number; designType: string; action: "approve" | "revise"; note: string | null; requesterName: string; requesterEmail: string; adminUrl: string }`
  - `roleChangeEmail(i: RoleChangeEmailInput): BuiltEmail` where `RoleChangeEmailInput = { firstName: string; newRole: string; dashboardUrl: string }`
  - `welcomeEmail(i: WelcomeEmailInput): BuiltEmail` where `WelcomeEmailInput = { firstName: string; dashboardUrl: string }`
  - `contactFormEmail(i: ContactFormEmailInput): BuiltEmail` where `ContactFormEmailInput = { name: string; email: string; message: string }`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/email-templates.test.ts` (follow the existing describe/it style in that file):

```ts
import {
  contactFormEmail,
  roleChangeEmail,
  STATUS_LABELS,
  ticketProgressEmail,
  ticketReviewTeamEmail,
  ticketStatusEmail,
  welcomeEmail,
} from "./email-templates";

describe("ticketStatusEmail", () => {
  it("uses the human status label and escapes the design type", () => {
    const { subject, html } = ticketStatusEmail({
      ticketNumber: 42,
      designType: "<b>Flyer</b>",
      status: "ready_for_review",
      ticketUrl: "https://app/design-request/42",
    });
    expect(subject).toContain("Ready for review");
    expect(html).toContain("Ready for review");
    expect(html).toContain("&lt;b&gt;Flyer&lt;/b&gt;");
    expect(html).toContain("https://app/design-request/42");
    expect(html).not.toContain("ready_for_review");
  });
});

describe("ticketProgressEmail", () => {
  it("includes the escaped message and optional status", () => {
    const { html } = ticketProgressEmail({
      ticketNumber: 7,
      designType: "Logo",
      message: "First draft <ready>",
      status: "in_progress",
      ticketUrl: "https://app/t/7",
    });
    expect(html).toContain("First draft &lt;ready&gt;");
    expect(html).toContain(STATUS_LABELS.in_progress);
  });

  it("omits the status row when status is null", () => {
    const { html } = ticketProgressEmail({
      ticketNumber: 7,
      designType: "Logo",
      message: "Note",
      status: null,
      ticketUrl: "https://app/t/7",
    });
    expect(html).not.toContain("New status");
  });
});

describe("ticketReviewTeamEmail", () => {
  it("says approved with no note row", () => {
    const { subject, html } = ticketReviewTeamEmail({
      ticketNumber: 3,
      designType: "Banner",
      action: "approve",
      note: null,
      requesterName: "Ada",
      requesterEmail: "ada@x.com",
      adminUrl: "https://app/admin/tickets/3",
    });
    expect(subject.toLowerCase()).toContain("approved");
    expect(html).toContain("Ada");
    expect(html).not.toContain("Revision note");
  });

  it("says revision requested and escapes the note", () => {
    const { subject, html } = ticketReviewTeamEmail({
      ticketNumber: 3,
      designType: "Banner",
      action: "revise",
      note: "Make it <pop>",
      requesterName: "Ada",
      requesterEmail: "ada@x.com",
      adminUrl: "https://app/admin/tickets/3",
    });
    expect(subject.toLowerCase()).toContain("revision");
    expect(html).toContain("Make it &lt;pop&gt;");
  });
});

describe("roleChangeEmail", () => {
  it("names the new role and greets by first name", () => {
    const { html } = roleChangeEmail({
      firstName: "Sam",
      newRole: "designer",
      dashboardUrl: "https://app/dashboard",
    });
    expect(html).toContain("Sam");
    expect(html).toContain("designer");
  });
});

describe("welcomeEmail", () => {
  it("greets by first name and links the dashboard", () => {
    const { subject, html } = welcomeEmail({
      firstName: "Sam",
      dashboardUrl: "https://app/dashboard",
    });
    expect(subject).toContain("Welcome");
    expect(html).toContain("Sam");
    expect(html).toContain("https://app/dashboard");
  });
});

describe("contactFormEmail", () => {
  it("carries sender identity and escapes the message", () => {
    const { subject, html } = contactFormEmail({
      name: "Eve <script>",
      email: "eve@x.com",
      message: "Hi <there>",
    });
    expect(subject).toContain("Contact form");
    expect(html).toContain("Eve &lt;script&gt;");
    expect(html).toContain("eve@x.com");
    expect(html).toContain("Hi &lt;there&gt;");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/email-templates.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement in `src/lib/email-templates.ts`** — append (all reuse the private `shell`, `row`, `escapeHtml`; keep the module's inline-style idiom):

```ts
export const STATUS_LABELS = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  delivered: "Delivered",
  revision_requested: "Revision requested",
} as const;

type StatusKey = keyof typeof STATUS_LABELS;

function statusLabel(status: string): string {
  return STATUS_LABELS[status as StatusKey] ?? status;
}

export interface TicketStatusEmailInput {
  ticketNumber: number;
  designType: string;
  status: string;
  ticketUrl: string;
}

export function ticketStatusEmail(i: TicketStatusEmailInput): BuiltEmail {
  const label = statusLabel(i.status);
  const html = shell(
    `Update on your design request — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">Your <strong>${escapeHtml(
      i.designType,
    )}</strong> request is now: <strong>${escapeHtml(label)}</strong>.</p>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View your request →</a></p>`,
  );
  return {
    subject: `${label} — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface TicketProgressEmailInput {
  ticketNumber: number;
  designType: string;
  message: string;
  status: string | null;
  ticketUrl: string;
}

export function ticketProgressEmail(i: TicketProgressEmailInput): BuiltEmail {
  const statusRow = i.status
    ? row("New status", escapeHtml(statusLabel(i.status)))
    : "";
  const html = shell(
    `Progress update — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">New update on your <strong>${escapeHtml(
      i.designType,
    )}</strong> request:</p>
    <blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #138bc8;font-size:13px">${escapeHtml(
      i.message,
    )}</blockquote>
    <table style="border-collapse:collapse;width:100%">${statusRow}</table>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View your request →</a></p>`,
  );
  return {
    subject: `Progress update — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface TicketReviewTeamEmailInput {
  ticketNumber: number;
  designType: string;
  action: "approve" | "revise";
  note: string | null;
  requesterName: string;
  requesterEmail: string;
  adminUrl: string;
}

export function ticketReviewTeamEmail(
  i: TicketReviewTeamEmailInput,
): BuiltEmail {
  const verb = i.action === "approve" ? "approved" : "requested a revision on";
  const noteRow = i.note ? row("Revision note", escapeHtml(i.note)) : "";
  const html = shell(
    `Customer ${verb} ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px"><strong>${escapeHtml(
      i.requesterName,
    )}</strong> &lt;${escapeHtml(i.requesterEmail)}&gt; ${verb} the <strong>${escapeHtml(
      i.designType,
    )}</strong> delivery.</p>
    <table style="border-collapse:collapse;width:100%">${noteRow}</table>
    <p style="margin-top:16px"><a href="${i.adminUrl}" style="color:#138bc8">Open the ticket →</a></p>`,
  );
  const subjectVerb =
    i.action === "approve" ? "Design approved" : "Revision requested";
  return {
    subject: `${subjectVerb} — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface RoleChangeEmailInput {
  firstName: string;
  newRole: string;
  dashboardUrl: string;
}

export function roleChangeEmail(i: RoleChangeEmailInput): BuiltEmail {
  const html = shell(
    "Your KO OS role has changed",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, your account role is now <strong>${escapeHtml(
      i.newRole,
    )}</strong>. Your access updates the next time you sign in or refresh.</p>
    <p style="margin-top:16px"><a href="${i.dashboardUrl}" style="color:#138bc8">Open KO OS →</a></p>`,
  );
  return { subject: "Your KO OS role has changed", html };
}

export interface WelcomeEmailInput {
  firstName: string;
  dashboardUrl: string;
}

export function welcomeEmail(i: WelcomeEmailInput): BuiltEmail {
  const html = shell(
    "Welcome to KO OS",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, your account is ready. Set up your brand and generate your first content strategy in minutes.</p>
    <p style="margin-top:16px"><a href="${i.dashboardUrl}" style="color:#138bc8">Go to your dashboard →</a></p>`,
  );
  return { subject: "Welcome to KO OS", html };
}

export interface ContactFormEmailInput {
  name: string;
  email: string;
  message: string;
}

export function contactFormEmail(i: ContactFormEmailInput): BuiltEmail {
  const html = shell(
    "New contact form message",
    `<table style="border-collapse:collapse;width:100%">
    ${row("From", `${escapeHtml(i.name)} &lt;${escapeHtml(i.email)}&gt;`)}
    </table>
    <p style="font-size:13px;white-space:pre-wrap">${escapeHtml(i.message)}</p>`,
  );
  return { subject: `Contact form — ${i.name}`, html };
}
```

Note: `contactFormEmail`'s subject includes the raw name — subjects are plain text (no HTML context), matching how existing subjects interpolate values.

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/email-templates.test.ts` → PASS. Then full gate: `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npx biome check src/lib/email-templates.ts src/lib/email-templates.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat(email): add lifecycle, account, and contact-form email templates"`

---

### Task 2: Notify wrappers (ticket + account)

**Files:**
- Modify: `src/lib/design/notify.ts`
- Create: `src/lib/notify/account.ts`

**Interfaces:**
- Consumes: Task 1 builders; `sendMail` from `@/lib/email`; existing `getDesignTeamEmail`, `appUrl` from `@/lib/design/notify`.
- Produces (all `Promise<void>`, all never throw):
  - In `src/lib/design/notify.ts`: `sendTicketStatusEmail(args: { to: string; input: TicketStatusEmailInput })`, `sendTicketProgressEmail(args: { to: string; input: TicketProgressEmailInput })`, `sendTicketReviewTeamEmail(input: TicketReviewTeamEmailInput)` (resolves team address itself via `getDesignTeamEmail()`, `replyTo` = requesterEmail; warns + skips if no team address).
  - In `src/lib/notify/account.ts`: `sendRoleChangeEmail(args: { to: string; input: RoleChangeEmailInput })`, `sendWelcomeEmail(args: { to: string; input: WelcomeEmailInput })`.

No dedicated unit tests (repo convention: `notify.ts` wrappers are untested thin shells; route tests in Tasks 3–6 assert invocation and failure-swallowing).

- [ ] **Step 1: Extend `src/lib/design/notify.ts`** — add imports for the three new builders/input types, then append (mirror `sendDesignDeliveryEmail` exactly):

```ts
/** Email the requester when a ticket's status changes. Never throws. */
export async function sendTicketStatusEmail(args: {
  to: string;
  input: TicketStatusEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = ticketStatusEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("ticket status email failed", {
      ticketNumber: args.input.ticketNumber,
      to: args.to,
      err,
    });
  }
}

/** Email the requester when a progress update is posted. Never throws. */
export async function sendTicketProgressEmail(args: {
  to: string;
  input: TicketProgressEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = ticketProgressEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("ticket progress email failed", {
      ticketNumber: args.input.ticketNumber,
      to: args.to,
      err,
    });
  }
}

/** Tell the design team the customer approved / requested revision. Never throws. */
export async function sendTicketReviewTeamEmail(
  input: TicketReviewTeamEmailInput,
): Promise<void> {
  try {
    const team = await getDesignTeamEmail();
    if (!team) {
      console.warn("ticket review: no design team email configured; skipping", {
        ticketNumber: input.ticketNumber,
      });
      return;
    }
    const { subject, html } = ticketReviewTeamEmail(input);
    await sendMail({ to: team, subject, html, replyTo: input.requesterEmail });
  } catch (err) {
    console.error("ticket review team email failed", {
      ticketNumber: input.ticketNumber,
      err,
    });
  }
}
```

(`getDesignTeamEmail` itself never throws, but it sits inside the try anyway so this wrapper's contract is self-evident.)

- [ ] **Step 2: Create `src/lib/notify/account.ts`**:

```ts
import { sendMail } from "@/lib/email";
import {
  type RoleChangeEmailInput,
  roleChangeEmail,
  type WelcomeEmailInput,
  welcomeEmail,
} from "@/lib/email-templates";

/** Tell a user their role changed. Never throws. */
export async function sendRoleChangeEmail(args: {
  to: string;
  input: RoleChangeEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = roleChangeEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("role change email failed", { to: args.to, err });
  }
}

/** Welcome a newly created account. Never throws. */
export async function sendWelcomeEmail(args: {
  to: string;
  input: WelcomeEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = welcomeEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("welcome email failed", { to: args.to, err });
  }
}
```

- [ ] **Step 3: Full gate** — `npx vitest run` (all green), `npx tsc --noEmit -p tsconfig.json`, `npx biome check src/lib/design/notify.ts src/lib/notify/account.ts`.

- [ ] **Step 4: Commit** — `git commit -m "feat(email): add ticket + account notify wrappers (never-throw)"`

---

### Task 3: Tier A — email at the two sites that already notify in-app

**Files:**
- Modify: `src/app/api/admin/tickets/[id]/manage/route.ts`
- Modify: `src/app/api/admin/tickets/[id]/updates/route.ts`
- Create: `src/app/api/admin/tickets/[id]/manage/route.test.ts`
- Create: `src/app/api/admin/tickets/[id]/updates/route.test.ts`

**Interfaces:**
- Consumes: `sendTicketStatusEmail`, `sendTicketProgressEmail`, `appUrl` from `@/lib/design/notify`; `getUserById` from `@/lib/db/queries` (already imported in manage; add to updates).
- Recipient rule: `ticket.deliveryEmail || owner.email` where `owner = await getUserById(ticket.userId)`.

- [ ] **Step 1: Write failing tests.** `manage/route.test.ts` (mock style mirrors `src/app/api/brand/suggest/route.test.ts` — `vi.mock` the modules, import `{ POST }`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getDesignTicketById = vi.fn();
const getUserById = vi.fn();
const updateDesignTicket = vi.fn();
const createNotification = vi.fn();
const sendTicketStatusEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getUserById: (id: string) => getUserById(id),
  updateDesignTicket: (id: string, p: unknown) => updateDesignTicket(id, p),
  createNotification: (n: unknown) => createNotification(n),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
  sendTicketStatusEmail: (a: unknown) => sendTicketStatusEmail(a),
}));

import { POST } from "./route";

const ticket = {
  id: "t1",
  userId: "u1",
  ticketNumber: 12,
  designType: "Flyer",
  status: "submitted",
  deliveryEmail: null,
};

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: "t1" }) };

describe("admin manage route emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
    getDesignTicketById.mockResolvedValue(ticket);
    getUserById.mockResolvedValue({ id: "u1", email: "owner@x.com" });
    updateDesignTicket.mockResolvedValue({ ...ticket, status: "assigned" });
    createNotification.mockResolvedValue({});
  });

  it("emails the requester on a status change", async () => {
    const res = await POST(req({ status: "assigned" }), params);
    expect(res.status).toBe(200);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@x.com",
        input: expect.objectContaining({ status: "assigned", ticketNumber: 12 }),
      }),
    );
  });

  it("prefers the ticket deliveryEmail", async () => {
    getDesignTicketById.mockResolvedValue({
      ...ticket,
      deliveryEmail: "inbox@x.com",
    });
    await POST(req({ status: "assigned" }), params);
    expect(sendTicketStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "inbox@x.com" }),
    );
  });

  it("does not email when status is unchanged", async () => {
    await POST(req({ priority: "high" }), params);
    expect(sendTicketStatusEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendTicketStatusEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ status: "assigned" }), params);
    expect(res.status).toBe(200);
  });
});
```

NOTE for the `vi.mock("@/lib/db/queries", ...)` factory: mock ONLY the names the route imports (check the route's import list and mirror it exactly), otherwise the module mock throws on missing exports.

`updates/route.test.ts` — same scaffolding, mocking `postTicketProgressUpdate` and `sendTicketProgressEmail`; assert: (a) 200 + `sendTicketProgressEmail` called with `to: "owner@x.com"` and `input.message`; (b) email still sent when `status` omitted (`input.status: null`); (c) 200 when the email helper rejects; (d) `getUserById` failure (mockRejectedValue) still returns 200 (email skipped, wrapped in try).

- [ ] **Step 2: Run to verify failure** — both test files FAIL (wrapper not called).

- [ ] **Step 3: Wire the routes.** In `manage/route.ts`, extend the existing `if (patch.status && patch.status !== ticket.status)` block — after `createNotification`, inside the same try (import `appUrl`, `sendTicketStatusEmail` from `@/lib/design/notify`):

```ts
  if (patch.status && patch.status !== ticket.status) {
    try {
      await createNotification({
        userId: ticket.userId,
        type: "ticket_status",
        payload: {
          ticketId: id,
          ticketNumber: ticket.ticketNumber,
          designType: ticket.designType,
          status: patch.status,
        },
      });
      const owner = await getUserById(ticket.userId);
      const to = ticket.deliveryEmail || owner?.email;
      if (to) {
        await sendTicketStatusEmail({
          to,
          input: {
            ticketNumber: ticket.ticketNumber,
            designType: ticket.designType,
            status: patch.status,
            ticketUrl: appUrl(`/design-request/${id}`),
          },
        });
      }
    } catch (err) {
      console.error("manage: status notification failed", { ticketId: id, err });
    }
  }
```

In `updates/route.ts`, after `postTicketProgressUpdate(...)` and before the final `return` (import `getUserById`; import `appUrl`, `sendTicketProgressEmail` from `@/lib/design/notify`):

```ts
  // Email the requester (non-blocking — the update is already persisted).
  try {
    const owner = await getUserById(ticket.userId);
    const to = ticket.deliveryEmail || owner?.email;
    if (to) {
      await sendTicketProgressEmail({
        to,
        input: {
          ticketNumber: ticket.ticketNumber,
          designType: ticket.designType,
          message,
          status: newStatus,
          ticketUrl: appUrl(`/design-request/${id}`),
        },
      });
    }
  } catch (err) {
    console.error("updates: progress email failed", { ticketId: id, err });
  }
```

Verify the ticket URL path: check where customers view a ticket (the design-request page used by `sendDesignRequestEmails`'s `ticketUrl` call site in `api/design-tickets/route.ts`) and use the same path shape.

- [ ] **Step 4: Full gate** — `npx vitest run`, tsc, biome on the four touched files.

- [ ] **Step 5: Commit** — `git commit -m "feat(email): notify requester on admin status change + progress update (Tier A)"`

---

### Task 4: Tier B — designer status change, customer review, role change

**Files:**
- Modify: `src/app/api/admin/tickets/[id]/status/route.ts`
- Modify: `src/app/api/design-tickets/[id]/review/route.ts`
- Modify: `src/app/api/admin/users/[id]/role/route.ts`
- Create: `src/app/api/admin/tickets/[id]/status/route.test.ts`
- Create: `src/app/api/design-tickets/[id]/review/route.test.ts`
- Create: `src/app/api/admin/users/[id]/role/route.test.ts`

**Interfaces:**
- Consumes: `sendTicketStatusEmail`, `sendTicketReviewTeamEmail`, `appUrl` from `@/lib/design/notify`; `sendRoleChangeEmail` from `@/lib/notify/account`; `getUserById` from `@/lib/db/queries`.

- [ ] **Step 1: Write failing tests** (same mock scaffolding as Task 3; each file 3–4 cases):
  - `status/route.test.ts`: designer sets `{ status: "in_progress" }` → 200 + `sendTicketStatusEmail` with `to: "owner@x.com"`, `input.status: "in_progress"`; claim (`{ claim: true }`) → email with `input.status: "assigned"`; status equal to current ticket status → NO email; helper rejection → still 200.
  - `review/route.test.ts`: owner (`dbUser.id === ticket.userId`, brand owned) approves → 200 + `sendTicketReviewTeamEmail` with `action: "approve"`, `note: null`; revise with note → `action: "revise"`, `note: "fix logo"`; helper rejection → still 200. Mock `getBrandById` to return `{ id: "b1", userId: "u1" }` and `updateCalendarItemStatus`.
  - `role/route.test.ts`: admin changes another user's role → 200 + `sendRoleChangeEmail` with `to: target.email`, `input.newRole`; same-role update still emails (updateUserRole is unconditional — acceptable); helper rejection → still 200; 403 for non-admin sends nothing.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Wire the three routes.**

`status/route.ts` — after `const updated = await updateDesignTicket(id, patch);`, before the return (imports: `getUserById` added to the queries import; `appUrl`, `sendTicketStatusEmail` from notify):

```ts
  // Email the requester when the visible status actually changed (non-blocking).
  if (patch.status && patch.status !== ticket.status) {
    try {
      const owner = await getUserById(ticket.userId);
      const to = ticket.deliveryEmail || owner?.email;
      if (to) {
        await sendTicketStatusEmail({
          to,
          input: {
            ticketNumber: ticket.ticketNumber,
            designType: ticket.designType,
            status: patch.status,
            ticketUrl: appUrl(`/design-request/${id}`),
          },
        });
      }
    } catch (err) {
      console.error("status: requester email failed", { ticketId: id, err });
    }
  }
```

`review/route.ts` — in the `approve` branch after `updateDesignTicket` (and calendar update), and in the `revise` branch after `updateDesignTicket`, add (imports: `sendTicketReviewTeamEmail`, `appUrl` from notify):

```ts
    // approve branch:
    await notifyTeamOfReview("approve", null);
    // revise branch:
    await notifyTeamOfReview("revise", note ?? null);
```

with a small local helper above the branches (inside `POST`, after the brand check, so it closes over `ticket`/`dbUser`):

```ts
  async function notifyTeamOfReview(
    action: "approve" | "revise",
    note: string | null,
  ) {
    try {
      await sendTicketReviewTeamEmail({
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        action,
        note,
        requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        requesterEmail: dbUser.email,
        adminUrl: appUrl(`/admin/tickets/${id}`),
      });
    } catch (err) {
      console.error("review: team email failed", { ticketId: id, err });
    }
  }
```

(`ticket` is non-null past the 404 guard; if tsc complains about narrowing inside the closure, capture `const t = ticket;` first. Verify `dbUser` exposes `firstName`/`lastName`/`email` — it's the drizzle users row, so it does.)

`role/route.ts` — after `const updated = await updateUserRole(id, body.role);` (imports: `sendRoleChangeEmail` from `@/lib/notify/account`, `appUrl` from `@/lib/design/notify`):

```ts
  // Non-blocking: role change already persisted.
  try {
    await sendRoleChangeEmail({
      to: target.email,
      input: {
        firstName: target.firstName,
        newRole: updated.role,
        dashboardUrl: appUrl("/dashboard"),
      },
    });
  } catch (err) {
    console.error("role: change email failed", { userId: id, err });
  }
```

- [ ] **Step 4: Full gate** — `npx vitest run`, tsc, biome on the six touched files.

- [ ] **Step 5: Commit** — `git commit -m "feat(email): designer status, customer review, and role-change emails (Tier B)"`

---

### Task 5: Contact form — real `/api/contact` + landing-page wiring

**Files:**
- Create: `src/app/api/contact/route.ts`
- Create: `src/app/api/contact/route.test.ts`
- Modify: `src/components/marketing/landing-page.tsx` (form + `handleContactSubmit`, ~lines 209–214 and 514–548)

**Interfaces:**
- Consumes: `contactFormEmail` from `@/lib/email-templates`, `sendMail` from `@/lib/email`, `isValidEmail` from `@/lib/validation/email`.
- Produces: `POST /api/contact` accepting `{ name, email, message, company }` → `{ ok: true }` | `{ error }` with 400/500. `company` is the honeypot: bots fill it; humans never see it.
- UNLIKE the notify wrappers, a mail failure here returns 500 — the form's only job is delivering the message, so pretending success on failure would silently eat leads.

- [ ] **Step 1: Write failing route tests** (`route.test.ts` — mock `@/lib/email`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("@/lib/email", () => ({ sendMail: (o: unknown) => sendMail(o) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/contact", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const valid = { name: "Ada", email: "ada@x.com", message: "Hello there" };

describe("contact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({});
    vi.stubEnv("CONTACT_EMAIL", "support@x.com");
  });

  it("sends to the configured inbox with replyTo the submitter", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "support@x.com", replyTo: "ada@x.com" }),
    );
  });

  it("falls back to the default inbox without CONTACT_EMAIL", async () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    await POST(req(valid));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "hello@kocontentstudios.com" }),
    );
  });

  it("400s on a bad email", async () => {
    const res = await POST(req({ ...valid, email: "nope" }));
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("400s on missing message", async () => {
    const res = await POST(req({ ...valid, message: "  " }));
    expect(res.status).toBe(400);
  });

  it("400s on oversized message", async () => {
    const res = await POST(req({ ...valid, message: "x".repeat(5001) }));
    expect(res.status).toBe(400);
  });

  it("silently accepts honeypot submissions without sending", async () => {
    const res = await POST(req({ ...valid, company: "Acme" }));
    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("500s when mail delivery fails (no fake success)", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req(valid));
    expect(res.status).toBe(500);
  });
});
```

(`vi.stubEnv` resets automatically between tests only with `unstubEnvs: true`; call `vi.unstubAllEnvs()` in an `afterEach` to be explicit.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/app/api/contact/route.ts`**:

```ts
import { z } from "zod";
import { contactFormEmail } from "@/lib/email-templates";
import { sendMail } from "@/lib/email";
import { isValidEmail } from "@/lib/validation/email";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320),
  message: z.string().trim().min(1).max(5000),
  company: z.string().max(200).optional(), // honeypot — humans never see it
});

function contactInbox(): string {
  return (process.env.CONTACT_EMAIL || "hello@kocontentstudios.com").trim();
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success || !isValidEmail(parsed.data.email)) {
    return Response.json(
      { error: "Please fill in a valid name, email, and message." },
      { status: 400 },
    );
  }
  const { name, email, message, company } = parsed.data;

  // Honeypot tripped: report success but send nothing.
  if (company) {
    return Response.json({ ok: true });
  }

  try {
    const { subject, html } = contactFormEmail({ name, email, message });
    await sendMail({ to: contactInbox(), subject, html, replyTo: email });
  } catch (err) {
    console.error("contact form email failed", err);
    return Response.json(
      { error: "Could not send your message. Please try again." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Wire the landing form.** In `landing-page.tsx`:
  - Add state next to `contactSent`: `const [contactPending, setContactPending] = useState(false);` and `const [contactError, setContactError] = useState<string | null>(null);`
  - Replace `handleContactSubmit`:

```tsx
  async function handleContactSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (contactPending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setContactPending(true);
    setContactError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          company: data.get("company"),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not send your message.");
      }
      setContactSent(true);
      form.reset();
      setTimeout(() => setContactSent(false), 5000);
    } catch (err) {
      setContactError(
        err instanceof Error ? err.message : "Could not send your message.",
      );
    } finally {
      setContactPending(false);
    }
  }
```

  - Add `name="name"`, `name="email"`, `name="message"` to the three existing inputs (they currently only have ids).
  - Add the honeypot inside the form, before the submit button (visually hidden, off the tab order, ignored by screen readers):

```tsx
              <div aria-hidden="true" className="hp-field">
                <label htmlFor="contactCompany">Company</label>
                <input
                  type="text"
                  id="contactCompany"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>
```

  with `.hp-field { position: absolute; left: -9999px; }` added to `src/app/landing.css` (the landing page's scoped stylesheet — confirm the selector nests under `.landing-page` like its neighbors).
  - Error display: reuse the existing `.form-success` block pattern — add below it:

```tsx
            {contactError && (
              <div className="form-success visible" role="alert">
                {contactError}
              </div>
            )}
```

  If `.form-success` styling reads as green/success, add a minimal inline style `style={{ color: "var(--status-error-fg, #d47575)" }}` rather than inventing a new class (dark-first theme rule: never hardcode light-only colors).
  - Disable the submit button while pending: `disabled={contactPending}` and label `{contactPending ? "Sending…" : "Send Message"}`.

- [ ] **Step 5: Full gate** — `npx vitest run`, tsc, biome on the three touched files.

- [ ] **Step 6: Commit** — `git commit -m "feat(contact): real landing contact form via /api/contact (honeypot, configurable inbox)"`

---

### Task 6: Welcome email on first signup (email/password + Google)

**Files:**
- Modify: `src/app/(auth)/actions.ts` (`signup`, after `createUser`, before `startSession`)
- Modify: `src/app/(auth)/auth/callback/route.ts` (inside the `if (!user)` first-time branch)
- Modify: `.env.example` (document `CONTACT_EMAIL` — fold into this task; one-line addition under the email section)

**Interfaces:**
- Consumes: `sendWelcomeEmail` from `@/lib/notify/account`; `appUrl` from `@/lib/design/notify`.

No new tests: `welcomeEmail` template is covered by Task 1; `sendWelcomeEmail` never throws by construction (same audited pattern as every other wrapper); the two call sites are redirect-heavy auth flows with no existing test harness. State this explicitly in the commit body so the reviewer sees it was a decision, not an omission.

- [ ] **Step 1: Wire `signup` in `(auth)/actions.ts`** — after `const user = await createUser({...});`:

```ts
  // Fire-and-forget welcome (never throws; must not block first login).
  await sendWelcomeEmail({
    to: user.email,
    input: { firstName: user.firstName, dashboardUrl: appUrl("/dashboard") },
  });
```

- [ ] **Step 2: Wire the Google callback** — inside `if (!user) { user = await createUser({...}); ... }` add the same call after `createUser` (only first-time Google users get it; returning users skip the branch entirely).

- [ ] **Step 3: `.env.example`** — under the existing Zoho/email block add:

```
# Landing-page contact form inbox (defaults to hello@kocontentstudios.com)
# CONTACT_EMAIL=
```

- [ ] **Step 4: Full gate** — `npx vitest run`, tsc, biome on touched files.

- [ ] **Step 5: Commit** — `git commit -m "feat(email): welcome email on first signup (password + Google)"`

---

## Self-review notes (already applied)

- Spec coverage: map rows 1–6b all have tasks (1→T3, 2→T3, 3→T4, 4→T4, 5→T4, 6→T6, 6b→T5); rows 8–9 are Tier D, deliberately skipped; row 7 (password reset) is plan 5b.
- The review route's `dbUser` narrowing inside a closure may need `const t = ticket` capture — flagged inline in Task 4.
- The existing `getUserById` import in manage/route.ts is already there (used for assignee validation); updates/status routes need it added.
