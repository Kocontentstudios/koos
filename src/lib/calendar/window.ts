// Pure helpers for the date window a calendar spans. UTC date-only, matching
// how calendar_items store their dates (UTC midnight).

import { utcMidnight } from "./schedule";

export interface CalendarWindow {
  startDate: Date;
  endDate: Date;
}

/** YYYY-MM-DD, the value an `<input type="date">` expects. */
export function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse an `<input type="date">` value back to the stored UTC midnight.
 *
 * Returns null for a date that does not exist. A shape-only regex is not
 * enough: `new Date("2026-02-31T00:00:00Z")` silently rolls over to March 3,
 * which would store the entry on a day the user never picked. Round-tripping
 * the parsed date back to a string is what catches both rollover and NaN.
 */
export function parseDateInput(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateInputValue(parsed) === value ? parsed : null;
}

/**
 * Widen a calendar's window to cover `date`, so an item placed outside the
 * generated range stays reachable (the range label and the default focused
 * date are both derived from these bounds).
 *
 * Returns only the bounds that actually moved, or null when the date already
 * falls inside — callers use null to skip the write entirely.
 */
export function expandWindow(
  current: CalendarWindow,
  date: Date,
): Partial<CalendarWindow> | null {
  const day = utcMidnight(date);
  const start = utcMidnight(current.startDate);
  const end = utcMidnight(current.endDate);

  if (day.getTime() < start.getTime()) return { startDate: day };
  if (day.getTime() > end.getTime()) return { endDate: day };
  return null;
}

/*
 * A native date input's year spinner makes "0202" or "9999" a one-keystroke
 * slip. The calendar window only ever widens, so an absurd year would move
 * where /calendar opens permanently, with no way back from the UI. Generation
 * already bounds model-supplied dates (schedule.ts); this is the same guard
 * for the hand-typed path.
 */
export const MAX_YEARS_OUT = 5;

export const DATE_BOUNDS_MESSAGE = `Pick a date within ${MAX_YEARS_OUT} years`;

/** Inclusive min/max for an `<input type="date">`, as YYYY-MM-DD. */
export function dateBounds(now: Date = new Date()): {
  min: string;
  max: string;
} {
  const year = now.getUTCFullYear();
  return {
    min: `${year - MAX_YEARS_OUT}-01-01`,
    max: `${year + MAX_YEARS_OUT}-12-31`,
  };
}

/** Lexicographic compare is safe: YYYY-MM-DD sorts chronologically. */
export function withinDateBounds(
  value: string,
  now: Date = new Date(),
): boolean {
  const { min, max } = dateBounds(now);
  return value >= min && value <= max;
}
