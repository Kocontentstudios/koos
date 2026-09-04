import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { DEFAULT_SCOPE } from "@/lib/admin/scope-params";
import { brandGuideSchema } from "@/lib/ai/brand-guide";
import { db } from "@/lib/db/client";
import type { brandContextSectionEnum } from "@/lib/db/schema";
import {
  appSettings,
  brandAssets,
  brandContexts,
  brandMemory,
  brands,
  calendarItems,
  calendars,
  chatConversations,
  chatMessages,
  designAnnotations,
  designBriefs,
  designDeliverables,
  designGenerations,
  designTicketAttachments,
  designTickets,
  emailVerificationTokens,
  generationJobs,
  notifications,
  passwordResetTokens,
  rateLimits,
  strategies,
  ticketUpdates,
  usageEvents,
  users,
  workspaces,
} from "@/lib/db/schema";
import { widenWindowGuard, widenWindowSet } from "@/lib/db/sql/calendar-window";
import { countAdminTickets, viewConditions } from "./admin-tickets";

// ── Users ───────────────────────────────────────────────────────────

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user ?? null;
}

export async function updateUserProfile(
  id: string,
  data: Partial<
    Pick<
      typeof users.$inferInsert,
      "firstName" | "lastName" | "avatarUrl" | "preferences"
    >
  >,
) {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated;
}

/**
 * Product-tour state, deliberately separate from updateUserProfile: that helper
 * is the user-editable profile surface, and tour state is not profile data.
 */
export async function setUserTourCompletedAt(id: string, at: Date | null) {
  const [updated] = await db
    .update(users)
    .set({ tourCompletedAt: at, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated;
}

/** First-run welcome state. Separate from the tour for the same reason the
 *  tour is separate from updateUserProfile: it is lifecycle, not profile. */
export async function setUserWelcomeSeenAt(id: string, at: Date | null) {
  const [updated] = await db
    .update(users)
    .set({ welcomeSeenAt: at, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function createUser(
  data: Pick<typeof users.$inferInsert, "firstName" | "lastName" | "email"> &
    Partial<
      Pick<
        typeof users.$inferInsert,
        "passwordHash" | "provider" | "avatarUrl" | "emailVerifiedAt"
      >
    >,
) {
  const [created] = await db.insert(users).values(data).returning();
  return created;
}

export async function updateUserPassword(id: string, passwordHash: string) {
  const [updated] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function getAllUsers() {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
}

/** Designers and admins — candidates for ticket assignment. */
export async function getStaffUsers() {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      /* first_name is NOT NULL but may be empty, and a roster entry reading as
         a UUID prefix identifies nobody. */
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.role, ["designer", "admin"]))
    .orderBy(users.firstName);
}

export async function updateUserRole(
  id: string,
  role: typeof users.$inferInsert.role,
) {
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updated;
}

// ── Password reset ──────────────────────────────────────────────────

export async function createPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return db.transaction(async (tx) => {
    // One active token per user: a new request supersedes older links.
    await tx
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, input.userId));
    const [row] = await tx
      .insert(passwordResetTokens)
      .values(input)
      .returning();
    return row;
  });
}

export async function getPasswordResetTokenByHash(tokenHash: string) {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function markPasswordResetTokenUsed(id: string) {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

// ── Email verification ───────────────────────────────────────────────

export async function createEmailVerificationToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return db.transaction(async (tx) => {
    // One active token per user: a resend supersedes older links.
    await tx
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, input.userId));
    const [row] = await tx
      .insert(emailVerificationTokens)
      .values(input)
      .returning();
    return row;
  });
}

export async function getEmailVerificationTokenByHash(tokenHash: string) {
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function markEmailVerificationTokenUsed(id: string) {
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, id));
}

export async function markEmailVerified(userId: string) {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ── Brands ───────────────────────────────────────────────────────────

export async function getBrandById(id: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);
  return brand ?? null;
}

export async function createBrand(data: typeof brands.$inferInsert) {
  const [brand] = await db.insert(brands).values(data).returning();
  return brand;
}

export async function updateBrand(
  id: string,
  data: Partial<
    Pick<
      typeof brands.$inferInsert,
      | "name"
      | "onboardingStatus"
      | "completionPercentage"
      | "onboardingType"
      | "overview"
      | "businessType"
      | "stage"
      | "targetAudience"
      | "offer"
      | "tone"
      | "primaryGoal"
      | "values"
      | "wordsLove"
      | "wordsAvoid"
      | "hasLogo"
      | "brandStyle"
      | "brandFont"
      | "brandFontUrl"
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
      | "logoUrl"
      | "competitors"
      | "competitorStrengths"
      | "differentiators"
      | "platforms"
      | "primaryPlatform"
      | "postingFrequency"
      | "websiteUrl"
      | "additionalNotes"
      | "helpfulLinks"
    >
  >,
) {
  const [updated] = await db
    .update(brands)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning();
  return updated;
}

