"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  getCalendarById,
  getCalendarItemById,
  updateCalendarItem,
  updateCalendarItemStatus,
} from "@/lib/db/queries";
import type { CalendarItemStatus } from "./types";

/**
 * Ownership check that works across multiple calendars: resolve the item's
 * own calendar and require it to belong to the caller's brand. (Checking
 * against "the brand's latest calendar" would lock out items from older
 * strategies' calendars.)
 */
async function getOwnedItem(itemId: string, brandId: string) {
  const item = await getCalendarItemById(itemId);
  if (!item) return null;
  const calendar = await getCalendarById(item.calendarId);
  if (!calendar || calendar.brandId !== brandId) return null;
  return item;
}

/**
 * Update a calendar item's status. Verifies the item belongs to one of the
 * brand's calendars before writing, then revalidates the calendar route.
 */
export async function updateCalendarItemStatusAction(
  itemId: string,
  status: CalendarItemStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { brand } = await requireBrand();
    const item = await getOwnedItem(itemId, brand.id);
    if (!item) {
      return { ok: false, error: "Item not found" };
    }
    await updateCalendarItemStatus(itemId, status);
    revalidatePath("/calendar");
    return { ok: true };
  } catch (err) {
    console.error("updateCalendarItemStatusAction failed", err);
    return { ok: false, error: "Could not update status" };
  }
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v));

const updateItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  brief: nullableText(5000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  time: nullableText(50),
  platform: z.string().trim().min(1, "Platform is required").max(100),
  contentType: z.string().trim().min(1, "Content type is required").max(100),
  designRequired: z.boolean(),
  designType: nullableText(100),
  dimensions: nullableText(100),
});

export type UpdateCalendarItemInput = z.input<typeof updateItemSchema>;

/**
 * Edit a calendar item's content fields. Same ownership rules as the status
 * action; date arrives as YYYY-MM-DD and is stored as UTC midnight to match
 * how generation stores dates.
 */
export async function updateCalendarItemAction(
  itemId: string,
  input: UpdateCalendarItemInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input" };
  }
  try {
    const { brand } = await requireBrand();
    const item = await getOwnedItem(itemId, brand.id);
    if (!item) {
      return { ok: false, error: "Item not found" };
    }
    const { date, ...rest } = parsed.data;
    await updateCalendarItem(itemId, {
      ...rest,
      date: new Date(`${date}T00:00:00Z`),
    });
    revalidatePath("/calendar");
    return { ok: true };
  } catch (err) {
    console.error("updateCalendarItemAction failed", err);
    return { ok: false, error: "Could not save changes" };
  }
}
