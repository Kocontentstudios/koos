// Pure date helpers for the calendar views. All date math is UTC date-only so
// it matches how calendar_items are stored (UTC midnight).

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD key in UTC. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday (UTC midnight) of the week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const delta = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - delta);
  return d;
}

/** The 7 dates Mon…Sun of the week containing `date`. */
export function weekDays(date: Date): Date[] {
  const start = weekStart(date);
  return Array.from(
    { length: 7 },
    (_, i) => new Date(start.getTime() + i * DAY_MS),
  );
}

/**
 * A month grid as weeks of 7 dates (Mon-start), padded with leading/trailing
 * days from adjacent months so every row has 7 cells.
 */
export function monthMatrix(date: Date): Date[][] {
  const first = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const gridStart = weekStart(first);
  const weeks: Date[][] = [];
  const cursor = new Date(gridStart);
  // Always 6 weeks covers any month layout.
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Sunday (UTC midnight) of the week containing `date`. */
function sundayWeekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back up to Sunday (dow 0)
  return d;
}

/**
 * A month grid as 6 weeks of 7 dates, SUNDAY-aligned (Sun…Sat columns) to
 * match the design template's month view. Padded with leading/trailing days
 * from adjacent months so every row has 7 cells. (Week view stays Monday-start
 * via `weekDays`, matching the template's week view.)
 */
export function monthMatrixSunday(date: Date): Date[][] {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const gridStart = sundayWeekStart(first);
  const weeks: Date[][] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

/** Group items (each with a `date`) by UTC day key, preserving input order. */
export function groupItemsByDay<T extends { date: Date }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = dayKey(it.date);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return map;
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}