/** Every brand in the system for the admin console, newest first. Admin-only
    by construction: no workspace scoping, so callers must gate on role. */
export async function listBrandsForAdmin() {
  const rows = await db
    .select({
      brand: brands,
      ownerEmail: users.email,
      workspaceName: workspaces.name,
      ticketCount: count(designTickets.id),
    })
    .from(brands)
    .innerJoin(users, eq(users.id, brands.userId))
    .innerJoin(workspaces, eq(workspaces.id, brands.workspaceId))
    .leftJoin(designTickets, eq(designTickets.brandId, brands.id))
    .groupBy(brands.id, users.email, workspaces.name)
    .orderBy(desc(brands.createdAt));
  return rows;
}

/** One brand with its owner and workspace, for the admin detail page. */
export async function getBrandForAdmin(id: string) {
  const [row] = await db
    .select({
      brand: brands,
      ownerEmail: users.email,
      workspaceName: workspaces.name,
    })
    .from(brands)
    .innerJoin(users, eq(users.id, brands.userId))
    .innerJoin(workspaces, eq(workspaces.id, brands.workspaceId))
    .where(eq(brands.id, id))
    .limit(1);
  return row ?? null;
}

// ── Brand Assets ────────────────────────────────────────────────────

export async function getBrandAssets(brandId: string) {
  return db
    .select()
    .from(brandAssets)
    .where(eq(brandAssets.brandId, brandId))
    .orderBy(desc(brandAssets.createdAt));
}

export async function addBrandAsset(data: typeof brandAssets.$inferInsert) {
  const [asset] = await db.insert(brandAssets).values(data).returning();
  return asset;
}

// ── Brand Contexts ───────────────────────────────────────────────────

/** The synthesized voice guide, or null when onboarding never produced one.
 *  Shape-checked on read: it is model output stored as jsonb, and a malformed
 *  row must not reach a prompt. */
export async function getBrandVoiceGuide(brandId: string) {
  const ctx = await getBrandContext(brandId, "brand_foundation");
  const guide = (ctx?.dataJson as { guide?: unknown } | null)?.guide;
  const parsed = brandGuideSchema.safeParse(guide);
  return parsed.success ? parsed.data : null;
}

export async function getAllBrandContexts(brandId: string) {
  return db
    .select()
    .from(brandContexts)
    .where(eq(brandContexts.brandId, brandId));
}

export async function getBrandContext(
  brandId: string,
  section: (typeof brandContextSectionEnum.enumValues)[number],
) {
  const [ctx] = await db
    .select()
    .from(brandContexts)
    .where(
      and(
        eq(brandContexts.brandId, brandId),
        eq(brandContexts.section, section),
      ),
    )
    .limit(1);
  return ctx ?? null;
}

export async function upsertBrandContext(
  brandId: string,
  section: (typeof brandContextSectionEnum.enumValues)[number],
  dataJson: Record<string, unknown>,
) {
  const existing = await getBrandContext(brandId, section);

  if (existing) {
    const [updated] = await db
      .update(brandContexts)
      .set({ dataJson, updatedAt: new Date() })
      .where(eq(brandContexts.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(brandContexts)
    .values({ brandId, section, dataJson })
    .returning();
  return created;
}

// ── Chat ────────────────────────────────────────────────────────────

export async function getRecentConversationsForBrand(
  brandId: string,
  limit = 15,
) {
  return db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.brandId, brandId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

export async function getConversationMessages(conversationId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt);
}

export async function createConversation(
  data: typeof chatConversations.$inferInsert,
) {
  const [conv] = await db.insert(chatConversations).values(data).returning();
  return conv;
}

export async function createMessage(data: typeof chatMessages.$inferInsert) {
  const [msg] = await db.insert(chatMessages).values(data).returning();
  return msg;
}

export async function getConversationById(id: string) {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, id))
    .limit(1);
  return conv ?? null;
}

export async function getLatestConversationForBrand(brandId: string) {
  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.brandId, brandId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);
  return conv ?? null;
}

export async function touchConversation(id: string) {
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
}

/**
 * Automatic titling (the AI titler, and the campaign-name rename on strategy
 * generation). The titleCustom predicate is part of the WHERE on purpose: a
 * user rename and a background title write can race, and losing the user's
 * title is the worse outcome. Returns whether a row was written.
 */
export async function updateConversationTitle(id: string, title: string) {
  const written = await db
    .update(chatConversations)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(chatConversations.id, id),
        eq(chatConversations.titleCustom, false),
      ),
    )
    .returning({ id: chatConversations.id });
  return written.length > 0;
}

/** A user-typed title. Locks the chat against every automatic title write. */
export async function renameConversation(id: string, title: string) {
  const [row] = await db
    .update(chatConversations)
    .set({ title, titleCustom: true, updatedAt: new Date() })
    .where(eq(chatConversations.id, id))
    .returning();
  return row ?? null;
}

// ── Strategies ──────────────────────────────────────────────────────

export async function createStrategy(data: typeof strategies.$inferInsert) {
  const [row] = await db.insert(strategies).values(data).returning();
  return row;
}

