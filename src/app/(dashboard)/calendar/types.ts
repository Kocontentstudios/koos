import type { BadgeStatus } from "@/components/ui/status-badge";

/** Whether KO generated the entry or the user added it by hand. */
export type CalendarItemSource = "ai" | "manual";

export type CalendarItemStatus = Extract<
  BadgeStatus,
  "draft" | "in_progress" | "ready" | "published"
>;

/** Item as sent over the server→client boundary (date as ISO string). */
export interface SerializedItem {
  id: string;
  date: string;
  time: string | null;
  platform: string;
  contentType: string;
  title: string;
  brief: string | null;
  caption: string | null;
  notes: string | null;
  designRequired: boolean;
  designType: string | null;
  dimensions: string | null;
  status: CalendarItemStatus;
  source: CalendarItemSource;
}

/** Item after the client parses `date` back to a UTC Date. */
export interface CalendarItem extends Omit<SerializedItem, "date"> {
  date: Date;
}

export interface SerializedCalendar {
  id: string;
  startDate: string;
  endDate: string;
}

/** One entry in the calendar/strategy picker: "<strategy> · <date range>". */
export interface CalendarOption {
  id: string;
  label: string;
}

/** Minimal brand info needed to prefill the Request Design modal. */
export interface BrandSummary {
  id: string;
  name: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
}

export type CalendarView = "month" | "week" | "day" | "agenda";

export function statusLabel(status: CalendarItemStatus): string {
  const map: Record<CalendarItemStatus, string> = {
    draft: "Draft",
    in_progress: "In Progress",
    ready: "Ready",
    published: "Published",
  };
  return map[status];
}

export function sourceLabel(source: CalendarItemSource): string {
  return source === "manual" ? "Added by you" : "KO generated";
}
