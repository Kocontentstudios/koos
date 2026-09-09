import { describe, expect, it } from "vitest";
import { dayKey } from "@/lib/calendar/group";
import { resolveFocusedDate } from "./focused-date";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const FALLBACK = "2026-08-24";

describe("resolveFocusedDate", () => {
  it("uses a well-formed date key", () => {
    expect(dayKey(resolveFocusedDate("2026-09-12", FALLBACK))).toBe(
      "2026-09-12",
    );
  });

  /* ?date= is user-editable. A garbage value made the focused date Invalid,
     which then threw a RangeError out of the add drawer's date seeding. */
  it.each(["NOT-A-DATE", "", "2026-13-45", "javascript:alert(1)"])(
    "falls back for %s instead of yielding an Invalid Date",
    (bad) => {
      const focused = resolveFocusedDate(bad, FALLBACK);
      expect(Number.isNaN(focused.getTime())).toBe(false);
      expect(dayKey(focused)).toBe(FALLBACK);
    },
  );

  it("parses to UTC midnight", () => {
    expect(resolveFocusedDate("2026-09-12", FALLBACK).toISOString()).toBe(
      "2026-09-12T00:00:00.000Z",
    );
  });

  it("rejects a date that rolls over rather than silently shifting the day", () => {
    expect(dayKey(resolveFocusedDate("2026-02-31", FALLBACK))).toBe(FALLBACK);
  });

  it("returns a real Date object", () => {
    expect(resolveFocusedDate("2026-09-12", FALLBACK)).toEqual(d("2026-09-12"));
  });
});