export async function getStrategyById(id: string) {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * The campaign card for a chat: its newest strategy that hasn't been
 * superseded. Archived rows are earlier versions of the same campaign, kept
 * for history but never shown on the card.
 */
export async function getLatestStrategyForConversation(conversationId: string) {
  const [row] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.conversationId, conversationId),
        ne(strategies.status, "archived"),
      ),
    )
    .orderBy(desc(strategies.createdAt))
    .limit(1);
  return row ?? null;
}

/** Retire the chat's earlier strategy versions so exactly one campaign stands. */
export async function archiveSupersededStrategies(
  conversationId: string,
  keepId: string,
) {
  // updatedAt is deliberately untouched: archiving is a lifecycle flag, not an
  // edit. Bumping it would sort a superseded version above the campaign that
  // superseded it wherever strategies are ordered by recency.
  const archived = await db
    .update(strategies)
    .set({ status: "archived" })
    .where(
      and(
        eq(strategies.conversationId, conversationId),
        ne(strategies.id, keepId),
        ne(strategies.status, "archived"),
      ),
    )
    .returning({ id: strategies.id });
  return archived.length;
}

export async function getStrategiesByBrand(brandId: string) {
  return db
    .select()
    .from(strategies)
    .where(eq(strategies.brandId, brandId))
    .orderBy(desc(strategies.updatedAt));
}

export async function updateStrategy(
  id: string,
  data: Partial<
    Pick<typeof strategies.$inferInsert, "name" | "structured" | "status">
  >,
) {
  const [row] = await db
    .update(strategies)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(strategies.id, id))
    .returning();
  return row;
}

// ── Calendars ───────────────────────────────────────────────────────

export async function createCalendar(data: typeof calendars.$inferInsert) {
  const [row] = await db.insert(calendars).values(data).returning();
  return row;
}

export async function insertCalendarItems(
  rows: (typeof calendarItems.$inferInsert)[],
) {
  if (rows.length === 0) return [];
  return db.insert(calendarItems).values(rows).returning();
}

/** The most recently created calendar for a brand (the active one). */
export async function getActiveCalendarForBrand(brandId: string) {
  const [row] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.brandId, brandId))
    .orderBy(desc(calendars.createdAt))
    .limit(1);
  return row ?? null;
}

/** All of a brand's calendars with their strategy names, newest first. */
export async function getCalendarsForBrand(brandId: string) {
  return db
    .select({ calendar: calendars, strategyName: strategies.name })
    .from(calendars)
    .innerJoin(strategies, eq(calendars.strategyId, strategies.id))
    .where(eq(calendars.brandId, brandId))
    .orderBy(desc(calendars.createdAt));
}

