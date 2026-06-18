import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { brandContextSectionEnum } from "@/lib/db/schema";
import {
  brandContexts,
  brands,
  chatConversations,
  chatMessages,
  strategies,
  usageEvents,
  users,
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
      Pick<typeof users.$inferInsert, "passwordHash" | "provider" | "avatarUrl">
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

// ── Brands ───────────────────────────────────────────────────────────

export async function getBrandsByUserId(userId: string) {
  return db
    .select()
    .from(brands)
    .where(eq(brands.userId, userId))
    .orderBy(desc(brands.createdAt));
}

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
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
      | "logoUrl"
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

export async function getActiveBrandForUser(userId: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, userId))
    .orderBy(desc(brands.updatedAt))
    .limit(1);
  return brand ?? null;
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

export async function getRecentConversations(userId: string, limit = 10) {
  return db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
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

// ── Usage Events ────────────────────────────────────────────────────

export async function recordUsageEvent(data: typeof usageEvents.$inferInsert) {
  const [row] = await db.insert(usageEvents).values(data).returning();
  return row;
}
