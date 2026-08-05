# Design Request Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single-page design request form at `/design-request/new` with drafts, presigned multi-file uploads, reference links, structured specs, AI brief polish, priority-based ETA, and updated dashboard/list entry points.

**Architecture:** Extend the existing `design_tickets` pipeline additively — new columns (`title`, `specs`), a `design_ticket_attachments` table, a `draft` status, presigned R2 PUT uploads, and an extended creation path — so the admin queue, review flow, emails, and analytics keep working untouched.

**Tech Stack:** Next.js 16 App Router, Drizzle + hand-written SQL migrations, zod 4, vitest, Cloudflare R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, AI SDK v6 (`generateObject`), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-05-design-request-workflow-design.md`

## Global Constraints

- Follow CLAUDE.md commenting norms: no "what" comments, only "why".
- Run `corepack pnpm` — never bare `pnpm` (Windows binary on PATH) and never npm.
- Migrations: hand-written SQL in `drizzle/0016_*.sql`, applied by `scripts/migrate.mjs` (transactional; `ALTER TYPE ... ADD VALUE` is fine because the new value is not used in the same file).
- Any `generateObject` call MUST set `maxOutputTokens` explicitly (Bedrock 4096 default truncates JSON).
- Status display labels: `ready_for_review` → "Client Review", `delivered` → "Completed", new `draft` → "Draft".
- ETA copy: urgent "within 4 business hours", high "within 12 hours", normal "within 24 hours", low "within 48 hours".
- Upload limits: 100 MB/file (`MAX_UPLOAD_BYTES`), 10 files (`MAX_UPLOAD_FILES`); allowlist images/PDF/DOCX/video/ZIP.
- New-form request types (verbatim, 16): Social Media Post, Carousel, Flyer, Poster, Banner, Presentation, Logo, Brand Identity, Business Card, Packaging, Video Thumbnail, Video Editing, Motion Graphics, UI/UX Design, Website Design, Custom Request.
- Drafts: excluded from admin queue (already true — `QUEUE_STATUSES` is an explicit list), excluded from dashboard `ticketCounts`, skip emails/usage events until submitted.
- Dark-first theming: use existing token classes (`bg-surface-1`, `text-foreground`, `--status-*-fg`); never hardcoded light hexes.
- Commit after each task; branch `feat/design-request-system`.

---

### Task 1: Status model, filters, ETA, request types (pure logic)

**Files:**
- Modify: `src/lib/design/tickets-ui.ts`
- Modify: `src/lib/design/tickets-ui.test.ts`
- Modify: `src/lib/dashboard/summary.ts` (`ticketCounts` draft exclusion)
- Check consumers: `grep -rn "DESIGN_TYPE_OPTIONS\|humanizeStatus\|matchesTicketFilter\|TICKET_FILTERS" src/`

**Interfaces (produces):**
- `TicketStatus` union gains `"draft"`.
- `TicketFilter` union gains `"draft"`; `TICKET_FILTERS` = `["all","draft","submitted","in_progress","delivered"]`.
- `humanizeStatus`: draft→"Draft", ready_for_review→"Client Review", delivered→"Completed"; filter label delivered→"Completed", draft→"Drafts".
- `priorityEta(p: TicketPriority): string` — new export with the four SLA strings.
- `DESIGN_TYPE_OPTIONS` replaced by the 16 spec options (same export name; free-text column so consumers keep working — verify the grep hits render generically).

- [ ] **Step 1: Write failing tests** in `tickets-ui.test.ts` (append to existing suite):

```ts
describe("draft status", () => {
  it("labels draft, client review, completed", () => {
    expect(humanizeStatus("draft")).toBe("Draft");
    expect(humanizeStatus("ready_for_review")).toBe("Client Review");
    expect(humanizeStatus("delivered")).toBe("Completed");
  });
  it("draft filter matches only drafts", () => {
    expect(matchesTicketFilter("draft", "draft")).toBe(true);
    expect(matchesTicketFilter("draft", "all")).toBe(true);
    expect(matchesTicketFilter("draft", "submitted")).toBe(false);
    expect(matchesTicketFilter("submitted", "draft")).toBe(false);
  });
});