export async function getCalendarById(id: string) {
  const [row] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCalendarItems(calendarId: string) {
  return db
    .select()
    .from(calendarItems)
    .where(eq(calendarItems.calendarId, calendarId))
    .orderBy(calendarItems.date, calendarItems.sortOrder);
}

/** Insert one item (the manual-add path; generation bulk-inserts instead). */
export async function createCalendarItem(
  row: typeof calendarItems.$inferInsert,
) {
  const [created] = await db.insert(calendarItems).values(row).returning();
  return created;
}

export async function deleteCalendarItem(id: string) {
  const [row] = await db
    .delete(calendarItems)
    .where(eq(calendarItems.id, id))
    .returning();
  return row ?? null;
}

/**
 * Widen a calendar's date range so a newly placed item stays reachable.
 *
 * LEAST/GREATEST rather than a read-modify-write: two concurrent adds on
 * either side of the range would otherwise both compute their new bound from
 * the same stale read, and the second write would clobber the first — leaving
 * one item outside the very window this exists to keep it inside. The WHERE
 * guard makes an in-range date a no-op instead of a pointless UPDATE.
 */
export async function widenCalendarWindow(calendarId: string, date: Date) {
  const [row] = await db
    .update(calendars)
    .set({ ...widenWindowSet(date), updatedAt: new Date() })
    .where(and(eq(calendars.id, calendarId), widenWindowGuard(date)))
    .returning();
  return row ?? null;
}

/** Next free slot on a given day, so a new item lands after that day's items
    rather than tying with the first one at sortOrder 0. */
export async function nextSortOrderForDate(
  calendarId: string,
  date: Date,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${calendarItems.sortOrder})` })
    .from(calendarItems)
    .where(
      and(
        eq(calendarItems.calendarId, calendarId),
        eq(calendarItems.date, date),
      ),
    );
  return (row?.max ?? -1) + 1;
}

export async function updateCalendarItemStatus(
  id: string,
  status: typeof calendarItems.$inferInsert.status,
) {
  const [row] = await db
    .update(calendarItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(calendarItems.id, id))
    .returning();
  return row;
}

/** Partial update of a calendar item's editable content fields. */
export async function updateCalendarItem(
  id: string,
  data: Partial<
    Pick<
      typeof calendarItems.$inferInsert,
      | "date"
      | "time"
      | "platform"
      | "contentType"
      | "title"
      | "brief"
      | "caption"
      | "notes"
      | "designRequired"
      | "designType"
      | "dimensions"
    >
  >,
) {
  const [row] = await db
    .update(calendarItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(calendarItems.id, id))
    .returning();
  return row;
}

/** Fill in briefs for items whose slots have finished generating. Sequential
    rather than a single CASE statement: batches are small (at most 4 slots)
    and one failed row must not lose the others. */
export async function updateCalendarItemBriefs(
  updates: { id: string; brief: string }[],
): Promise<void> {
  for (const { id, brief } of updates) {
    await db
      .update(calendarItems)
      .set({ brief, updatedAt: new Date() })
      .where(eq(calendarItems.id, id));
  }
}

export async function getCalendarItemById(id: string) {
  const [row] = await db
    .select()
    .from(calendarItems)
    .where(eq(calendarItems.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * A calendar item together with the brand that owns it.
 *
 * calendar_items reaches its brand only through calendars, so a bare
 * getCalendarItemById cannot be ownership-checked by the caller. Generation
 * accepted an item id without ever tying it to the requested brand, which let
 * one brand's item be read into another brand's design context.
 */
export async function getCalendarItemForBrand(id: string, brandId: string) {
  const [row] = await db
    .select({ item: calendarItems })
    .from(calendarItems)
    .innerJoin(calendars, eq(calendars.id, calendarItems.calendarId))
    .where(and(eq(calendarItems.id, id), eq(calendars.brandId, brandId)))
    .limit(1);
  return row?.item ?? null;
}

// ── Design Briefs ───────────────────────────────────────────────────

export async function createDesignBrief(
  data: typeof designBriefs.$inferInsert,
) {
  const [row] = await db.insert(designBriefs).values(data).returning();
  return row;
}

export async function getDesignBriefById(id: string) {
  const [row] = await db
    .select()
    .from(designBriefs)
    .where(eq(designBriefs.id, id))
    .limit(1);
  return row ?? null;
}

export async function listDesignBriefsForConversation(conversationId: string) {
  return db
    .select()
    .from(designBriefs)
    .where(eq(designBriefs.conversationId, conversationId))
    .orderBy(designBriefs.createdAt);
}

/** Every brief for a brand, newest first — what the context picker searches. */
export async function listDesignBriefsForBrand(brandId: string, limit = 50) {
  return db
    .select()
    .from(designBriefs)
    .where(eq(designBriefs.brandId, brandId))
    .orderBy(desc(designBriefs.createdAt))
    .limit(limit);
}

export async function updateDesignBrief(
  id: string,
  data: Partial<
    Pick<
      typeof designBriefs.$inferInsert,
      | "title"
      | "designType"
      | "dimensions"
      | "slides"
      | "briefMarkdown"
      | "notes"
      | "ticketId"
    >
  >,
) {
  const [row] = await db
    .update(designBriefs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(designBriefs.id, id))
    .returning();
  return row ?? null;
}

// ── Design Generations ──────────────────────────────────────────────

export async function createDesignGeneration(
  data: typeof designGenerations.$inferInsert,
) {
  const [row] = await db.insert(designGenerations).values(data).returning();
  return row;
}

export async function updateDesignGeneration(
  id: string,
  data: Partial<
    Pick<
      typeof designGenerations.$inferInsert,
      "imageKey" | "status" | "error" | "width" | "height" | "spec"
    >
  >,
) {
  const [row] = await db
    .update(designGenerations)
    .set(data)
    .where(eq(designGenerations.id, id))
    .returning();
  return row ?? null;
}

export async function getDesignGenerationById(id: string) {
  const [row] = await db
    .select()
    .from(designGenerations)
    .where(eq(designGenerations.id, id))
    .limit(1);
  return row ?? null;
}

export async function listDesignGenerationsForBrand(
  brandId: string,
  opts: { limit?: number; briefId?: string; calendarItemId?: string } = {},
) {
  const filters = [eq(designGenerations.brandId, brandId)];
  if (opts.briefId) filters.push(eq(designGenerations.briefId, opts.briefId));
  if (opts.calendarItemId) {
    filters.push(eq(designGenerations.calendarItemId, opts.calendarItemId));
  }
  return db
    .select()
    .from(designGenerations)
    .where(and(...filters))
    .orderBy(desc(designGenerations.createdAt))
    .limit(opts.limit ?? 50);
}

/** Successful design generations charged to a workspace since `since`.
 * usage_events has no workspace column, so this joins through the brand. */
export async function countDesignGenerationsForWorkspace(
  workspaceId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .where(
      and(
        eq(brands.workspaceId, workspaceId),
        eq(usageEvents.kind, "design_generated"),
        gte(usageEvents.createdAt, since),
      ),
    );
  return Number(row?.count ?? 0);
}

// ── Design Tickets ──────────────────────────────────────────────────

export async function createDesignTicket(
  data: Omit<typeof designTickets.$inferInsert, "ticketNumber">,
) {
  // ticketNumber comes from the design_ticket_number_seq default.
  const [row] = await db.insert(designTickets).values(data).returning();
  return row;
}

export async function getDesignTicketById(id: string) {
  const [row] = await db
    .select()
    .from(designTickets)
    .where(eq(designTickets.id, id))
    .limit(1);
  return row ?? null;
}

export async function getDesignTicketForCalendarItem(calendarItemId: string) {
  const [row] = await db
    .select()
    .from(designTickets)
    .where(eq(designTickets.calendarItemId, calendarItemId))
    .orderBy(desc(designTickets.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listDesignTicketsForBrand(brandId: string) {
  return db
    .select()
    .from(designTickets)
    .where(eq(designTickets.brandId, brandId))
    .orderBy(desc(designTickets.createdAt));
}

export async function updateDesignTicket(
  id: string,
  data: Partial<
    Pick<
      typeof designTickets.$inferInsert,
      "status" | "assignedDesignerId" | "notes" | "priority"
    >
  >,
) {
  const [row] = await db
    .update(designTickets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(designTickets.id, id))
    .returning();
  return row;
}

export async function updateDraftTicket(
  id: string,
  data: Partial<
    Pick<
      typeof designTickets.$inferInsert,
      | "title"
      | "designType"
      | "brief"
      | "notes"
      | "priority"
      | "specs"
      | "dueDate"
      | "dimensions"
      | "slides"
      | "brandId"
      | "status"
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

// ── Design Ticket Attachments ───────────────────────────────────────

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

// ── Design Deliverables ─────────────────────────────────────────────

/** Record a delivery round: insert the files under the next version number, move
 * the ticket into review, log the timeline entry and notify the owner — all in
 * one transaction.
 *
 * The `FOR UPDATE` lock on the ticket row is what makes the version number safe.
 * A designer double-clicking "Upload deliverables" fires two POSTs that would
 * otherwise both read the same max() and write the same version, interleaving
 * two batches into one corrupt round.
 *
 * An upload onto an already-approved ticket reopens it for review but
 * deliberately leaves any linked calendar item alone — a published-ready item
 * shouldn't flip back on a late studio correction. */
export async function recordDeliverableVersion(input: {
  ticketId: string;
  authorId: string;
  ownerId: string;
  files: { fileUrl: string; fileName: string; slideIndex: number }[];
  designType: string;
}) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: designTickets.id })
      .from(designTickets)
      .where(eq(designTickets.id, input.ticketId))
      .for("update");

    const [current] = await tx
      .select({
        max: sql<number>`coalesce(max(${designDeliverables.version}), 0)`,
      })
      .from(designDeliverables)
      .where(eq(designDeliverables.ticketId, input.ticketId));
    const version = Number(current?.max ?? 0) + 1;

    const rows = await tx
      .insert(designDeliverables)
      .values(
        input.files.map((f) => ({
          ticketId: input.ticketId,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          slideIndex: f.slideIndex,
          version,
        })),
      )
      .returning();

    await tx
      .update(designTickets)
      .set({ status: "ready_for_review", updatedAt: new Date() })
      .where(eq(designTickets.id, input.ticketId));

    const count = rows.length;
    await tx.insert(ticketUpdates).values({
      ticketId: input.ticketId,
      authorId: input.authorId,
      message:
        version === 1
          ? `Delivered ${count} file${count === 1 ? "" : "s"} for review.`
          : `Version ${version} delivered (${count} file${count === 1 ? "" : "s"}) for review.`,
      newStatus: "ready_for_review",
    });

    await tx.insert(notifications).values({
      userId: input.ownerId,
      type: "design_ready",
      payload: {
        ticketId: input.ticketId,
        designType: input.designType,
        count,
        version,
      },
    });

    return { version, rows };
  });
}

export async function getDeliverables(ticketId: string) {
  return db
    .select()
    .from(designDeliverables)
    .where(eq(designDeliverables.ticketId, ticketId))
    .orderBy(
      designDeliverables.version,
      designDeliverables.slideIndex,
      designDeliverables.createdAt,
    );
}

export async function getDeliverableById(id: string) {
  const [row] = await db
    .select()
    .from(designDeliverables)
    .where(eq(designDeliverables.id, id))
    .limit(1);
  return row ?? null;
}

// ── Notifications ───────────────────────────────────────────────────

export async function createNotification(
  data: typeof notifications.$inferInsert,
) {
  const [row] = await db.insert(notifications).values(data).returning();
  return row;
}

export async function getNotifications(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(userId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

export async function markNotificationsRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// ── Ticket Updates ──────────────────────────────────────────────────

export async function createTicketUpdate(
  data: typeof ticketUpdates.$inferInsert,
) {
  const [row] = await db.insert(ticketUpdates).values(data).returning();
  return row;
}

/** A ticket's progress updates, newest first, with the author's name and role.
 * The role lets the client view mask staff identities behind one team name
 * while still attributing the client's own entries to them. */
export async function getTicketUpdates(ticketId: string) {
  return db
    .select({
      update: ticketUpdates,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorRole: users.role,
    })
    .from(ticketUpdates)
    .leftJoin(users, eq(ticketUpdates.authorId, users.id))
    .where(eq(ticketUpdates.ticketId, ticketId))
    .orderBy(desc(ticketUpdates.createdAt));
}

/** Apply a client's verdict on a delivered design, but only while the ticket is
 * still awaiting review. The status predicate lives in the UPDATE rather than an
 * if-statement so a double-submitted approval can't fire the emails, calendar
 * write and notifications twice — the second caller gets null and the route
 * answers 409. */
export async function applyClientReview(input: {
  ticketId: string;
  authorId: string;
  action: "approve" | "revise";
  note: string | null;
  version: number | null;
  staffIds: string[];
  ticketNumber: number;
}) {
  return db.transaction(async (tx) => {
    const nextStatus =
      input.action === "approve" ? "delivered" : "revision_requested";
    const [ticket] = await tx
      .update(designTickets)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
        ...(input.action === "approve" ? { approvedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(designTickets.id, input.ticketId),
          eq(designTickets.status, "ready_for_review"),
        ),
      )
      .returning();
    if (!ticket) return null;

    const versionLabel = input.version ? ` version ${input.version}` : "";
    const [update] = await tx
      .insert(ticketUpdates)
      .values({
        ticketId: input.ticketId,
        authorId: input.authorId,
        message:
          input.action === "approve"
            ? `Approved${versionLabel}. No further changes requested.`
            : `Requested a revision on${versionLabel || " this design"}:\n\n${input.note ?? "See the marked-up files."}`,
        newStatus: nextStatus,
      })
      .returning();

    if (input.staffIds.length > 0) {
      await tx.insert(notifications).values(
        input.staffIds.map((id) => ({
          userId: id,
          type: "ticket_status" as const,
          payload: {
            ticketId: input.ticketId,
            ticketNumber: input.ticketNumber,
            status: nextStatus,
          },
        })),
      );
    }

    return { ticket, update };
  });
}

/**
 * A comment from the brand side, inserted and fanned out to staff in one
 * transaction.
 *
 * Deliberately cannot change status. `revision_requested` is reachable only
 * through applyClientReview, and the staff routes cap themselves to the same
 * end so nobody can fake one; a comment endpoint that could set status would
 * quietly undo that. Commenting is also allowed in any status, which is the
 * point — the client previously had no way to say anything except during a
 * formal review.
 */
export async function postClientTicketComment(input: {
  ticketId: string;
  authorId: string;
  message: string;
  staffIds: string[];
  /** Built by the caller, matching postTicketProgressUpdate — formatting is
      the route's job, not the query layer's. */
  notificationPayload: typeof notifications.$inferInsert.payload;
}) {
  return db.transaction(async (tx) => {
    const [update] = await tx
      .insert(ticketUpdates)
      .values({
        ticketId: input.ticketId,
        authorId: input.authorId,
        message: input.message,
        newStatus: null,
      })
      .returning();

    // Touch the ticket so the queue's "last updated" ordering surfaces a
    // request the client just commented on.
    await tx
      .update(designTickets)
      .set({ updatedAt: new Date() })
      .where(eq(designTickets.id, input.ticketId));

    if (input.staffIds.length > 0) {
      await tx.insert(notifications).values(
        input.staffIds.map((id) => ({
          userId: id,
          type: "ticket_status" as const,
          payload: input.notificationPayload,
        })),
      );
    }

    return update;
  });
}

/** Atomically apply an optional status change, insert the update row, and
 * notify the ticket owner — all in one transaction. */
export async function postTicketProgressUpdate(input: {
  ticketId: string;
  authorId: string;
  message: string;
  newStatus: typeof ticketUpdates.$inferInsert.newStatus;
  ownerId: string;
  notificationPayload: typeof notifications.$inferInsert.payload;
}) {
  return db.transaction(async (tx) => {
    if (input.newStatus) {
      await tx
        .update(designTickets)
        .set({ status: input.newStatus, updatedAt: new Date() })
        .where(eq(designTickets.id, input.ticketId));
    }
    const [update] = await tx
      .insert(ticketUpdates)
      .values({
        ticketId: input.ticketId,
        authorId: input.authorId,
        message: input.message,
        newStatus: input.newStatus,
      })
      .returning();
    await tx.insert(notifications).values({
      userId: input.ownerId,
      type: "ticket_status",
      payload: input.notificationPayload,
    });
    return update;
  });
}

// ── Usage Events ────────────────────────────────────────────────────

export async function recordUsageEvent(data: typeof usageEvents.$inferInsert) {
  const [row] = await db.insert(usageEvents).values(data).returning();
  return row;
}

// ── Generation jobs ─────────────────────────────────────────────────

export async function createGenerationJob(data: {
  kind: (typeof generationJobs.$inferInsert)["kind"];
  userId: string;
  brandId: string;
  input?: unknown;
}) {
  const [row] = await db.insert(generationJobs).values(data).returning();
  return row;
}

export async function updateGenerationJob(
  id: string,
  patch: Partial<
    Pick<
      typeof generationJobs.$inferInsert,
      "status" | "resultId" | "result" | "error"
    >
  >,
) {
  const [row] = await db
    .update(generationJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(generationJobs.id, id))
    .returning();
  return row;
}

export async function getGenerationJobById(id: string) {
  const [row] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .limit(1);
  return row ?? null;
}

/** Heartbeat: refresh updatedAt so the poll route's stale detection knows
    the worker is alive during a long model call. */
export async function touchGenerationJob(id: string) {
  await db
    .update(generationJobs)
    .set({ updatedAt: new Date() })
    .where(eq(generationJobs.id, id));
}

/**
 * Atomically claim a silent, still-running job for a resume attempt. The
 * staleness condition inside the UPDATE makes concurrent pollers race
 * safely: exactly one gets the row back (and bumps resumeCount in the jsonb
 * result), the rest get null and do nothing.
 */
export async function claimStaleGenerationJob(id: string, staleMs: number) {
  const [row] = await db
    .update(generationJobs)
    .set({
      updatedAt: new Date(),
      result: sql`jsonb_set(
        coalesce(${generationJobs.result}, '{}'::jsonb),
        '{resumeCount}',
        to_jsonb(coalesce((${generationJobs.result}->>'resumeCount')::int, 0) + 1)
      )`,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ["pending", "running"]),
        lt(generationJobs.updatedAt, new Date(Date.now() - staleMs)),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Atomically claim a job that a worker paused deliberately. Clearing the
 * flag inside the UPDATE makes concurrent pollers race safely: exactly one
 * gets the row back. Unlike a stale claim this does NOT bump resumeCount —
 * MAX_RESUMES bounds genuine worker deaths, and a 90-day calendar
 * legitimately pauses several times.
 */
export async function claimPausedGenerationJob(id: string) {
  const [row] = await db
    .update(generationJobs)
    .set({
      updatedAt: new Date(),
      result: sql`jsonb_set(
        coalesce(${generationJobs.result}, '{}'::jsonb),
        '{paused}',
        'false'::jsonb
      )`,
    })
    .where(
      and(
        eq(generationJobs.id, id),
        inArray(generationJobs.status, ["pending", "running"]),
        sql`${generationJobs.result}->>'paused' = 'true'`,
      ),
    )
    .returning();
  return row ?? null;
}

// ── Rate limiting ───────────────────────────────────────────────────

/**
 * Atomically record one hit against a fixed-window counter and return the
 * window's running total. A single upsert keeps concurrent requests correct:
 * if the stored window has expired the counter resets to 1, otherwise it
 * increments in place.
 */
export async function hitRateLimit(key: string, windowSeconds: number) {
  const rows = await db.execute<{ count: number; window_start: string }>(sql`
    INSERT INTO ${rateLimits} ("key", "count", "window_start")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN ${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE ${rateLimits.count} + 1 END,
      "window_start" = CASE
        WHEN ${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSeconds})
        THEN now() ELSE ${rateLimits.windowStart} END
    RETURNING "count", "window_start"
  `);
  const row = rows[0];
  return {
    count: Number(row.count),
    windowStart: new Date(row.window_start),
  };
}

/**
 * Hand a consumed window back.
 *
 * A caller that reserves the window BEFORE doing the work it is protecting has
 * to release it when that work fails, or the failure silently blocks every
 * retry for the rest of the window — and the block reports itself as "already
 * done". Compensating action, not a general-purpose reset: only the caller
 * that just consumed this key may call it.
 */
export async function releaseRateLimit(key: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

// ── Admin dashboard ─────────────────────────────────────────────────

/** Ticket counts grouped by status. */
export async function getTicketCountsByStatus() {
  return db
    .select({ status: designTickets.status, count: count() })
    .from(designTickets)
    .groupBy(designTickets.status);
}

/**
 * Tickets past their due date that are still live work.
 *
 * Deliberately delegates rather than restating the predicate.
 *
 * The old query was `dueDate < now AND status != 'delivered'`, which counted
 * tickets nobody ever submitted and counted approved work the moment a
 * correction upload moved it off `delivered`. Sharing the definition with the
 * drill-down is also what stops the card's number disagreeing with the list it
 * opens — see VIEW_PREDICATES.overdue, which is tested without a database.
 */
export async function getOverdueTicketCount() {
  return countAdminTickets({ ...DEFAULT_SCOPE, view: "overdue" });
}

/**
 * Work genuinely waiting on a client, for the Ready for Review card.
 *
 * Not `getTicketCountsByStatus().ready_for_review`: a ticket the client already
 * approved goes back to `ready_for_review` on a correction upload and keeps its
 * approvedAt, so the raw status count is larger than the list the card opens.
 * The card and its drill-down must resolve the same predicate or the number
 * lies about the page behind it.
 */
export async function getAwaitingReviewCount() {
  return countAdminTickets({ ...DEFAULT_SCOPE, view: "awaiting_review" });
}

/** Tickets in the working queue: everything but drafts and delivered work. */
export async function getOpenTicketCount() {
  return countAdminTickets({ ...DEFAULT_SCOPE, view: "open" });
}

/** User counts grouped by role. */
export async function getUserCountsByRole() {
  return db
    .select({ role: users.role, count: count() })
    .from(users)
    .groupBy(users.role);
}

/** Active (assigned/in_progress/ready_for_review) ticket load per designer. */
export async function getDesignerLoads() {
  return (
    db
      .select({
        /* Non-null by the isNotNull guard below. Stated here so callers can link
         straight to ?assignee=<id> instead of re-checking what the WHERE
         clause already guarantees. */
        designerId: sql<string>`${designTickets.assignedDesignerId}`,
        firstName: users.firstName,
        lastName: users.lastName,
        /* first_name is NOT NULL but may be empty, so a designer can render as
         "". The drill-down header falls back to the email; this row has to
         fall back to the same thing or the two name the same person
         differently. */
        email: users.email,
        count: count(),
      })
      .from(designTickets)
      .leftJoin(users, eq(designTickets.assignedDesignerId, users.id))
      /* Derived, not restated: this count is what the drill-down's `active`
       view opens, so a literal here could drift from the list it links to. */
      .where(
        and(
          isNotNull(designTickets.assignedDesignerId),
          ...viewConditions("active", new Date()),
        ),
      )
      .groupBy(
        designTickets.assignedDesignerId,
        users.firstName,
        users.lastName,
        users.email,
      )
  );
}

/** Most recently created tickets, with brand name. */
export async function getRecentTickets(limit = 8) {
  return db
    .select({
      id: designTickets.id,
      ticketNumber: designTickets.ticketNumber,
      designType: designTickets.designType,
      status: designTickets.status,
      brandName: brands.name,
      createdAt: designTickets.createdAt,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .orderBy(desc(designTickets.createdAt))
    .limit(limit);
}

// ── App settings ────────────────────────────────────────────────────

export async function getAppSettings() {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  return row ?? null;
}

export async function updateAppSettings(data: {
  designTeamEmail: string | null;
}) {
  const [row] = await db
    .insert(appSettings)
    .values({
      id: 1,
      designTeamEmail: data.designTeamEmail,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { designTeamEmail: data.designTeamEmail, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export * from "./admin-tickets";
export * from "./analytics";
export * from "./workspaces";

// ── Brand memory ────────────────────────────────────────────────────

export type MemoryFact = { text: string; source: string; createdAt: string };

export async function getBrandMemory(
  brandId: string,
): Promise<{ summary: string; facts: MemoryFact[] } | null> {
  const [row] = await db
    .select({ summary: brandMemory.summary, facts: brandMemory.facts })
    .from(brandMemory)
    .where(eq(brandMemory.brandId, brandId))
    .limit(1);
  if (!row) return null;
  return { summary: row.summary, facts: row.facts as MemoryFact[] };
}

export async function upsertBrandMemory(
  brandId: string,
  data: { summary: string; facts: MemoryFact[] },
): Promise<void> {
  await db
    .insert(brandMemory)
    .values({
      brandId,
      summary: data.summary,
      facts: data.facts,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: brandMemory.brandId,
      set: {
        summary: data.summary,
        facts: data.facts,
        updatedAt: new Date(),
      },
    });
}

// ── Design annotations ──────────────────────────────────────────────

export type AnnotationShape = {
  type: "rect" | "path";
  coords: number[];
  color: string;
};

export async function addAnnotation(data: {
  ticketId: string;
  deliverableId: string;
  authorId: string;
  shapes: AnnotationShape[];
  note?: string;
}) {
  const [inserted] = await db
    .insert(designAnnotations)
    .values({
      ticketId: data.ticketId,
      deliverableId: data.deliverableId,
      authorId: data.authorId,
      shapes: data.shapes,
      note: data.note,
    })
    .returning();
  return inserted;
}

export async function getAnnotationsForTicket(ticketId: string) {
  const rows = await db
    .select({
      annotation: designAnnotations,
      version: designDeliverables.version,
      fileName: designDeliverables.fileName,
    })
    .from(designAnnotations)
    .leftJoin(
      designDeliverables,
      eq(designAnnotations.deliverableId, designDeliverables.id),
    )
    .where(eq(designAnnotations.ticketId, ticketId))
    .orderBy(desc(designAnnotations.createdAt));
  // jsonb columns have no schema-level type; the shapes column is only ever
  // written via addAnnotation's typed input, so this cast just reasserts that.
  return rows.map((row) => ({
    ...row.annotation,
    shapes: row.annotation.shapes as AnnotationShape[],
    version: row.version ?? 1,
    fileName: row.fileName ?? "",
  }));
}
