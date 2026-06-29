"use server";

import { revalidatePath } from "next/cache";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  getActiveCalendarForBrand,
  getCalendarItemById,
  updateCalendarItemStatus,
} from "@/lib/db/queries";
import type { CalendarItemStatus } from "./types";

/**
 * Update a calendar item's status. Verifies the item belongs to the active
 * brand's calendar before writing, then revalidates the calendar route.
 */
export async function updateCalendarItemStatusAction(
  itemId: string,
  status: CalendarItemStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { brand } = await requireBrand();
    const [item, calendar] = await Promise.all([
      getCalendarItemById(itemId),
      getActiveCalendarForBrand(brand.id),
    ]);
    if (!item || !calendar || item.calendarId !== calendar.id) {
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
