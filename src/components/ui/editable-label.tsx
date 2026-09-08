"use client";

import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_COLOUR_LABEL,
  sanitiseColourLabel,
} from "@/lib/brand/colour-labels";

/**
 * A label the user can rename in place.
 *
 * Rendered as a button rather than a click handler on text: the affordance has
 * to be reachable by keyboard and announced as actionable, which a div with an
 * onClick is not. Enter or Space opens it, Enter commits, Escape cancels and
 * restores what was there.
 *
 * Committing an empty value clears the custom name rather than storing a blank
 * — the caller falls back to its positional default, which is the ticket's
 * "sensible fallback name".
 */
export function EditableLabel({
  value,
  isDefault,
  onCommit,
  describedBy,
}: {
  value: string;
  /** True when `value` is a fallback, so the field opens empty to type into. */
  isDefault?: boolean;
  onCommit: (next: string) => void;
  describedBy?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function open() {
    /* A default is the app's word, not the user's — opening with it prefilled
       would make them clear "Additional 2" before typing. */
    setDraft(isDefault ? "" : value);
    setEditing(true);
  }

  function commit() {
    onCommit(sanitiseColourLabel(draft));
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        /* Explicit, so the control is addressable on its own: the swatch it
           sits beside already carries the same words in "Pick Accent color"
           and "Remove Accent". */
        aria-label={`Rename ${value}`}
        aria-describedby={describedBy}
        className="group inline-flex items-center gap-1 rounded text-left text-[13px] text-[var(--text-secondary)] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <span>{value}</span>
        <Pencil
          aria-hidden="true"
          className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        value={draft}
        aria-label={`Name for ${value}`}
        aria-describedby={hintId}
        maxLength={MAX_COLOUR_LABEL}
        placeholder={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            /* Restores rather than commits: Escape has to be a way out. */
            setEditing(false);
          }
        }}
        className="h-7 w-32 rounded border border-[var(--border-control)] bg-transparent px-2 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]"
      />
      <span id={hintId} className="sr-only">
        Press Enter to save, Escape to cancel. Leave it empty to use the default
        name.
      </span>
    </span>
  );
}
