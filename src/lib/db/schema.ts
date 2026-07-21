import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
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

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "member"]);

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

export const designTicketStatusEnum = pgEnum("design_ticket_status", [
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
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.userId), index().on(t.userId)],
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
    role: workspaceRoleEnum("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId)],
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

export const calendarItems = pgTable("calendar_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  time: text("time"),
  platform: text("platform").notNull(),
  contentType: text("content_type").notNull(),
  title: text("title").notNull(),
  brief: text("brief"),
  designRequired: boolean("design_required").notNull().default(false),
  designType: text("design_type"),
  dimensions: text("dimensions"),
  status: calendarItemStatusEnum("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  dimensions: text("dimensions"),
  slides: integer("slides"),
  brief: text("brief").notNull(),
  notes: text("notes"),
  deliveryEmail: text("delivery_email"),
  dueDate: timestamp("due_date"),
  status: designTicketStatusEnum("status").notNull().default("submitted"),
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

export const designDeliverables = pgTable("design_deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => designTickets.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  slideIndex: integer("slide_index"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

/* Per-brand restriction rows. ALWAYS EMPTY in v1 (no UI writes here).
   Default-open rule: a member with no rows sees every brand in the
   workspace; a member with rows sees only those brands. */
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
  },
  (t) => [unique().on(t.workspaceId, t.userId, t.brandId)],
);
