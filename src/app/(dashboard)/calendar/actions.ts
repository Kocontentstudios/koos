"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrand } from "@/lib/auth/require-brand";
import { utcMidnight } from "@/lib/calendar/schedule";
import {
  DATE_BOUNDS_MESSAGE,
  dateInputValue,
  expandWindow,
  parseDateInput,
  withinDateBounds,
} from "@/lib/calendar/window";
import {
  createCalendarItem,
  deleteCalendarItem,
  getCalendarById,
  getCalendarItemById,
  nextSortOrderForDate,
  updateCalendarItem,
  updateCalendarItemStatus,
  widenCalendarWindow,
} from "@/lib/db/queries";
import type { CalendarItemStatus } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

/*
 * Every action below calls `requireBrand()` OUTSIDE its try/catch on purpose:
 * it may `redirect()`, which works by throwing NEXT_REDIRECT, and catching
 * that would turn an expired session into a permanent "Could not save" toast
 * instead of a trip to /login.
 */

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
  return { item, calendar };
}

/** calendar_items carries no brandId, so a create has to authorize against
    its parent calendar before there is any item to check. */
async function getOwnedCalendar(calendarId: string, brandId: string) {
  const calendar = await getCalendarById(calendarId);
  if (!calendar || calendar.brandId !== brandId) return null;
  return calendar;
}

/**
 * Update a calendar item's status. Verifies the item belongs to one of the
 * brand's calendars before writing, then revalidates the calendar route.
 */
export async function updateCalendarItemStatusAction(
  itemId: string,
  status: CalendarItemStatus,
): Promise<ActionResult> {
  const { brand } = await requireBrand();
  try {
    const owned = await getOwnedItem(itemId, brand.id);
    if (!owned) {
      return { ok: false, error: "Item not found" };
    }
    const updated = await updateCalendarItemStatus(itemId, status);
    if (!updated) {
      return { ok: false, error: "Item not found" };
    }
    refreshCalendar();
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

/** Shared by create and update so the two can never drift apart. */
const itemFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  brief: nullableText(5000),
  caption: nullableText(5000),
  notes: nullableText(2000),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    // The regex only checks shape; "2026-02-31" passes it and would roll over
    // to March 3 on parse, storing a day the user never picked.
    .refine((v) => parseDateInput(v) !== null, "That date does not exist"),
  time: nullableText(50),
  platform: z.string().trim().min(1, "Platform is required").max(100),
  contentType: z.string().trim().min(1, "Content type is required").max(100),
  designRequired: z.boolean(),
  designType: nullableText(100),
  dimensions: nullableText(100),
});

export type CalendarItemFormInput = z.input<typeof itemFieldsSchema>;
/** Kept as the historical name used by the drawer's edit mode. */
export type UpdateCalendarItemInput = CalendarItemFormInput;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/**
 * The ±5y bound exists to stop a year typo from permanently moving the
 * calendar window, so it applies only to a date the user actually changed.
 * Enforcing it on every save would mean an item dated legitimately today
 * becomes unsavable five years from now — and the user would be told to fix a
 * date while editing a caption.
 */
function outOfBoundsMove(next: Date, current: Date | null): boolean {
  // Normalized the way expandWindow normalizes its bounds: a stored value
  // carrying a time component still means "the same day", and a false
  // mismatch here would reinstate the bound on an untouched date.
  if (current && utcMidnight(current).getTime() === next.getTime())
    return false;
  return !withinDateBounds(dateInputValue(next));
}

/**
 * Refresh the calendar route without letting a cache-layer failure masquerade
 * as a failed write. `revalidatePath` throws inside a cache scope, and it runs
 * after the row is committed — left uncaught it would surface as "Could not
 * save" on a write that succeeded, and the user would resubmit into a
 * duplicate. A stale view is the lesser failure.
 */
function refreshCalendar(): void {
  try {
    revalidatePath("/calendar");
  } catch (err) {
    console.error("revalidatePath(/calendar) failed after a write", err);
  }
}

