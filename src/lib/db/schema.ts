import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
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

export const assetTypeEnum = pgEnum("asset_type", [
  "logo",
  "image",
  "document",
]);

export const userRoleEnum = pgEnum("user_role", ["user", "designer", "admin"]);

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

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  dueDate: timestamp("due_date"),
  status: designTicketStatusEnum("status").notNull().default("submitted"),
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
