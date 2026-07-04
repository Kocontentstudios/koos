# Design Request Emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actually send email on a design request — notify the design team, confirm to the requester, and deliver the finished design — with an optional per-request delivery/contact email.

**Architecture:** Add a nullable `deliveryEmail` column to `design_tickets`. Add pure, unit-tested HTML email builders (`src/lib/email-templates.ts`) and a thin non-throwing orchestration layer (`src/lib/design/notify.ts`) over the existing `sendMail` (nodemailer/Zoho). Wire the request POST route to send team + confirmation emails, the deliverables upload route to send the delivery email, and add the optional field to the request modal. Email failures are always caught and logged — they never fail ticket creation or deliverable upload.

**Tech Stack:** Next.js 16 App Router (route handlers), Drizzle ORM + postgres.js, nodemailer (Zoho SMTP, existing `src/lib/email.ts`), Cloudflare R2 signed URLs (existing `src/lib/storage.ts`), Vitest + RTL, Biome.

## Global Constraints

- Scripts (exact): lint = `npm run lint` (`biome check .`); tests = `npm test` (`vitest run --passWithNoTests`); typecheck = `npx tsc --noEmit`. NOTE: this repo gitignores `drizzle/meta/` and has no in-app migrator, so `drizzle-kit generate` cannot produce incremental migrations on a fresh checkout — schema is applied via `db:push` (schema.ts is the source of truth) and DDL is recorded as hand-written `.sql` files under `drizzle/`.
- **SMTP/mail secrets stay in env** (`ZOHO_SMTP_*`, `ZOHO_MAIL_FROM`). The only new env var is `DESIGN_TEAM_EMAIL` (optional). Never store credentials in code or DB.
- **Email is non-blocking:** every send is wrapped in try/catch and logged; a mail failure must NOT fail ticket creation or deliverable upload, and must NOT change the HTTP response. Applying the migration is a deploy step — out of scope for these tasks.
- Delivery-email field framing (verbatim): label **"Receive updates & final design at"**; helper **"Leave blank to use your account email."** (This one field is the requester's contact for confirmation, updates, AND final delivery.)
- Reuse the existing `sendMail` from `@/lib/email` and `formatTicketNumber` from `@/lib/design/ticket` (`DT-#####`). Do not add a new mail library.
- Recipient resolution: team = `DESIGN_TEAM_EMAIL` → `ZOHO_MAIL_FROM` → `ZOHO_SMTP_USER`; requester/delivery = `ticket.deliveryEmail || accountEmail`.
- Delivery links are 7-day signed R2 URLs (`getSignedReadUrl(key, 60*60*24*7)`).
- Styling in the modal: existing CSS-variable tokens; no hardcoded light hexes / `text-white` on theme surfaces.
- One commit per task.

---

### Task 1: Add `deliveryEmail` column + migration

**Files:**
- Modify: `src/lib/db/schema.ts:287` (inside `designTickets`, after `notes`)
- Create: `drizzle/0002_add_delivery_email.sql` (hand-written DDL record; matches the existing committed `.sql` format)

**Interfaces:**
- Consumes: nothing.
- Produces: `designTickets.deliveryEmail` (`text`, nullable). `createDesignTicket`'s `Omit<typeof designTickets.$inferInsert, "ticketNumber">` param now accepts an optional `deliveryEmail`, and `getDesignTicketById(...)` rows expose `deliveryEmail: string | null`.

- [ ] **Step 1: Add the column to the schema**

In `src/lib/db/schema.ts`, in the `designTickets` table, add the column immediately after the `notes` line (currently line 287):

```ts
  notes: text("notes"),
  deliveryEmail: text("delivery_email"),
  dueDate: timestamp("due_date"),
```

- [ ] **Step 2: Write the migration DDL by hand**

Do NOT run `db:generate` — this repo gitignores `drizzle/meta/`, so generate has no snapshot baseline and emits a bogus full-schema migration. Instead, create `drizzle/0002_add_delivery_email.sql` with the single statement, matching the format of the existing committed `.sql` files:

```sql
ALTER TABLE "design_tickets" ADD COLUMN "delivery_email" text;
```

(schema.ts remains the source of truth applied via `db:push` at deploy; this file is the committed DDL record. Do NOT run `db:push`/`db:migrate` — applying is a deploy step.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The column is now on `designTickets`, so `createDesignTicket` accepts `deliveryEmail` and `ticket.deliveryEmail` is typed `string | null`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0002_add_delivery_email.sql
git commit -m "feat(design): add nullable deliveryEmail column to design_tickets"
```

---

### Task 2: Email template builders (pure, TDD)

Pure functions that build `{ subject, html }` for the three emails. No I/O — this is where the "includes all the data required for proper delivery" guarantee is tested.

**Files:**
- Create: `src/lib/email-templates.ts`
- Test: `src/lib/email-templates.test.ts`

**Interfaces:**
- Consumes: `formatTicketNumber` from `@/lib/design/ticket`.
- Produces:
  ```ts
  export interface DesignRequestEmailInput {
    ticketNumber: number;
    requesterName: string;
    requesterEmail: string;
    deliveryEmail: string | null;
    brandName: string;
    designType: string;
    dimensions: string | null;
    slides: number | null;
    brief: string;
    notes: string | null;
    dueDate: Date | null;
    adminUrl: string;
    ticketUrl: string;
  }
  export interface DesignDeliveryEmailInput {
    ticketNumber: number;
    designType: string;
    links: Array<{ fileName: string; url: string }>;
    ticketUrl: string;
  }
  export interface BuiltEmail { subject: string; html: string; }
  export function designRequestTeamEmail(i: DesignRequestEmailInput): BuiltEmail;
  export function designRequestConfirmationEmail(i: DesignRequestEmailInput): BuiltEmail;
  export function designDeliveryEmail(i: DesignDeliveryEmailInput): BuiltEmail;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/email-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  designDeliveryEmail,
  designRequestConfirmationEmail,
  designRequestTeamEmail,
  type DesignDeliveryEmailInput,
  type DesignRequestEmailInput,
} from "./email-templates";

const REQ: DesignRequestEmailInput = {
  ticketNumber: 124,
  requesterName: "Ada Lovelace",
  requesterEmail: "ada@example.com",
  deliveryEmail: "studio@client.com",
  brandName: "Acme Co",
  designType: "Instagram Carousel (1080x1080 per slide)",
  dimensions: "1080x1080",
  slides: 6,
  brief: "Six-slide launch teaser",
  notes: "Use the <blue> brand palette",
  dueDate: new Date("2026-07-10T00:00:00Z"),
  adminUrl: "https://app.test/admin/tickets",
  ticketUrl: "https://app.test/design-request/abc",
};

describe("designRequestTeamEmail", () => {
  const { subject, html } = designRequestTeamEmail(REQ);
  it("subject carries the formatted ticket number", () => {
    expect(subject).toContain("DT-00124");
  });
  it("body includes every field the team needs to act", () => {
    for (const needle of [
      "DT-00124",
      "Ada Lovelace",
      "ada@example.com",
      "studio@client.com",
      "Acme Co",
      "Instagram Carousel",
      "1080x1080",
      "6",
      "Six-slide launch teaser",
      "July 10, 2026",
      "https://app.test/admin/tickets",
    ]) {
      expect(html).toContain(needle);
    }
  });
  it("escapes HTML in free-text fields", () => {
    expect(html).toContain("&lt;blue&gt;");
    expect(html).not.toContain("<blue>");
  });
});

describe("designRequestConfirmationEmail", () => {
  it("summarizes the request and links to the requester's ticket", () => {
    const { subject, html } = designRequestConfirmationEmail(REQ);
    expect(subject).toContain("DT-00124");
    expect(html).toContain("Six-slide launch teaser");
    expect(html).toContain("https://app.test/design-request/abc");
  });
});

describe("designDeliveryEmail", () => {
  const input: DesignDeliveryEmailInput = {
    ticketNumber: 124,
    designType: "Instagram Carousel (1080x1080 per slide)",
    links: [
      { fileName: "slide-1.png", url: "https://r2.test/a?sig=1" },
      { fileName: "slide-2.png", url: "https://r2.test/b?sig=2" },
    ],
    ticketUrl: "https://app.test/design-request/abc",
  };
  it("lists every deliverable as a download link", () => {
    const { subject, html } = designDeliveryEmail(input);
    expect(subject).toContain("DT-00124");
    expect(html).toContain("slide-1.png");
    expect(html).toContain("https://r2.test/a?sig=1");
    expect(html).toContain("slide-2.png");
    expect(html).toContain("https://r2.test/b?sig=2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/email-templates.test.ts`
Expected: FAIL — module `./email-templates` not found.

- [ ] **Step 3: Implement the builders**

Create `src/lib/email-templates.ts`:

```ts
import { formatTicketNumber } from "@/lib/design/ticket";

export interface DesignRequestEmailInput {
  ticketNumber: number;
  requesterName: string;
  requesterEmail: string;
  deliveryEmail: string | null;
  brandName: string;
  designType: string;
  dimensions: string | null;
  slides: number | null;
  brief: string;
  notes: string | null;
  dueDate: Date | null;
  adminUrl: string;
  ticketUrl: string;
}

export interface DesignDeliveryEmailInput {
  ticketNumber: number;
  designType: string;
  links: Array<{ fileName: string; url: string }>;
  ticketUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: Date | null): string {
  if (!date) return "No due date";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px">${escapeHtml(
    label,
  )}</td><td style="padding:4px 0;font-size:13px">${value}</td></tr>`;
}

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h2>
  ${bodyHtml}
</div>`;
}

function detailsTable(i: DesignRequestEmailInput): string {
  const dims = i.dimensions ? escapeHtml(i.dimensions) : "—";
  const slides = i.slides != null ? String(i.slides) : "—";
  return `<table style="border-collapse:collapse;width:100%">
    ${row("Ticket", formatTicketNumber(i.ticketNumber))}
    ${row("Brand", escapeHtml(i.brandName))}
    ${row("Design type", escapeHtml(i.designType))}
    ${row("Dimensions", dims)}
    ${row("Slides", slides)}
    ${row("Due by", formatDate(i.dueDate))}
    ${row("Brief", escapeHtml(i.brief))}
    ${row("Notes", i.notes ? escapeHtml(i.notes) : "—")}
  </table>`;
}

export function designRequestTeamEmail(i: DesignRequestEmailInput): BuiltEmail {
  const deliverTo = i.deliveryEmail
    ? escapeHtml(i.deliveryEmail)
    : `${escapeHtml(i.requesterEmail)} (account email)`;
  const html = shell(
    `New design request — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">From <strong>${escapeHtml(
      i.requesterName,
    )}</strong> &lt;${escapeHtml(i.requesterEmail)}&gt;</p>
    ${detailsTable(i)}
    <p style="font-size:13px;margin-top:12px">Deliver updates &amp; final design to: <strong>${deliverTo}</strong></p>
    <p style="margin-top:16px"><a href="${i.adminUrl}" style="color:#138bc8">Open the design queue →</a></p>`,
  );
  return { subject: `New design request — ${formatTicketNumber(i.ticketNumber)}`, html };
}

export function designRequestConfirmationEmail(i: DesignRequestEmailInput): BuiltEmail {
  const html = shell(
    "We've received your design request",
    `<p style="font-size:13px">Thanks, ${escapeHtml(
      i.requesterName,
    )} — your request is in. We'll send updates and the final design to this address.</p>
    ${detailsTable(i)}
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">Track your request →</a></p>`,
  );
  return {
    subject: `Request received — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export function designDeliveryEmail(i: DesignDeliveryEmailInput): BuiltEmail {
  const items = i.links
    .map(
      (l) =>
        `<li style="margin:4px 0"><a href="${l.url}" style="color:#138bc8">${escapeHtml(
          l.fileName,
        )}</a></li>`,
    )
    .join("");
  const html = shell(
    `Your design is ready — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">Your ${escapeHtml(
      i.designType,
    )} is ready. Download links are valid for 7 days:</p>
    <ul style="padding-left:18px">${items}</ul>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View in your dashboard →</a></p>`,
  );
  return {
    subject: `Your design is ready — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/email-templates.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors for the two new files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email-templates.ts src/lib/email-templates.test.ts
git commit -m "feat(email): pure HTML builders for design request/confirmation/delivery emails"
```

---

### Task 3: Email validation helper + notify orchestration + wire the request POST route

Add a tested `isValidEmail` helper, a non-throwing `notify.ts` orchestration layer, and send team + confirmation emails after a request is created. Add the `DESIGN_TEAM_EMAIL` env var to the example file.

**Files:**
- Create: `src/lib/validation/email.ts`
- Test: `src/lib/validation/email.test.ts`
- Create: `src/lib/design/notify.ts`
- Modify: `src/app/api/design-tickets/route.ts`
- Modify: `.env.example` (after the Zoho block, ~line 52)

**Interfaces:**
- Consumes: `sendMail` from `@/lib/email`; the three builders + input types from `@/lib/email-templates`; `designTickets.deliveryEmail` (Task 1).
- Produces:
  ```ts
  // src/lib/validation/email.ts
  export function isValidEmail(value: string): boolean;
  // src/lib/design/notify.ts
  export function getDesignTeamEmail(): string;
  export function appUrl(path: string): string;
  export function sendDesignRequestEmails(input: DesignRequestEmailInput): Promise<void>;
  export function sendDesignDeliveryEmail(args: { to: string; input: DesignDeliveryEmailInput }): Promise<void>;
  ```
  Both `send*` functions catch and log all errors internally and always resolve (never reject).

- [ ] **Step 1: Write the failing test for `isValidEmail`**

Create `src/lib/validation/email.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("ada@example.com")).toBe(true);
    expect(isValidEmail("  ada@example.com  ")).toBe(true);
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["", "ada", "ada@", "@example.com", "a b@x.com", "ada@example"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/validation/email.test.ts`
Expected: FAIL — module `./email` not found.

- [ ] **Step 3: Implement `isValidEmail`**

Create `src/lib/validation/email.ts`:

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lightweight email shape check (not RFC-exhaustive; guards obvious typos). */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/validation/email.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Implement the notify orchestration**

Create `src/lib/design/notify.ts`:

```ts
import {
  type DesignDeliveryEmailInput,
  type DesignRequestEmailInput,
  designDeliveryEmail,
  designRequestConfirmationEmail,
  designRequestTeamEmail,
} from "@/lib/email-templates";
import { sendMail } from "@/lib/email";

/** Design-team inbox. Env-only for now; Feature 3 will layer app_settings on top. */
export function getDesignTeamEmail(): string {
  return (
    process.env.DESIGN_TEAM_EMAIL ||
    process.env.ZOHO_MAIL_FROM ||
    process.env.ZOHO_SMTP_USER ||
    ""
  ).trim();
}

/** Absolute app URL for links inside emails. */
export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Notify the design team and confirm to the requester. Never throws — a mail
 * failure is logged and swallowed so it cannot fail ticket creation.
 */
export async function sendDesignRequestEmails(
  input: DesignRequestEmailInput,
): Promise<void> {
  const team = getDesignTeamEmail();
  if (team) {
    try {
      const { subject, html } = designRequestTeamEmail(input);
      await sendMail({ to: team, subject, html, replyTo: input.requesterEmail });
    } catch (err) {
      console.error("design request team email failed", {
        ticketNumber: input.ticketNumber,
        err,
      });
    }
  } else {
    console.warn(
      "design request: no design team email configured; skipping team notification",
      { ticketNumber: input.ticketNumber },
    );
  }

  const requesterTo = input.deliveryEmail || input.requesterEmail;
  try {
    const { subject, html } = designRequestConfirmationEmail(input);
    await sendMail({ to: requesterTo, subject, html });
  } catch (err) {
    console.error("design request confirmation email failed", {
      ticketNumber: input.ticketNumber,
      to: requesterTo,
      err,
    });
  }
}

/** Email the finished design. Never throws. */
export async function sendDesignDeliveryEmail(args: {
  to: string;
  input: DesignDeliveryEmailInput;
}): Promise<void> {
  try {
    const { subject, html } = designDeliveryEmail(args.input);
    await sendMail({ to: args.to, subject, html });
  } catch (err) {
    console.error("design delivery email failed", {
      ticketNumber: args.input.ticketNumber,
      to: args.to,
      err,
    });
  }
}
```

- [ ] **Step 6: Wire the design-tickets POST route**

In `src/app/api/design-tickets/route.ts`:

(a) Add imports at the top (merge with existing import block):

```ts
import { isValidEmail } from "@/lib/validation/email";
import { appUrl, sendDesignRequestEmails } from "@/lib/design/notify";
```

(b) Add `deliveryEmail` to the `Body` interface:

```ts
interface Body {
  brandId?: string;
  calendarItemId?: string | null;
  designType?: string;
  dimensions?: string | null;
  slides?: number | null;
  brief?: string;
  notes?: string | null;
  dueDate?: string | null;
  deliveryEmail?: string | null;
}
```

(c) After the brand ownership check and before the calendar-item block, validate the delivery email:

```ts
  const deliveryEmail = body.deliveryEmail?.trim() || null;
  if (deliveryEmail && !isValidEmail(deliveryEmail)) {
    return Response.json(
      { error: "Enter a valid delivery email address." },
      { status: 400 },
    );
  }
```

(d) Pass `deliveryEmail` into `createDesignTicket` (add the field to the object passed at the existing call):

```ts
    const ticket = await createDesignTicket({
      brandId: brand.id,
      userId: dbUser.id,
      calendarItemId,
      designType,
      dimensions: body.dimensions ?? null,
      slides: body.slides ?? null,
      brief,
      notes: body.notes ?? null,
      deliveryEmail,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: "submitted",
    });
```

(e) After the existing `recordUsageEvent(...)` call and before `return Response.json({ ticket })`, send the emails (awaited, non-throwing):

```ts
    await sendDesignRequestEmails({
      ticketNumber: ticket.ticketNumber,
      requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
      requesterEmail: dbUser.email,
      deliveryEmail: ticket.deliveryEmail,
      brandName: brand.name,
      designType: ticket.designType,
      dimensions: ticket.dimensions,
      slides: ticket.slides,
      brief: ticket.brief,
      notes: ticket.notes,
      dueDate: ticket.dueDate,
      adminUrl: appUrl("/admin/tickets"),
      ticketUrl: appUrl(`/design-request/${ticket.id}`),
    });
```

(Note: `adminUrl` points at the queue today; Feature 3 adds a per-ticket admin page and can swap this to `/admin/tickets/${ticket.id}`.)

- [ ] **Step 7: Add the env var to `.env.example`**

In `.env.example`, after the Zoho block (the `ZOHO_MAIL_FROM=` line, ~52), add:

```
# Design team inbox that receives new design-request notifications.
# Optional — falls back to ZOHO_MAIL_FROM / ZOHO_SMTP_USER.
DESIGN_TEAM_EMAIL=
```

- [ ] **Step 8: Typecheck, lint, full test suite**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run lint`
Expected: no errors in the files touched by this task.
Run: `npm test`
Expected: PASS — including the new `email.test.ts` and `email-templates.test.ts`.

(The orchestration in `notify.ts` and the route wiring hit SMTP and the session/DB, so they are verified by types + lint here and by the manual check in Task 5's final step, not by a unit test — mocking nodemailer would only assert the mock. The email *content* guarantee is already covered by Task 2's template tests.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/email.ts src/lib/validation/email.test.ts src/lib/design/notify.ts src/app/api/design-tickets/route.ts .env.example
git commit -m "feat(design): send team + confirmation emails on design request; validate delivery email"
```

---

### Task 4: Add the optional delivery-email field to the request modal

**Files:**
- Modify: `src/app/(dashboard)/calendar/request-design-modal.tsx`

**Interfaces:**
- Consumes: `isValidEmail` from `@/lib/validation/email`.
- Produces: the modal collects an optional `deliveryEmail`, validates it client-side, and includes `deliveryEmail: <trimmed> | null` in the POST body.

- [ ] **Step 1: Add state + reset**

(a) Add the import (merge with existing imports):

```ts
import { isValidEmail } from "@/lib/validation/email";
```

(b) Add state next to the other field state (after the `dueDate` state, line 135):

```ts
  const [deliveryEmail, setDeliveryEmail] = useState("");
```

(c) In the prefill `useEffect` (after `setDueDate(defaultDueDate(item.date));`, line 149), reset it:

```ts
    setDeliveryEmail("");
```

- [ ] **Step 2: Validate on submit**

In `handleSubmit`, immediately after `setError(null);` (line 158) and before the `try`, add:

```ts
    const trimmedDeliveryEmail = deliveryEmail.trim();
    if (trimmedDeliveryEmail && !isValidEmail(trimmedDeliveryEmail)) {
      setSubmitting(false);
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
```

Then include it in the POST body (add to the JSON object alongside `notes`):

```ts
          notes: notes.trim() || null,
          deliveryEmail: trimmedDeliveryEmail || null,
```

- [ ] **Step 3: Render the field**

Add this block immediately after the Due Date field's closing `</div>` (after line 429, before the `{error && (` block):

```tsx
              <div className="space-y-1.5">
                <Label htmlFor="rd-delivery-email">
                  Receive updates &amp; final design at (Optional)
                </Label>
                <Input
                  id="rd-delivery-email"
                  type="email"
                  value={deliveryEmail}
                  disabled={submitting}
                  onChange={(e) => setDeliveryEmail(e.target.value)}
                  placeholder="you@company.com"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Leave blank to use your account email.
                </p>
              </div>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run lint`
Expected: no errors for `request-design-modal.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/calendar/request-design-modal.tsx"
git commit -m "feat(design): optional delivery-email field on the request modal"
```

(No component test: the modal wraps a `@base-ui` `Dialog` with `sonner`/`next-navigation` dependencies and has no existing test harness; the validation logic it uses — `isValidEmail` — is unit-tested in Task 3. Field behavior is confirmed in the manual check in Task 5.)

---

### Task 5: Send the delivery email on deliverables upload

**Files:**
- Modify: `src/app/api/admin/tickets/[id]/deliverables/route.ts`

**Interfaces:**
- Consumes: `getUserById` from `@/lib/db/queries`; `getSignedReadUrl` from `@/lib/storage`; `appUrl`, `sendDesignDeliveryEmail` from `@/lib/design/notify`; `ticket.deliveryEmail` (Task 1); the `rows` array already built in this route.
- Produces: on a successful deliverables upload, a delivery email is sent (non-blocking) to `ticket.deliveryEmail || owner.email` with 7-day signed links.

- [ ] **Step 1: Add imports**

Merge into the existing import block:

```ts
import {
  addDeliverables,
  createNotification,
  getDesignTicketById,
  getUserById,
  updateDesignTicket,
} from "@/lib/db/queries";
import {
  getSignedReadUrl,
  isStorageConfigured,
  STORAGE_PREFIXES,
  uploadObject,
} from "@/lib/storage";
import { appUrl, sendDesignDeliveryEmail } from "@/lib/design/notify";
```

- [ ] **Step 2: Send the delivery email after the notification**

After the existing `await createNotification({...})` block and before `return Response.json({ ok: true, count: rows.length });`, add:

```ts
  const owner = await getUserById(ticket.userId);
  const deliverTo = ticket.deliveryEmail || owner?.email;
  if (deliverTo) {
    try {
      const links = await Promise.all(
        rows.map(async (r) => ({
          fileName: r.fileName,
          url: await getSignedReadUrl(r.fileUrl, 60 * 60 * 24 * 7),
        })),
      );
      await sendDesignDeliveryEmail({
        to: deliverTo,
        input: {
          ticketNumber: ticket.ticketNumber,
          designType: ticket.designType,
          links,
          ticketUrl: appUrl(`/design-request/${ticket.id}`),
        },
      });
    } catch (err) {
      console.error("design delivery email prep failed", {
        ticketId: ticket.id,
        err,
      });
    }
  }
```

(`sendDesignDeliveryEmail` already swallows send errors; the outer try/catch guards signed-URL generation so a link-signing failure cannot fail the upload response.)

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run lint`
Expected: no errors for the deliverables route.
Run: `npm test`
Expected: PASS — full suite (no new tests here; behavior verified manually below).

- [ ] **Step 4: Manual verification (needs a real environment)**

Live email delivery cannot be asserted by unit tests — it requires configured Zoho SMTP + a database. In a `.env`-configured dev/staging environment, confirm the end-to-end flow:
  1. Submit a design request with a delivery email → the requester (delivery) address receives a "Request received — DT-#####" email whose body shows brand, design type, dimensions, slides, brief, notes, due date; and `DESIGN_TEAM_EMAIL` receives a "New design request — DT-#####" email with the same details, a reply-to of the requester, and a queue link. Check the `design_tickets` row has the expected `delivery_email`.
  2. Submit a request with the field left blank → both emails go to / reference the account email; the `delivery_email` column is null.
  3. Submit an invalid delivery email → the modal blocks with the inline error and no ticket is created.
  4. As a designer/admin, upload deliverables → the delivery address (or account email fallback) receives a "Your design is ready — DT-#####" email whose links download the files; the existing `design_ready` in-app notification still fires; the ticket flips to `ready_for_review`.
  5. Temporarily unset SMTP env → submitting a request still succeeds (ticket created, HTTP 200) and the failure is logged, not surfaced to the user.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/tickets/[id]/deliverables/route.ts"
git commit -m "feat(design): email finished design with signed links on deliverables upload"
```

---

## Self-Review notes

- **Spec coverage:** optional delivery email field (Task 4) ✓; persisted on ticket (Task 1) ✓; team notification on submit (Task 3) ✓; requester confirmation (Task 3) ✓; final delivery email with links (Task 5) ✓; "includes all data required for proper delivery" proven by template unit tests (Task 2) ✓; team address env with fallback, Feature-3-ready (Task 3 `getDesignTeamEmail`) ✓; SMTP secrets stay in env ✓; non-blocking sends ✓.
- **Type consistency:** `DesignRequestEmailInput` / `DesignDeliveryEmailInput` defined in Task 2 and consumed unchanged by `notify.ts` (Task 3) and the two routes (Tasks 3, 5). `isValidEmail` defined in Task 3, used by both the route (Task 3) and the modal (Task 4). `deliveryEmail` column (Task 1) read as `ticket.deliveryEmail` in Tasks 3 and 5.
- **Recipient resolution** is identical everywhere: team via `getDesignTeamEmail()`, requester/delivery via `deliveryEmail || accountEmail`.
- **No placeholders:** every code step contains complete code, including the hand-written `drizzle/0002_add_delivery_email.sql` DDL.
