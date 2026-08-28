import type { AttachmentType } from "@/lib/design/attachments";

/** One row the picker can attach. `hint` is the muted second line. */
export interface ContextOption {
  type: AttachmentType;
  id: string;
  label: string;
  hint: string | null;
}

export interface ContextGroup {
  type: AttachmentType;
  /** Plural heading shown above the group. */
  label: string;
  options: ContextOption[];
}

export const GROUP_LABELS: Record<AttachmentType, string> = {
  brief: "Design briefs",
  calendar_item: "Content calendar",
  ticket: "Design requests",
  strategy: "Campaign strategies",
  asset: "Brand assets",
};

/** Per type, so one noisy category cannot crowd the others out of the list. */
export const MAX_PER_GROUP = 8;

export function matchesQuery(option: ContextOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.label.toLowerCase().includes(q) ||
    (option.hint?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Filters and caps the picker's options.
 *
 * Groups keep a fixed order rather than being sorted by match count, so the
 * list does not reshuffle under the user as they type.
 */
export function buildGroups(
  all: ContextOption[],
  query: string,
  order: AttachmentType[] = [
    "brief",
    "calendar_item",
    "ticket",
    "strategy",
    "asset",
  ],
): ContextGroup[] {
  return order
    .map((type) => ({
      type,
      label: GROUP_LABELS[type],
      options: all
        .filter((o) => o.type === type && matchesQuery(o, query))
        .slice(0, MAX_PER_GROUP),
    }))
    .filter((group) => group.options.length > 0);
}