describe("priorityEta", () => {
  it("maps priorities to SLA copy", () => {
    expect(priorityEta("urgent")).toBe("within 4 business hours");
    expect(priorityEta("high")).toBe("within 12 hours");
    expect(priorityEta("normal")).toBe("within 24 hours");
    expect(priorityEta("low")).toBe("within 48 hours");
  });
});

describe("request type options", () => {
  it("has the 16 spec options ending in Custom Request", () => {
    expect(DESIGN_TYPE_OPTIONS).toHaveLength(16);
    expect(DESIGN_TYPE_OPTIONS[0]).toBe("Social Media Post");
    expect(DESIGN_TYPE_OPTIONS.at(-1)).toBe("Custom Request");
    expect(isCarouselType("Carousel")).toBe(true);
  });
});
```

Also in `src/lib/dashboard/summary.test.ts` (or the file holding `ticketCounts` tests — grep first):

```ts
it("excludes drafts from all counts", () => {
  const c = ticketCounts([
    { status: "draft" },
    { status: "submitted" },
    { status: "delivered" },
  ]);
  expect(c).toEqual({ open: 1, delivered: 1, total: 2 });
});
```

- [ ] **Step 2:** `corepack pnpm test -- tickets-ui` → expect FAIL (draft not assignable / priorityEta undefined).
- [ ] **Step 3: Implement** in `tickets-ui.ts`: add `"draft"` to `TicketStatus` and `TicketFilter`; add `draft` to `TICKET_FILTERS` (after "all"), `FILTER_LABELS` (`draft: "Drafts"`, `delivered: "Completed"`), `STATUS_LABELS` (`draft: "Draft"`, relabels above); `matchesTicketFilter` gains `case "draft": return status === "draft";` and `"all"` keeps returning true; add:

```ts
const PRIORITY_ETA: Record<TicketPriority, string> = {
  urgent: "within 4 business hours",
  high: "within 12 hours",
  normal: "within 24 hours",
  low: "within 48 hours",
};

/** Response-time promise shown on the submission success screen. */
export function priorityEta(p: TicketPriority): string {
  return PRIORITY_ETA[p] ?? PRIORITY_ETA.normal;
}
```

Replace `DESIGN_TYPE_OPTIONS` values with the 16 Global-Constraints options. In `summary.ts`, `ticketCounts` skips `status === "draft"` rows entirely.
- [ ] **Step 4:** `corepack pnpm test` → all pass (fix any consumer type errors surfaced by `corepack pnpm exec tsc --noEmit`; the switch in `matchesTicketFilter` and any `Record<TicketStatus, …>` maps like the status badge will need the new key).
- [ ] **Step 5: Commit** `feat: draft status, relabels, priority ETA, new request types`

### Task 2: Request-form schema module (pure logic)

**Files:**
- Create: `src/lib/design/request-form.ts`
- Create: `src/lib/design/request-form.test.ts`

**Interfaces (produces — later tasks import these exact names):**

```ts
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20; // files + links combined
export type DesignTicketSpecs = z.infer<typeof specsSchema>;
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;
export type DesignRequestInput = z.infer<typeof designRequestSchema>;
export type DraftRequestInput = z.infer<typeof draftRequestSchema>;
export function isAllowedUpload(fileName: string, mimeType: string): boolean;
export function buildAttachmentKey(userId: string, fileName: string, rand: string): string;
export function attachmentKeyBelongsToUser(key: string, userId: string): boolean;
export const presignRequestSchema: z.ZodType<...>;
```

- [ ] **Step 1: Write failing tests** `request-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  attachmentKeyBelongsToUser, buildAttachmentKey, designRequestSchema,
  draftRequestSchema, isAllowedUpload, presignRequestSchema,
} from "./request-form";

const base = {
  brandId: "0b6f1c2e-1111-4222-8333-444455556666",
  requestType: "Flyer",
  title: "Launch flyer",
  brief: "A flyer for our launch.",
  priority: "normal" as const,
  attachments: [],
};