/**
 * Widen the calendar's range when an item lands outside it, so the item does
 * not fall off the range label and the default focused date.
 *
 * Callers run this BEFORE writing the item. Widening first means a failure
 * here leaves nothing written, so an `ok: false` is always truthful; the
 * reverse order could commit the item and still report failure, and the user
 * would resubmit into a duplicate.
 *
 * Widening is deliberately one-directional — deleting an item never shrinks
 * the window. A generated calendar legitimately spans a range wider than its
 * items (a 90-day plan with a sparse tail), so deriving bounds from min/max
 * item date would corrupt it. The blast radius is bounded instead: the date
 * itself is capped (see itemFieldsSchema) and the default focused date
 * prefers today over the start, so a stretched window cannot strand the user
 * on an empty month.
 */
async function coverDate(
  calendar: { id: string; startDate: Date; endDate: Date },
  date: Date,
): Promise<void> {
  if (expandWindow(calendar, date))
    await widenCalendarWindow(calendar.id, date);
}

/** Non-null by construction: itemFieldsSchema rejects unparseable dates. */
function requireParsedDate(value: string): Date {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`unvalidated date reached the action: ${value}`);
  return parsed;
}

/**
 * Add an item the user typed in themselves. Stamped `source: "manual"` here
 * and never taken from the client, so provenance cannot be forged.
 */
export async function createCalendarItemAction(
  calendarId: string,
  input: CalendarItemFormInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { brand } = await requireBrand();
  const parsed = itemFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  try {
    const calendar = await getOwnedCalendar(calendarId, brand.id);
    if (!calendar) {
      return { ok: false, error: "Calendar not found" };
    }
    const { date, ...rest } = parsed.data;
    const itemDate = requireParsedDate(date);
    if (outOfBoundsMove(itemDate, null)) {
      return { ok: false, error: DATE_BOUNDS_MESSAGE };
    }
    await coverDate(calendar, itemDate);
    const created = await createCalendarItem({
      ...rest,
      calendarId,
      date: itemDate,
      status: "draft",
      source: "manual",
      sortOrder: await nextSortOrderForDate(calendarId, itemDate),
    });
    if (!created) {
      return { ok: false, error: "Could not add the entry" };
    }
    refreshCalendar();
    return { ok: true, id: created.id };
  } catch (err) {
    console.error("createCalendarItemAction failed", err);
    return { ok: false, error: "Could not add the entry" };
  }
}

/**
 * Edit a calendar item's content fields. Same ownership rules as the status
 * action; date arrives as YYYY-MM-DD and is stored as UTC midnight to match
 * how generation stores dates.
 */
export async function updateCalendarItemAction(
  itemId: string,
  input: CalendarItemFormInput,
): Promise<ActionResult> {
  const { brand } = await requireBrand();
  const parsed = itemFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  try {
    const owned = await getOwnedItem(itemId, brand.id);
    if (!owned) {
      return { ok: false, error: "Item not found" };
    }
    const { date, ...rest } = parsed.data;
    const itemDate = requireParsedDate(date);
    if (outOfBoundsMove(itemDate, owned.item.date)) {
      return { ok: false, error: DATE_BOUNDS_MESSAGE };
    }
    await coverDate(owned.calendar, itemDate);
    /* Zero rows means the item vanished between the ownership read and this
       write (a concurrent delete, or a cascade). Reporting success there would
       toast "updated", clear the drawer, and discard the only copy of what the
       user typed. */
    const updated = await updateCalendarItem(itemId, {
      ...rest,
      date: itemDate,
    });
    if (!updated) {
      return { ok: false, error: "Item not found" };
    }
    refreshCalendar();
    return { ok: true };
  } catch (err) {
    console.error("updateCalendarItemAction failed", err);
    return { ok: false, error: "Could not save changes" };
  }
}

/**
 * Remove an entry. Design tickets and generations reference calendar_items
 * with ON DELETE SET NULL, so their history survives the delete.
 */
export async function deleteCalendarItemAction(
  itemId: string,
): Promise<ActionResult> {
  const { brand } = await requireBrand();
  try {
    const owned = await getOwnedItem(itemId, brand.id);
    if (!owned) {
      return { ok: false, error: "Item not found" };
    }
    const deleted = await deleteCalendarItem(itemId);
    if (!deleted) {
      return { ok: false, error: "Item not found" };
    }
    refreshCalendar();
    return { ok: true };
  } catch (err) {
    console.error("deleteCalendarItemAction failed", err);
    return { ok: false, error: "Could not delete the entry" };
  }
}
