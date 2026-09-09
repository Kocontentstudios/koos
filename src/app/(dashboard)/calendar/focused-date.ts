import { parseDateInput } from "@/lib/calendar/window";

/**
 * Resolve the `?date=` query param to the focused day.
 *
 * The param is user-editable, so a garbage value would otherwise produce an
 * Invalid Date and throw a RangeError out of the add drawer's date seeding.
 * `parseDateInput` also rejects a date that would roll over (2026-02-31),
 * which would silently focus a different day than the URL names.
 */
export function resolveFocusedDate(dateKey: string, fallback: string): Date {
  return parseDateInput(dateKey) ?? parseDateInput(fallback) ?? new Date();
}