describe("designRequestSchema", () => {
  it("accepts a complete submission", () => {
    expect(designRequestSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a missing brief", () => {
    expect(designRequestSchema.safeParse({ ...base, brief: "" }).success).toBe(false);
  });
  it("accepts file and link attachments with categories and notes", () => {
    const parsed = designRequestSchema.safeParse({
      ...base,
      specs: { platform: "Instagram", orientation: "portrait", deliverablesCount: 3 },
      attachments: [
        { kind: "file", key: "reference-images/u1/a-logo.png", fileName: "logo.png",
          mimeType: "image/png", sizeBytes: 1024, category: "asset" },
        { kind: "link", url: "https://drive.google.com/file/d/x", category: "reference",
          note: "Love the color blocking" },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects non-http link protocols", () => {
    const bad = { ...base, attachments: [{ kind: "link", url: "javascript:alert(1)", category: "reference" }] };
    expect(designRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("draftRequestSchema", () => {
  it("allows missing fields when title present", () => {
    expect(draftRequestSchema.safeParse({ brandId: base.brandId, title: "wip" }).success).toBe(true);
  });
  it("rejects a draft with neither title nor brief", () => {
    expect(draftRequestSchema.safeParse({ brandId: base.brandId }).success).toBe(false);
  });
});

describe("uploads", () => {
  it("allows the spec's file families", () => {
    for (const [name, mime] of [
      ["a.png", "image/png"], ["b.pdf", "application/pdf"],
      ["c.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["d.mp4", "video/mp4"], ["e.zip", "application/zip"],
    ] as const) expect(isAllowedUpload(name, mime)).toBe(true);
  });
  it("rejects executables and mismatched extensions", () => {
    expect(isAllowedUpload("evil.exe", "application/octet-stream")).toBe(false);
    expect(isAllowedUpload("evil.png.exe", "image/png")).toBe(false);
  });
  it("caps size via presignRequestSchema", () => {
    expect(presignRequestSchema.safeParse({
      brandId: base.brandId, fileName: "a.png", mimeType: "image/png",
      sizeBytes: 101 * 1024 * 1024,
    }).success).toBe(false);
  });
  it("namespaces keys per user and verifies ownership", () => {
    const key = buildAttachmentKey("user-1", "My Logo!.png", "abc123");
    expect(key.startsWith("reference-images/user-1/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(attachmentKeyBelongsToUser(key, "user-1")).toBe(true);
    expect(attachmentKeyBelongsToUser(key, "user-2")).toBe(false);
    expect(attachmentKeyBelongsToUser("reference-images/user-11/x.png", "user-1")).toBe(false);
  });
});
```

- [ ] **Step 2:** `corepack pnpm test -- request-form` → FAIL (module missing).
- [ ] **Step 3: Implement** `request-form.ts`:

```ts
/** Shared client/server validation for the single-page design request form.
 * Framework-free so it's unit-tested. */
import { z } from "zod";
import { STORAGE_PREFIXES } from "@/lib/storage";

export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

const ALLOWED_UPLOADS: Record<string, string[]> = {
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
  webp: ["image/webp"], gif: ["image/gif"], svg: ["image/svg+xml"],
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  mp4: ["video/mp4"], mov: ["video/quicktime"], webm: ["video/webm"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

export function isAllowedUpload(fileName: string, mimeType: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ALLOWED_UPLOADS[ext]?.includes(mimeType.toLowerCase()) ?? false;
}

export function buildAttachmentKey(userId: string, fileName: string, rand: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "bin";
  return `${STORAGE_PREFIXES.referenceImages}/${userId}/${rand}.${ext}`;
}

export function attachmentKeyBelongsToUser(key: string, userId: string): boolean {
  return key.startsWith(`${STORAGE_PREFIXES.referenceImages}/${userId}/`);
}

export const specsSchema = z.object({
  platform: z.string().max(100).optional(),
  dimensions: z.string().max(100).optional(),
  orientation: z.enum(["portrait", "landscape", "square"]).optional(),
  fileFormat: z.string().max(50).optional(),
  deliverablesCount: z.number().int().min(1).max(50).optional(),
});
export type DesignTicketSpecs = z.infer<typeof specsSchema>;

const attachmentCommon = {
  category: z.enum(["asset", "reference"]),
  note: z.string().max(1000).optional(),
};
export const attachmentInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    key: z.string().min(1).max(500),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    ...attachmentCommon,
  }),
  z.object({
    kind: z.literal("link"),
    url: z.url({ protocol: /^https?$/ }).max(2000),
    ...attachmentCommon,
  }),
]);
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const designRequestSchema = z.object({
  brandId: z.uuid(),
  requestType: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(20000),
  dueDate: z.iso.date().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  specs: specsSchema.optional(),
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS).default([]),
});
export type DesignRequestInput = z.infer<typeof designRequestSchema>;

export const draftRequestSchema = designRequestSchema
  .partial()
  .extend({ brandId: z.uuid() })
  .refine((d) => Boolean(d.title?.trim() || d.brief?.trim()), {
    message: "Add a title or brief before saving a draft.",
  });
export type DraftRequestInput = z.infer<typeof draftRequestSchema>;

export const presignRequestSchema = z.object({
  brandId: z.uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
```

(Adjust zod-4 API details — `z.url({ protocol })`, `z.iso.date()` — to whatever compiles; the tests define the behavior.)
- [ ] **Step 4:** `corepack pnpm test -- request-form` → PASS.
- [ ] **Step 5: Commit** `feat: design request form validation module`

### Task 3: Migration 0016 + schema.ts + queries

**Files:**
- Create: `drizzle/0016_design_request_form.sql`
- Modify: `src/lib/db/schema.ts` (enum :86-93, designTickets :389-421, new table after designBriefs)
- Modify: `src/lib/db/queries/index.ts` (after the Design Tickets section :715)

**Interfaces (produces):**
- `designTicketStatusEnum` includes `"draft"`; `designTickets.title`, `designTickets.specs` (jsonb, `$type<DesignTicketSpecs>()`).
- `designTicketAttachments` table export.
- Queries: `addTicketAttachments(rows)`, `listTicketAttachments(ticketId)`, `replaceTicketAttachments(ticketId, rows)`, `updateDraftTicket(id, data)` (updates only `status='draft'` rows, returns row or undefined), `deleteDraftTicket(id)`.

- [ ] **Step 1: Migration SQL:**

```sql
ALTER TYPE "design_ticket_status" ADD VALUE IF NOT EXISTS 'draft';
--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "specs" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "design_ticket_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "design_tickets"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "category" text NOT NULL DEFAULT 'asset',
  "file_key" text,
  "file_name" text,
  "mime_type" text,
  "size_bytes" integer,
  "url" text,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_ticket_attachments_ticket_idx"
  ON "design_ticket_attachments" ("ticket_id");
```

NOTE: `ALTER TYPE ... ADD VALUE` runs inside the runner's transaction — legal on PG ≥12 as long as the value isn't used later in the same file; it isn't.
- [ ] **Step 2: schema.ts** — add `"draft"` to `designTicketStatusEnum`, add to `designTickets`: `title: text("title")`, `specs: jsonb("specs").$type<DesignTicketSpecs>()` (import type from `@/lib/design/request-form`; check `jsonb` is already imported — brand_memory/design_generations use it). New table:

```ts
/** Inbound client uploads and pasted links attached to a design request.
 * `kind` file rows carry file_* columns; link rows carry url. */
export const designTicketAttachments = pgTable("design_ticket_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => designTickets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().$type<"file" | "link">(),
  category: text("category").notNull().default("asset").$type<"asset" | "reference">(),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  url: text("url"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 3: queries** in `src/lib/db/queries/index.ts` (import `designTicketAttachments`):

```ts
export async function addTicketAttachments(
  rows: (typeof designTicketAttachments.$inferInsert)[],
) {
  if (rows.length === 0) return [];
  return db.insert(designTicketAttachments).values(rows).returning();
}

export async function listTicketAttachments(ticketId: string) {
  return db
    .select()
    .from(designTicketAttachments)
    .where(eq(designTicketAttachments.ticketId, ticketId))
    .orderBy(designTicketAttachments.createdAt);
}

export async function replaceTicketAttachments(
  ticketId: string,
  rows: (typeof designTicketAttachments.$inferInsert)[],
) {
  await db
    .delete(designTicketAttachments)
    .where(eq(designTicketAttachments.ticketId, ticketId));
  return addTicketAttachments(rows);
}

export async function updateDraftTicket(
  id: string,
  data: Partial<
    Pick<
      typeof designTickets.$inferInsert,
      | "title" | "designType" | "brief" | "notes" | "priority" | "specs"
      | "dueDate" | "dimensions" | "slides" | "status" | "brandId"
    >
  >,
) {
  const [row] = await db
    .update(designTickets)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(designTickets.id, id), eq(designTickets.status, "draft")))
    .returning();
  return row ?? null;
}

export async function deleteDraftTicket(id: string) {
  const [row] = await db
    .delete(designTickets)
    .where(and(eq(designTickets.id, id), eq(designTickets.status, "draft")))
    .returning();
  return row ?? null;
}
```

- [ ] **Step 4: Verify** — `corepack pnpm exec tsc --noEmit` clean; `corepack pnpm db:migrate` against local Postgres → `applied 0016_design_request_form.sql`.
- [ ] **Step 5: Commit** `feat: draft status, ticket title/specs, attachments table`

### Task 4: Presigned upload endpoint

**Files:**
- Modify: `src/lib/storage.ts` (add `getSignedUploadUrl`)
- Create: `src/app/api/uploads/presign/route.ts`

**Interfaces:**
- Consumes: `presignRequestSchema`, `isAllowedUpload`, `buildAttachmentKey` (Task 2); `checkBrandAccess`, `checkRateLimit`/`tooManyRequests`.
- Produces: `POST /api/uploads/presign` → `{ key, url }` (PUT URL, 15 min expiry) | 4xx `{ error }`.

- [ ] **Step 1: storage.ts** addition:

```ts
/** Short-lived signed PUT URL so the browser uploads directly to R2,
 * bypassing the serverless request-body limit. */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  return presign(
    client(),
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}
```

- [ ] **Step 2: Route** `src/app/api/uploads/presign/route.ts`:

```ts
import { randomBytes } from "node:crypto";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import {
  buildAttachmentKey, isAllowedUpload, presignRequestSchema,
} from "@/lib/design/request-form";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getSignedUploadUrl, isStorageConfigured } from "@/lib/storage";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!isStorageConfigured()) {
    return Response.json({ error: "File uploads are not available right now." }, { status: 503 });
  }

  const verdict = await checkRateLimit({
    key: `upload-presign:${dbUser.id}`,
    limit: 60,
    windowSeconds: 600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = presignRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid upload request" }, { status: 400 });
  }
  const { brandId, fileName, mimeType } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  if (!isAllowedUpload(fileName, mimeType)) {
    return Response.json(
      { error: "This file type is not supported." },
      { status: 400 },
    );
  }

  const key = buildAttachmentKey(dbUser.id, fileName, randomBytes(12).toString("hex"));
  const url = await getSignedUploadUrl(key, mimeType);
  return Response.json({ key, url });
}
```

- [ ] **Step 3: Verify** — `tsc --noEmit`; manual smoke later in Task 11 (verify skill drives the real browser).
- [ ] **Step 4: Commit** `feat: presigned R2 upload endpoint`

### Task 5: Extended ticket creation (submit + draft)

**Files:**
- Modify: `src/lib/design/ticket-create.ts`
- Modify: `src/lib/design/ticket-create.test.ts`
- Modify: `src/app/api/design-tickets/route.ts`

**Interfaces:**
- `CreateTicketFromRequestInput` gains `title?`, `priority?`, `specs?`, `attachments?: AttachmentInput[]`, `saveAsDraft?: boolean`.
- `CreateTicketFromRequestDeps` gains `addAttachments?: typeof dbAddTicketAttachments`.
- New export `submissionSideEffects(ticket, deps, input)` — usage event + emails, reused by draft-submit in Task 6. Draft creation skips it.
- Route `POST /api/design-tickets` accepts the new fields; validates with `designRequestSchema` / `draftRequestSchema` (when `saveAsDraft: true`); verifies every file attachment key with `attachmentKeyBelongsToUser(key, dbUser.id)` (403 otherwise); PostHog `design_ticket_submitted` only on real submits, new `design_ticket_draft_saved` for drafts.

- [ ] **Step 1: Failing tests** (extend existing `ticket-create.test.ts`, which already stubs deps — follow its fixture style):

```ts
it("creates a draft without emails or usage events", async () => {
  const { ticket } = await createTicketFromRequest(
    { ...baseInput, saveAsDraft: true, title: "WIP" },
    { ...deps, createDesignTicket: createStub, recordUsageEvent: usageSpy, sendEmails: emailSpy },
  );
  expect(createStub).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", title: "WIP" }));
  expect(usageSpy).not.toHaveBeenCalled();
  expect(emailSpy).not.toHaveBeenCalled();
});

it("persists attachments after ticket creation", async () => {
  const addAttachments = vi.fn().mockResolvedValue([]);
  await createTicketFromRequest(
    { ...baseInput, attachments: [
      { kind: "file", key: "reference-images/u/a.png", fileName: "a.png",
        mimeType: "image/png", sizeBytes: 1, category: "asset" },
      { kind: "link", url: "https://figma.com/f", category: "reference", note: "grid" },
    ] },
    { ...deps, addAttachments },
  );
  expect(addAttachments).toHaveBeenCalledWith([
    expect.objectContaining({ kind: "file", fileKey: "reference-images/u/a.png" }),
    expect.objectContaining({ kind: "link", url: "https://figma.com/f", note: "grid" }),
  ]);
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** In `ticket-create.ts`: pass `title/priority/specs` through to `createTicket`; `status: input.saveAsDraft ? "draft" : "submitted"`; after insert, map `AttachmentInput[]` → insert rows (`kind`, `category`, `note`, file → `fileKey/fileName/mimeType/sizeBytes`, link → `url`) with `ticketId: ticket.id` and call `deps.addAttachments ?? dbAddTicketAttachments` (best-effort try/catch like brief-linking? No — attachments are user data; let failure fail the request BEFORE emails). Extract the usage-event + email block into:

```ts
export async function submissionSideEffects(
  ticket: Awaited<ReturnType<typeof dbCreateDesignTicket>>,
  deps: CreateTicketFromRequestDeps,
  input: Pick<CreateTicketFromRequestInput, "userId" | "brandId" | "designType">,
) { /* moved recordUsageEvent + sendEmails code, unchanged */ }
```

and call it from `createTicketFromRequest` only when not draft. In the route: parse body with the zod schemas instead of hand checks (keep the calendar-item/brief/generation ownership blocks), key-ownership check on file attachments, pass new fields, emit the right PostHog event.
- [ ] **Step 4:** `corepack pnpm test` + `tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat: ticket creation supports title, specs, priority, attachments, drafts`

### Task 6: Draft update/submit/discard route

**Files:**
- Create: `src/app/api/design-tickets/[id]/route.ts` (PATCH + DELETE)

**Interfaces:**
- `PATCH` body = `DraftRequestInput & { submit?: boolean }`. Owner-only (`ticket.userId === dbUser.id`) AND `status === "draft"` (404 otherwise — don't leak existence). Re-validates with `designRequestSchema` when `submit: true` (400 with field errors if incomplete). Updates via `updateDraftTicket`, replaces attachments via `replaceTicketAttachments`, on submit flips `status: "submitted"` and calls `submissionSideEffects`. Returns `{ ticket }`.
- `DELETE` → owner-only draft delete via `deleteDraftTicket`, `{ ok: true }`.

- [ ] **Step 1: Implement route** (follow the auth/brand-access idiom of `POST /api/design-tickets`; brand access re-checked if `brandId` changes; every file attachment key re-checked with `attachmentKeyBelongsToUser`). On submit, fetch brand name via the access check result for the email payload, mirroring the POST route's deps.
- [ ] **Step 2: Verify** `tsc --noEmit` + lint.
- [ ] **Step 3: Commit** `feat: draft design requests can be updated, submitted, discarded`

### Task 7: Improve-with-AI endpoint

**Files:**
- Create: `src/lib/ai/prompts/improve-brief.ts`
- Create: `src/lib/ai/prompts/improve-brief.test.ts`
- Create: `src/app/api/design-tickets/improve-brief/route.ts`

**Interfaces:**
- `buildImproveBriefPrompt({ requestType, title, brandName, brief, specs }): { system, prompt }` — instructs: rewrite the client's raw brief into a clear, structured design brief (objective, audience, required text, style/colors, references, dimensions/platform, extra instructions), preserve every concrete fact, invent nothing, return plain text (no markdown headings beyond simple bold/bullets), same language as input.
- Route: auth → rate limit 20/10min (`improve-brief:${userId}`) → zod body `{ brandId: z.uuid(), requestType: string, title: string, brief: z.string().min(20).max(20000), specs: specsSchema.optional() }` → `checkBrandAccess` → `generateObject({ model: getModel("brand"), schema: z.object({ brief: z.string() }), maxOutputTokens: 3000, system, prompt })` → `{ brief }`. Mirror `brand/suggest/route.ts` error handling.

- [ ] **Step 1: Failing test** — prompt builder includes request type, brand name, and the raw brief; system mentions preserving facts:

```ts
it("builds a prompt carrying the form context", () => {
  const { system, prompt } = buildImproveBriefPrompt({
    requestType: "Flyer", title: "Launch", brandName: "Acme",
    brief: "need flyer for sat launch, red theme",
    specs: { platform: "Instagram" },
  });
  expect(prompt).toContain("Flyer");
  expect(prompt).toContain("Acme");
  expect(prompt).toContain("red theme");
  expect(system.toLowerCase()).toContain("preserve");
});
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement builder + route. **Step 4:** tests + `tsc` PASS. **Step 5: Commit** `feat: improve-with-AI brief polish endpoint`

### Task 8: The form page `/design-request/new`

**Files:**
- Create: `src/app/(dashboard)/design-request/new/page.tsx` (server)
- Create: `src/app/(dashboard)/design-request/new/request-form-client.tsx`
- Create: `src/app/(dashboard)/design-request/new/attachment-uploader.tsx`

**Interfaces:**
- Consumes: `DESIGN_TYPE_OPTIONS`, `priorityEta`, `humanizePriority`, schemas from `request-form.ts`, `formatTicketNumber`, endpoints from Tasks 4–7.
- Page props: server component loads `requireBrand()`, the workspace's accessible brands (grep for the query the brand switcher/sidebar uses — reuse it), and when `?draft=<id>` is present loads the draft ticket + its attachments (owner + draft checks; `notFound()` otherwise) and passes initial values.

**Form structure (one page, sections in spec order):**
1. Request Type — native `<select>` with the 16 options (label "What do you need designed?").
2. Project Information — title input, brand `<select>` (preselected when only one), due date `<input type="date">`, priority `<select>` (Low/Normal/High/Urgent via `humanizePriority`).
3. Design Brief — textarea (10 rows) with the spec's description + placeholder "Type or paste your design brief here..."; buttons **Improve with AI** (Sparkles icon; disabled under 20 chars; calls improve-brief, replaces textarea content, keeps an in-memory undo of the previous text) and **Save Draft**.
4. Upload Files (optional) — `attachment-uploader.tsx`: drag-drop zone + browse (`<input type="file" multiple>`), client-side `isAllowedUpload` + size check, per-file progress via `XMLHttpRequest` PUT to the presigned URL (fetch has no upload progress), remove buttons; plus a "Paste a link" input (Drive/Dropbox/Figma) adding link attachments (category "asset").
5. Design References (optional) — same uploader in category "reference" mode plus a "What do you like about these references?" textarea stored as the shared `note` on reference attachments.
6. Design Specifications (optional, collapsible) — platform, dimensions, orientation select, file format, deliverables count.
7. Actions — primary **Submit Request**, secondary **Save Draft**.

**Behavior contracts:**
- State lives in one `useState<FormState>`; localStorage autosave under `koos.design-request.form` (JSON of text fields only — no File objects), restored on mount when not editing a draft, cleared on successful submit (mirror `create-brand-form.tsx:107-127`).
- Save Draft → `POST /api/design-tickets` `{ ...values, saveAsDraft: true }` (or `PATCH /api/design-tickets/:id` when editing an existing draft) → toast "Draft saved", stay on page, store returned ticket id so later saves PATCH.
- Submit → client-side `designRequestSchema.safeParse` for inline field errors → POST (or PATCH `{ submit: true }`) → on success swap the form for the **success panel**: green check, `Request {formatTicketNumber(ticket.ticketNumber)}`, status badge ("Submitted"), `Estimated response time: {priorityEta(priority)}`, buttons **View Request** (`/design-request/${ticket.id}`) and **Return to Design Requests** (`/design-request`).
- Styling: follow `quick-request-form.tsx` field classes and section card layout (`rounded-2xl border border-[var(--border)] bg-surface-1 p-5`).

- [ ] **Step 1:** Build `attachment-uploader.tsx` (presign → XHR PUT → onChange callback with `AttachmentInput[]`).
- [ ] **Step 2:** Build `request-form-client.tsx` with the sections/behaviors above.
- [ ] **Step 3:** Build `page.tsx` (server load + draft hydration).
- [ ] **Step 4: Verify** — `tsc --noEmit`, `corepack pnpm lint`, then drive the page with the `verify` skill (dev server): create draft, resume draft, upload a png + paste a link, improve brief, submit, see success panel.
- [ ] **Step 5: Commit** `feat: single-page design request form with drafts and uploads`

### Task 9: Entry points — dashboard card, list page, badges

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx:381-415` (card) — heading **"Upload a Design Request"**, description paragraph *"Submit a new design request by typing or pasting your design brief, uploading your files, and sending everything directly to the creative team."*, CTA link **"Upload Request"** → `/design-request/new` (keep the 3-up counters; header link "View all" stays → `/design-request`).
- Modify: `src/app/(dashboard)/design-request/page.tsx:37-53` — both CTAs → `/design-request/new`.
- Modify: `src/app/(dashboard)/design-request/tickets-list-client.tsx` — draft rows link to `/design-request/new?draft=<id>`; others to detail as today. New "Drafts" filter tab comes free from `TICKET_FILTERS`; pass `title` through `TicketListRow` and show it when present (fall back to designType).
- Modify: `src/app/(dashboard)/design-request/ticket-status-badge.tsx` — add `draft` styling (neutral/muted token, adaptive `--status-*-fg` pattern — no hardcoded light hexes).

- [ ] **Step 1:** Implement all four edits. **Step 2:** `tsc` + lint + visual check via verify skill. **Step 3: Commit** `feat: new-form entry points and draft badges`

### Task 10: Detail pages render title, specs, attachments

**Files:**
- Modify: `src/app/(dashboard)/design-request/[id]/page.tsx`
- Modify: `src/app/admin/tickets/[id]/page.tsx`

Both: render `ticket.title` in the header when present; a "Specifications" definition list from `ticket.specs` (only non-empty keys); an "Attachments" section — `listTicketAttachments(ticket.id)`, file rows get `getSignedReadUrl(fileKey, 3600, { disposition: "attachment", fileName })` server-side and render name + human size + download link; link rows render the outbound URL (`rel="noopener noreferrer" target="_blank"`); reference-category items grouped under "References" with their `note`. Reuse one small server component if convenient: `src/app/(dashboard)/design-request/[id]/attachment-list.tsx` shared by both pages is fine (admin imports across route groups already happen — verify with grep; otherwise duplicate minimally).

- [ ] **Step 1:** Implement. **Step 2:** `tsc` + lint + verify-skill check on a ticket with files, links, and specs (both user and admin views). **Step 3: Commit** `feat: ticket detail shows title, specs, attachments`

### Task 11: Full verification

- [ ] `corepack pnpm lint` clean (run `corepack pnpm format` first if needed).
- [ ] `corepack pnpm test` all green.
- [ ] `corepack pnpm exec tsc --noEmit` clean.
- [ ] `corepack pnpm build` (runs migrations + env check) succeeds locally.
- [ ] End-to-end pass with the `verify` skill: dashboard card → form → draft save → resume → upload file + link + reference with note → improve with AI → submit → success panel (ID, status, ETA) → detail page shows everything → admin queue shows the ticket (drafts absent) → admin detail shows attachments → status advance shows "Client Review"/"Completed" labels.
- [ ] Commit any fixes; do NOT push or open a PR without the user's go-ahead.

## Self-Review Notes

- Spec coverage: dashboard card (T9), form sections 1–6 (T8), Improve with AI (T7), Save Draft (T5/T6/T8), uploads + links (T4/T8), references + notes (T8, `note` on reference attachments), specs (T2/T3/T8/T10), success screen with ID/status/ETA (T8), status display (T1), admin visibility (T10), priority-settable (T2/T5), drafts excluded from queue/counts (T1 + existing QUEUE_STATUSES).
- Type consistency: `AttachmentInput` (T2) → `CreateTicketFromRequestInput.attachments` (T5) → insert rows (T3 `designTicketAttachments.$inferInsert`); `priorityEta` defined T1, consumed T8; `submissionSideEffects` defined T5, consumed T6.
- Known judgment calls: zod-4 exact API for URL/date validators resolved at implementation time against the tests; brand-list query name resolved by grep in T8.
