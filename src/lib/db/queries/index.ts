import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { brandContextSectionEnum } from "@/lib/db/schema";
import {
  appSettings,
  brandContexts,
  brands,
  calendarItems,
  calendars,
  chatConversations,
  chatMessages,
  designBriefs,
  designDeliverables,
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

// ── Brand Contexts ───────────────────────────────────────────────────

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

export async function updateConversationTitle(id: string, title: string) {
  await db
    .update(chatConversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
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

const QUEUE_STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "revision_requested",
] as const;

/** Open tickets for the designer/admin queue. */
export async function getDesignerQueue() {
  return db
    .select({
      ticket: designTickets,
      campaignName: strategies.name,
      itemTitle: calendarItems.title,
      brandName: brands.name,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .leftJoin(calendarItems, eq(designTickets.calendarItemId, calendarItems.id))
    .leftJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .leftJoin(strategies, eq(calendars.strategyId, strategies.id))
    .where(inArray(designTickets.status, [...QUEUE_STATUSES]))
    .orderBy(desc(designTickets.createdAt));
}

// ── Design Deliverables ─────────────────────────────────────────────

export async function addDeliverables(
  rows: (typeof designDeliverables.$inferInsert)[],
) {
  if (rows.length === 0) return [];
  return db.insert(designDeliverables).values(rows).returning();
}

export async function getDeliverables(ticketId: string) {
  return db
    .select()
    .from(designDeliverables)
    .where(eq(designDeliverables.ticketId, ticketId))
    .orderBy(designDeliverables.slideIndex, designDeliverables.createdAt);
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

/** A ticket's progress updates, newest first, with the author's name. */
export async function getTicketUpdates(ticketId: string) {
  return db
    .select({
      update: ticketUpdates,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(ticketUpdates)
    .leftJoin(users, eq(ticketUpdates.authorId, users.id))
    .where(eq(ticketUpdates.ticketId, ticketId))
    .orderBy(desc(ticketUpdates.createdAt));
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

// ── Admin dashboard ─────────────────────────────────────────────────

/** Ticket counts grouped by status. */
export async function getTicketCountsByStatus() {
  return db
    .select({ status: designTickets.status, count: count() })
    .from(designTickets)
    .groupBy(designTickets.status);
}

/** Tickets past their due date that are not yet delivered. */
export async function getOverdueTicketCount() {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(
      and(
        lt(designTickets.dueDate, new Date()),
        ne(designTickets.status, "delivered"),
      ),
    );
  return row?.count ?? 0;
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
  return db
    .select({
      designerId: designTickets.assignedDesignerId,
      firstName: users.firstName,
      lastName: users.lastName,
      count: count(),
    })
    .from(designTickets)
    .leftJoin(users, eq(designTickets.assignedDesignerId, users.id))
    .where(
      and(
        isNotNull(designTickets.assignedDesignerId),
        inArray(designTickets.status, [
          "assigned",
          "in_progress",
          "ready_for_review",
        ]),
      ),
    )
    .groupBy(designTickets.assignedDesignerId, users.firstName, users.lastName);
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

export * from "./workspaces";
