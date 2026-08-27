import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { DesignTicketSpecs } from "@/lib/design/request-form";

// Human-readable, collision-free design ticket numbers (DT-#####).
export const designTicketNumberSeq = pgSequence("design_ticket_number_seq", {
  startWith: 1,
});

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const providerEnum = pgEnum("provider", ["email", "google"]);

export const onboardingTypeEnum = pgEnum("onboarding_type", [
  "manual",
  "document",
  "conversational",
]);

export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "draft",
  "in_progress",
  "completed",
]);

export const brandContextSectionEnum = pgEnum("brand_context_section", [
  "account_info",
  "business_overview",
  "audience",
  "brand_foundation",
  "products_services",
  "campaign_setup",
  "social_media",
  "review",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const conversationModeEnum = pgEnum("conversation_mode", [
  "strategy",
  "design",
]);

export const assetTypeEnum = pgEnum("asset_type", [
  "logo",
  "image",
  "document",
]);

export const userRoleEnum = pgEnum("user_role", ["user", "designer", "admin"]);

// Declared in descending privilege: Postgres orders an enum by declaration
// order, and the member listings sort on this column to surface the most
// privileged first. Mirrors WORKSPACE_ROLES in src/lib/auth/workspace-access.ts.
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "brand_manager",
  "contributor",
]);

export const brandScopeEnum = pgEnum("brand_scope", ["all", "assigned"]);

export const strategyStatusEnum = pgEnum("strategy_status", [
  "draft",
  "active",
  "archived",
]);

export const calendarItemStatusEnum = pgEnum("calendar_item_status", [
  "draft",
  "in_progress",
  "ready",
  "published",
]);

/** Whether an item came out of calendar generation or the user typed it in. */
export const calendarItemSourceEnum = pgEnum("calendar_item_source", [
  "ai",
  "manual",
]);

export const designTicketStatusEnum = pgEnum("design_ticket_status", [
  "draft",
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "design_ready",
  "ticket_status",
  "system",
]);

export const usageKindEnum = pgEnum("usage_kind", [
  "strategy_generated",
  "calendar_generated",
  "design_ticket_created",
  "design_generated",
]);

export const designGenerationSourceEnum = pgEnum("design_generation_source", [
  "chat_brief",
  "calendar_item",
  "quick",
  "brand",
]);

/** composite = AI background plate + server-rendered typography/logo overlay.
 * native = a text-capable image model renders the whole design in one call. */
export const designRendererEnum = pgEnum("design_renderer", [
  "composite",
  "native",
]);

export const designGenerationStatusEnum = pgEnum("design_generation_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash"),
  provider: providerEnum("provider").notNull().default("email"),
  avatarUrl: text("avatar_url"),
  preferences: jsonb("preferences"),
  role: userRoleEnum("role").notNull().default("user"),
  /** Null until the user confirms their address. Google accounts are
      verified at creation (Google already verified the inbox); accounts
      predating the feature were backfilled by migration 0011. */
  emailVerifiedAt: timestamp("email_verified_at"),
  /** Set once, the first time the user leaves the product tour — finished OR
      dismissed. Replays from Settings run via ?tour=1 and deliberately do not
      rewrite it. Accounts predating the tour were backfilled by migration 0021. */
  tourCompletedAt: timestamp("tour_completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Server-side sessions. `id` is the SHA-256 hash (hex) of the opaque token held
// in the client's httpOnly cookie — the raw token is never stored, so a DB read
// cannot be replayed as a session. See src/lib/auth/session.ts.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Single-use password-reset tokens. Stores only the SHA-256 hash of the raw
// token emailed to the user (same never-store-the-secret rule as sessions).
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Single-use email-verification tokens, same shape as password_reset_tokens:
// only the SHA-256 hash of the emailed token is stored.
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("contributor"),
    brandScope: brandScopeEnum("brand_scope").notNull().default("all"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  /* These CHECKs are the database-side half of the privilege rule: owners and
     admins are always workspace-wide, brand managers are always
     assignment-scoped. Modelled here, not just in the migration, so a
     `drizzle-kit push` cannot quietly drop them. */
  (t) => [
    unique().on(t.workspaceId, t.userId),
    index().on(t.userId),
    check(
      "workspace_members_privileged_scope_check",
      sql`${t.role} NOT IN ('owner', 'admin') OR ${t.brandScope} = 'all'`,
    ),
    check(
      "workspace_members_brand_manager_scope_check",
      sql`${t.role} <> 'brand_manager' OR ${t.brandScope} = 'assigned'`,
    ),
  ],
);

// Single-use invitation tokens. Stores only the SHA-256 hash of the raw token
// emailed to the invitee (same never-store-the-secret rule as sessions).
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("contributor"),
    brandScope: brandScopeEnum("brand_scope").notNull().default("all"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index().on(t.workspaceId),
    check(
      "workspace_invitations_privileged_scope_check",
      sql`${t.role} NOT IN ('owner', 'admin') OR ${t.brandScope} = 'all'`,
    ),
    check(
      "workspace_invitations_brand_manager_scope_check",
      sql`${t.role} <> 'brand_manager' OR ${t.brandScope} = 'assigned'`,
    ),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    onboardingType: onboardingTypeEnum("onboarding_type")
      .notNull()
      .default("manual"),
    onboardingStatus: onboardingStatusEnum("onboarding_status")
      .notNull()
      .default("draft"),
    completionPercentage: integer("completion_percentage").notNull().default(0),
    overview: text("overview"),
    businessType: text("business_type"),
    stage: text("stage"),
    targetAudience: text("target_audience"),
    offer: text("offer"),
    tone: text("tone"),
    primaryGoal: text("primary_goal"),
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),
    additionalColors: text("additional_colors").array(),
    logoUrl: text("logo_url"),
    // Section 3 — Brand Personality
    values: text("values"),
    wordsLove: text("words_love"),
    wordsAvoid: text("words_avoid"),
    // Section 4 — Visual Identity (extends colors/logoUrl above)
    hasLogo: boolean("has_logo"),
    brandStyle: text("brand_style"),
    // Section 5 — Competitors
    competitors: text("competitors"),
    competitorStrengths: text("competitor_strengths"),
    differentiators: text("differentiators"),
    // Section 6 — Platforms & Posting
    platforms: text("platforms").array(),
    primaryPlatform: text("primary_platform"),
    postingFrequency: text("posting_frequency"),
    // Section 7 — Anything Else
    additionalNotes: text("additional_notes"),
    helpfulLinks: text("helpful_links"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId)],
);

