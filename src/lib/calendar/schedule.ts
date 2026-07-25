import type { CalendarItemPlan, CalendarPlan } from "@/lib/ai/calendar-schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the given date (date-only normalization). */
export function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function itemDate(start: Date, dayOffset: number): Date {
  return new Date(utcMidnight(start).getTime() + dayOffset * DAY_MS);
}

/**
 * Validate the AI-declared calendar start date (YYYY-MM-DD). Falls back to
 * today's UTC midnight when missing, malformed, in the past, or more than a
 * year out — dates come from a model, so they are never trusted blindly.
 */
export function resolveStartDate(
  planStartDate: string | undefined,
  today: Date,
): Date {
  const todayUtc = utcMidnight(today);
  if (!planStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(planStartDate)) {
    return todayUtc;
  }
  const parsed = new Date(`${planStartDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return todayUtc;
  if (parsed < todayUtc) return todayUtc;
  if (parsed.getTime() - todayUtc.getTime() > 366 * DAY_MS) return todayUtc;
  return parsed;
}

/** Parse a human time ("9:00 AM", "13:30") to minutes-since-midnight for sorting. */
export function parseTimeToMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return 0;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3]?.toLowerCase();
  if (mer === "pm" && h !== 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h * 60 + min;
}

export interface CalendarRow {
  date: Date;
  time: string;
  platform: string;
  contentType: string;
  title: string;
  brief: string;
  designRequired: boolean;
  designType?: string;
  dimensions?: string;
  sortOrder: number;
  slotKey: string;
}

export interface ScheduledCalendar {
  startDate: Date;
  endDate: Date;
  rows: CalendarRow[];
}

/** Map an AI plan onto concrete dates from `start`, sorted by (date, time). */
export function toCalendarRows(
  plan: CalendarPlan,
  start: Date,
): ScheduledCalendar {
  const startDate = utcMidnight(start);
  const withDates = plan.items.map((it: CalendarItemPlan) => ({
    ...it,
    date: itemDate(startDate, it.dayOffset),
  }));

  withDates.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
  });

  const rows: CalendarRow[] = withDates.map((it, i) => ({
    date: it.date,
    time: it.time,
    platform: it.platform,
    contentType: it.contentType,
    title: it.title,
    brief: it.brief,
    designRequired: it.designRequired,
    designType: it.designType,
    dimensions: it.dimensions,
    sortOrder: i,
    slotKey: it.slotKey,
  }));

  const endDate = rows.length
    ? rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date)
    : startDate;

  return { startDate, endDate, rows };
}
