import { dayKey, monthMatrixSunday, weekDays } from "@/lib/calendar/group";
import { itemsFrom } from "@/lib/calendar/labels";
import type { CalendarItem, CalendarView } from "./types";

/**
 * What the pick-mode banner can honestly tell the user in the current view.
 * - "pick": items are visible AND clickable right here.
 * - "openDay": month renders items as non-interactive chips; the day cell is
 *   the only target, so the user must drill in before they can pick.
 * - "none": nothing left to request a design for in view.
 */
export type PickGuidance = "pick" | "openDay" | "none";

export function resolvePickGuidance(
  view: CalendarView,
  items: CalendarItem[],
  focused: Date,
  submittedItemIds: ReadonlySet<string>,
): PickGuidance {
  /* An item that already has a ticket renders a disabled "Design Ticket
     Submitted" button, so it is visible but not pickable. */
  const open = items.filter((item) => !submittedItemIds.has(item.id));
  const visible = visibleInView(view, open, focused);
  if (visible.length === 0) return "none";

  /* Month renders items as non-interactive chips, so even with posts on screen
     the only thing the user can act on is the day cell. */
  return view === "month" ? "openDay" : "pick";
}

/** The items the given view actually puts on screen for `focused`. Each branch
 *  mirrors the window its view component renders. */
function visibleInView(
  view: CalendarView,
  items: CalendarItem[],
  focused: Date,
): CalendarItem[] {
  if (view === "agenda") return itemsFrom(items, focused);
  if (view === "month")
    return inWindow(items, monthMatrixSunday(focused).flat());
  return inWindow(items, view === "week" ? weekDays(focused) : [focused]);
}

function inWindow(items: CalendarItem[], days: Date[]): CalendarItem[] {
  const keys = new Set(days.map(dayKey));
  return items.filter((item) => keys.has(dayKey(item.date)));
}