export const brandContexts = pgTable("brand_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  section: brandContextSectionEnum("section").notNull(),
  dataJson: jsonb("data_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const brandAssets = pgTable("brand_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  assetType: assetTypeEnum("asset_type").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chatConversations = pgTable("chat_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  /** The user renamed this chat by hand. Locks the title against the AI titler
   * and against the campaign-name rename on strategy generation. */
  titleCustom: boolean("title_custom").notNull().default(false),
  mode: conversationModeEnum("mode").notNull().default("strategy"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(
    () => chatConversations.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  structured: jsonb("structured"),
  status: strategyStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => strategies.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const calendarItems = pgTable(
  "calendar_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    time: text("time"),
    platform: text("platform").notNull(),
    contentType: text("content_type").notNull(),
    title: text("title").notNull(),
    /** Creative direction — what the post should accomplish. AI-written. */
    brief: text("brief"),
    /** The post copy itself, ready to publish. */
    caption: text("caption"),
    /** Internal reminders — not part of the post. Still visible to the
     * in-app assistant, which reads whole rows via list_calendar_items. */
    notes: text("notes"),
    designRequired: boolean("design_required").notNull().default(false),
    designType: text("design_type"),
    dimensions: text("dimensions"),
    status: calendarItemStatusEnum("status").notNull().default("draft"),
    source: calendarItemSourceEnum("source").notNull().default("ai"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.calendarId)],
);

export const designTickets = pgTable("design_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketNumber: integer("ticket_number")
    .notNull()
    .unique()
    .default(sql`nextval('design_ticket_number_seq')`),
  calendarItemId: uuid("calendar_item_id").references(() => calendarItems.id, {
    onDelete: "set null",
  }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedDesignerId: uuid("assigned_designer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  designType: text("design_type").notNull(),
  title: text("title"),
  dimensions: text("dimensions"),
  slides: integer("slides"),
  brief: text("brief").notNull(),
  notes: text("notes"),
  /** Optional structured deliverable specs from the request form; display-only,
   * so it stays schemaless jsonb rather than dedicated columns. */
  specs: jsonb("specs").$type<DesignTicketSpecs>(),
  deliveryEmail: text("delivery_email"),
  /** Generated design or user upload the designer should work from. Previously
   * this only survived as a line inside `brief`, so it was invisible to queries. */
  referenceImageUrl: text("reference_image_url"),
  dueDate: timestamp("due_date"),
  status: designTicketStatusEnum("status").notNull().default("submitted"),
  /** When the client last signed off. Never cleared — a later correction round
   * reopens the ticket for review but must not revoke files already earned. */
  approvedAt: timestamp("approved_at"),
  priority: ticketPriorityEnum("priority").notNull().default("normal"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** AI-generated design briefs pinned to a design-mode conversation, so a
 * brief survives the chat session and can be edited/resubmitted without
 * regenerating. ticketId records the most recent ticket submitted from it. */
export const designBriefs = pgTable("design_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  designType: text("design_type").notNull(),
  dimensions: text("dimensions"),
  slides: integer("slides"),
  briefMarkdown: text("brief_markdown").notNull(),
  notes: text("notes"),
  ticketId: uuid("ticket_id").references(() => designTickets.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Inbound client uploads and pasted links attached to a design request.
 * `file` rows carry the file_* columns (fileKey is an R2 object key, read via
 * signed URLs); `link` rows carry url. Distinct from design_deliverables,
 * which holds the studio's outbound files. */
export const designTicketAttachments = pgTable(
  "design_ticket_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => designTickets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<"file" | "link">(),
    category: text("category")
      .notNull()
      .default("asset")
      .$type<"asset" | "reference">(),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    url: text("url"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("design_ticket_attachments_ticket_idx").on(t.ticketId)],
);

/** One AI design generation. Makes a generation first-class so it has
 * provenance (which brief/calendar item and which model produced it), a
 * history surface, and a metering hook — none of which existed when
 * generated images were written straight to R2 and forgotten. */
export const designGenerations = pgTable(
  "design_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: designGenerationSourceEnum("source").notNull(),
    briefId: uuid("brief_id").references(() => designBriefs.id, {
      onDelete: "set null",
    }),
    calendarItemId: uuid("calendar_item_id").references(
      () => calendarItems.id,
      { onDelete: "set null" },
    ),
    designType: text("design_type"),
    /** Everything the user attached as context, in precedence order. The
     *  source enum and brief_id/calendar_item_id record only one primary
     *  reference, so this is what answers "what was this built from". */
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    spec: jsonb("spec").notNull(),
    renderer: designRendererEnum("renderer").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    imageKey: text("image_key"),
    /** Stored so the gallery can reserve correct aspect boxes without
     * parsing the spec jsonb on every render. */
    width: integer("width"),
    height: integer("height"),
    status: designGenerationStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index().on(t.brandId),
    index().on(t.briefId),
    index().on(t.calendarItemId),
  ],
);

export const designDeliverables = pgTable(
  "design_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => designTickets.id, { onDelete: "cascade" }),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name").notNull(),
    /** Position within the upload batch, unique per (ticketId, version). */
    slideIndex: integer("slide_index"),
    /** Delivery round. Every revision the studio uploads increments this. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("design_deliverables_ticket_version_idx").on(
      t.ticketId,
      t.version,
      t.slideIndex,
    ),
  ],
);

export const designAnnotations = pgTable(
  "design_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => designTickets.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => designDeliverables.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shapes: jsonb("shapes").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.ticketId)],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payload: jsonb("payload"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketUpdates = pgTable("ticket_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => designTickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  newStatus: designTicketStatusEnum("new_status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Singleton row (id is always 1) holding admin-editable app configuration.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  designTeamEmail: text("design_team_email"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const generationJobKindEnum = pgEnum("generation_job_kind", [
  "strategy",
  "calendar",
  "design_brief",
  "design_render",
]);

export const generationJobStatusEnum = pgEnum("generation_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

/* Async AI generation jobs. The generate routes create a row, return its id
   immediately (202), and run the actual model call after the response via
   next/server after(); the client polls /api/jobs/[id]. This keeps requests
   under proxy timeouts (Cloudflare cuts held connections at ~100s). */
export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: generationJobKindEnum("kind").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  status: generationJobStatusEnum("status").notNull().default("pending"),
  input: jsonb("input"),
  /** id of the created strategy/calendar once succeeded. */
  resultId: uuid("result_id"),
  /** Response payload the client would have received synchronously. */
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* Fixed-window rate limiting counters. One row per (endpoint, caller) key,
   e.g. "login:1.2.3.4" or "chat:<userId>". Rows are upserted atomically by
   hitRateLimit(); stale rows are harmless (the window check resets them). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "set null",
  }),
  kind: usageKindEnum("kind").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* One evolving row per brand: a rolling summary plus append-only facts,
   built up from onboarding and conversations for AI context. */
export const brandMemory = pgTable("brand_memory", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  facts: jsonb("facts").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* Brand assignments. Only consulted when the membership's brand_scope is
   'assigned', where an empty list means NO brands. Owners, admins, and
   workspace-wide contributors ignore this table entirely. */
export const memberBrandAccess = pgTable(
  "member_brand_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  /* The composite FK makes "grants die with the membership" structural rather
     than something every delete path has to remember. No extra index: the
     unique triple already covers (workspace_id, user_id) lookups. */
  (t) => [
    unique().on(t.workspaceId, t.userId, t.brandId),
    foreignKey({
      name: "mba_membership_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
  ],
);

/* The brands a pending invitation will grant on acceptance. Rows move into
   member_brand_access when the invite is accepted, then die with the
   invitation row. */
export const workspaceInvitationBrands = pgTable(
  "workspace_invitation_brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => workspaceInvitations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.invitationId, t.brandId)],
);
