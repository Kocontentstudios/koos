"use client";

import { dateBounds, dateInputValue } from "@/lib/calendar/window";
import type { CalendarItemFormInput } from "./actions";
import type { CalendarItem } from "./types";

export const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[13px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

export function EditField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

/** Blank draft for a new entry on `date`. */
export function emptyDraft(date: Date): CalendarItemFormInput {
  return {
    title: "",
    brief: null,
    caption: null,
    notes: null,
    date: dateInputValue(date),
    time: null,
    platform: "Instagram",
    contentType: "Post",
    designRequired: false,
    designType: null,
    dimensions: null,
  };
}

export function draftFromItem(item: CalendarItem): CalendarItemFormInput {
  return {
    title: item.title,
    brief: item.brief,
    caption: item.caption,
    notes: item.notes,
    date: dateInputValue(item.date),
    time: item.time,
    platform: item.platform,
    contentType: item.contentType,
    designRequired: item.designRequired,
    designType: item.designType,
    dimensions: item.dimensions,
  };
}

interface ItemFormFieldsProps {
  draft: CalendarItemFormInput;
  onPatch: (patch: Partial<CalendarItemFormInput>) => void;
  /** Prefix for field ids, so two forms can coexist in the DOM. */
  idPrefix: string;
  /** Brief is KO's creative direction — hidden when adding by hand. */
  showBrief?: boolean;
}

/**
 * The editable fields of a calendar entry, shared by the add drawer and the
 * detail drawer's edit mode so the two can never fall out of sync.
 */
export function ItemFormFields({
  draft,
  onPatch,
  idPrefix,
  showBrief = true,
}: ItemFormFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  // Mirrors the server-side bound so the picker blocks a year typo up front.
  const bounds = dateBounds();

  return (
    <div className="flex flex-col gap-4">
      <EditField id={id("title")} label="Title">
        <input
          id={id("title")}
          type="text"
          value={draft.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="e.g. Friday sale announcement"
          className={inputCls}
          maxLength={300}
        />
      </EditField>

      <EditField
        id={id("caption")}
        label="Caption"
        hint="The post copy itself, ready to publish."
      >
        <textarea
          id={id("caption")}
          value={draft.caption ?? ""}
          onChange={(e) => onPatch({ caption: e.target.value })}
          rows={4}
          className={inputCls}
          maxLength={5000}
        />
      </EditField>

      {showBrief && (
        <EditField
          id={id("brief")}
          label="Brief"
          hint="Creative direction — what this post should accomplish."
        >
          <textarea
            id={id("brief")}
            value={draft.brief ?? ""}
            onChange={(e) => onPatch({ brief: e.target.value })}
            rows={5}
            className={inputCls}
            maxLength={5000}
          />
        </EditField>
      )}

      <div className="grid grid-cols-2 gap-3">
        <EditField id={id("date")} label="Date">
          <input
            id={id("date")}
            type="date"
            value={draft.date}
            onChange={(e) => onPatch({ date: e.target.value })}
            min={bounds.min}
            max={bounds.max}
            className={inputCls}
          />
        </EditField>
        <EditField id={id("time")} label="Time">
          <input
            id={id("time")}
            type="text"
            value={draft.time ?? ""}
            onChange={(e) => onPatch({ time: e.target.value })}
            placeholder="e.g. 10:00 AM"
            className={inputCls}
            maxLength={50}
          />
        </EditField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <EditField id={id("platform")} label="Platform">
          <input
            id={id("platform")}
            type="text"
            value={draft.platform}
            onChange={(e) => onPatch({ platform: e.target.value })}
            className={inputCls}
            maxLength={100}
          />
        </EditField>
        <EditField id={id("content-type")} label="Content Type">
          <input
            id={id("content-type")}
            type="text"
            value={draft.contentType}
            onChange={(e) => onPatch({ contentType: e.target.value })}
            className={inputCls}
            maxLength={100}
          />
        </EditField>
      </div>

      <EditField
        id={id("notes")}
        label="Notes"
        hint="Internal only — not part of the post."
      >
        <textarea
          id={id("notes")}
          value={draft.notes ?? ""}
          onChange={(e) => onPatch({ notes: e.target.value })}
          rows={3}
          className={inputCls}
          maxLength={2000}
        />
      </EditField>

      <div className="h-px bg-[var(--divider)]" />

      <label className="flex items-center gap-2.5 text-[13px] text-foreground">
        <input
          type="checkbox"
          checked={draft.designRequired}
          onChange={(e) => onPatch({ designRequired: e.target.checked })}
          className="h-4 w-4 accent-[var(--primary)]"
        />
        Design asset required
      </label>

      {draft.designRequired && (
        <div className="grid grid-cols-2 gap-3">
          <EditField id={id("design-type")} label="Design Type">
            <input
              id={id("design-type")}
              type="text"
              value={draft.designType ?? ""}
              onChange={(e) => onPatch({ designType: e.target.value })}
              placeholder="e.g. Carousel"
              className={inputCls}
              maxLength={100}
            />
          </EditField>
          <EditField id={id("dimensions")} label="Dimensions">
            <input
              id={id("dimensions")}
              type="text"
              value={draft.dimensions ?? ""}
              onChange={(e) => onPatch({ dimensions: e.target.value })}
              placeholder="e.g. 1080x1350"
              className={inputCls}
              maxLength={100}
            />
          </EditField>
        </div>
      )}
    </div>
  );
}
