import type { AttachmentType } from "@/lib/design/attachments";

/** One row the picker can attach. `hint` is the muted second line. */
export interface ContextOption {
  type: AttachmentType;
  id: string;
  label: string;
  hint: string | null;
  /* Calendar items belong to a calendar and the picker groups them by it, so
     a brief saved against an older campaign is findable rather than buried in
     one flat list (KOOS-BUG-016). Absent on every other type. */
  groupId?: string;
  groupLabel?: string;
  /* Something that tells two same-named groups apart. Only rendered when the
     label alone is ambiguous — a brand can easily run two calendars off one
     strategy, and two identically titled groups defeat the point of grouping. */
  groupHint?: string;
}

export interface ContextGroup {
  type: AttachmentType;
  /** Plural heading shown above the group. */
  label: string;
  options: ContextOption[];
  /** How many matched before the collapsed cap — so the UI can say what it is
   *  holding back instead of dropping it silently. */
  total: number;
  /** Set for calendar sub-groups, so each calendar can be expanded on its own. */
  groupId?: string;
}

export const GROUP_LABELS: Record<AttachmentType, string> = {
  brief: "Design briefs",
  calendar_item: "Content calendar",
  ticket: "Design requests",
  strategy: "Campaign strategies",
  asset: "Brand assets",
};

/** Per type, so one noisy category cannot crowd the others out of the list.
 *
 *  This is a COLLAPSED cap, not a limit on what exists: every group reports
 *  its true total and can be expanded to all of it. Silently slicing to 8 was
 *  half of why the picker showed roughly 12 of 30 briefs. */
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
  /** Groups the user has opened, by group key. An expanded group is not
   *  capped — the cap exists to keep the closed list short, not to hide
   *  options from someone who asked to see them. */
  expanded: ReadonlySet<string> = new Set(),
): ContextGroup[] {
  return order.flatMap((type) => {
    const matched = all.filter(
      (o) => o.type === type && matchesQuery(o, query),
    );
    if (matched.length === 0) return [];

    /* Calendar items split further, one sub-group per calendar. Everything
       else is a single group, as before. */
    const byCalendar =
      type === "calendar_item" && matched.some((o) => o.groupId);
    if (!byCalendar) {
      return [group(type, GROUP_LABELS[type], matched, expanded)];
    }

    /* Insertion order, which the API returns newest-calendar-first, so the
       current campaign leads and the order does not change as the user types. */
    const calendars = new Map<string, ContextOption[]>();
    for (const option of matched) {
      const key = option.groupId ?? "";
      const bucket = calendars.get(key);
      if (bucket) bucket.push(option);
      else calendars.set(key, [option]);
    }

    return disambiguate(
      [...calendars].map(([groupId, options]) => ({
        group: group(
          type,
          options[0].groupLabel ?? GROUP_LABELS[type],
          options,
          expanded,
          groupId,
        ),
        hint: options[0].groupHint,
      })),
    );
  });
}

function group(
  type: AttachmentType,
  label: string,
  matched: ContextOption[],
  expanded: ReadonlySet<string>,
  groupId?: string,
): ContextGroup {
  const key = groupKey(type, groupId);
  return {
    type,
    label,
    groupId,
    // The TRUE count, always — a group that says 8 of 34 is honest about the
    // 26 it is holding, which a bare slice never was.
    total: matched.length,
    options: expanded.has(key) ? matched : matched.slice(0, MAX_PER_GROUP),
  };
}

/** Stable key for a group's expanded state. */
export function groupKey(type: AttachmentType, groupId?: string): string {
  return groupId ? `${type}:${groupId}` : type;
}

/**
 * Makes every group in a set tell itself apart from the others.
 *
 * Two calendars off one strategy carry the same name, and two identically
 * titled groups are worse than no grouping — the user cannot tell which
 * contains the brief they want. Escalates only as far as it has to: the bare
 * label, then the label plus its hint, then an ordinal, so an unambiguous
 * group is never cluttered by a suffix it does not need.
 */
function disambiguate(
  entries: { group: ContextGroup; hint?: string }[],
): ContextGroup[] {
  const count = new Map<string, number>();
  for (const { group } of entries) {
    count.set(group.label, (count.get(group.label) ?? 0) + 1);
  }

  const withHint = entries.map(({ group, hint }) =>
    (count.get(group.label) ?? 0) > 1 && hint
      ? { ...group, label: `${group.label} · ${hint}` }
      : group,
  );

  /* Same name AND same hint: two calendars can share a strategy and a date
     range. An ordinal is not informative, but it is unambiguous, which is the
     property that matters here. */
  const stillDuplicated = new Map<string, number>();
  for (const group of withHint) {
    stillDuplicated.set(
      group.label,
      (stillDuplicated.get(group.label) ?? 0) + 1,
    );
  }
  const seen = new Map<string, number>();
  return withHint.map((group) => {
    if ((stillDuplicated.get(group.label) ?? 0) <= 1) return group;
    const n = (seen.get(group.label) ?? 0) + 1;
    seen.set(group.label, n);
    return { ...group, label: `${group.label} (${n})` };
  });
}
