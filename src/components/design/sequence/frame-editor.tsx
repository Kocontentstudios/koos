"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FrameEdits } from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { COPY_LIMITS } from "@/lib/jobs/directions/schema";
import { cn } from "@/lib/utils";
import type { FrameSlot } from "./set-model";

type Field = "headline" | "subheadline" | "cta";

/* The limits the regenerate-frame route checks an edit against, so a line
   that fits here is never refused there. */
export const FRAME_COPY_LIMITS: Readonly<Record<Field, number>> = {
  headline: COPY_LIMITS.headline,
  subheadline: COPY_LIMITS.subheadline,
  cta: COPY_LIMITS.cta,
};
const LIMITS = FRAME_COPY_LIMITS;

const LABELS: Record<Field, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  cta: "Button text",
};

/** A frame's copy as drawn; an empty string is a line the frame does not
 *  have. */
export type FrameCopy = Record<Field, string>;

export function frameCopyOf(
  generation: SerializedGeneration | null,
): FrameCopy {
  return {
    headline: generation?.headline ?? "",
    subheadline: generation?.subheadline ?? "",
    cta: generation?.cta ?? "",
  };
}

export function editableFields(slot: FrameSlot): Field[] {
  return slot.role === "cta"
    ? ["headline", "subheadline", "cta"]
    : ["headline", "subheadline"];
}

/**
 * Only the lines the user changed, exactly as typed: a line left alone keeps
 * the frame's own text (FrameEdits), and the server draws an edited line
 * without a model rewrite (H9), so nothing here trims or tidies it.
 */
export function editsFrom(
  fields: Field[],
  initial: FrameCopy,
  typed: FrameCopy,
): FrameEdits | null {
  const edits: FrameEdits = {};
  for (const field of fields) {
    if (typed[field] !== initial[field]) edits[field] = typed[field];
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

export interface EditProblem {
  field: Field;
  message: string;
}

/* Checked before the submit, not left to the server: a regenerate is billed,
   so a frame with no headline must never cost a unit to find out. The
   action frame is the only one with a button (H3), and a carousel with no
   action has lost its point, so its button text is required too. A
   subheadline may be cleared; that removes the line. */
export function editProblem(
  fields: Field[],
  typed: FrameCopy,
): EditProblem | null {
  if (typed.headline.trim().length === 0) {
    return { field: "headline", message: "A frame needs a headline." };
  }
  for (const field of fields) {
    if (typed[field].length > LIMITS[field]) {
      return {
        field,
        message: `Keep the ${LABELS[field].toLowerCase()} to ${LIMITS[field]} characters.`,
      };
    }
  }
  if (fields.includes("cta") && typed.cta.trim().length === 0) {
    return { field: "cta", message: "The last frame needs its button text." };
  }
  return null;
}

export interface FrameEditorProps {
  slot: FrameSlot;
  frameName: string;
  pending: boolean;
  onSubmit: (edits: FrameEdits) => void;
  onCancel: () => void;
}

export function FrameEditor({
  slot,
  frameName,
  pending,
  onSubmit,
  onCancel,
}: FrameEditorProps) {
  const id = useId();
  const fields = editableFields(slot);
  const initial = frameCopyOf(slot.generation);
  const [typed, setTyped] = useState<FrameCopy>(initial);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const edits = editsFrom(fields, initial, typed);
  const problem = editProblem(fields, typed);
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const ready = edits !== null && problem === null;

  return (
    <form
      aria-label={`Edit ${frameName}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && edits) onSubmit(edits);
      }}
      className="flex flex-col gap-3 rounded-xl border bg-[var(--surface-container-low)] p-4"
      style={{ borderColor: "var(--border-control)" }}
    >
      {fields.map((field, i) => {
        const inputId = `${id}-${field}`;
        const invalid = problem?.field === field;
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor={inputId}
                className="text-[12px] font-semibold text-foreground"
              >
                {LABELS[field]}
              </label>
              <span
                aria-hidden="true"
                className="text-[11px] tabular-nums text-[var(--text-muted)]"
              >
                {typed[field].length}/{LIMITS[field]}
              </span>
            </div>
            <Input
              ref={i === 0 ? first : undefined}
              id={inputId}
              name={field}
              value={typed[field]}
              maxLength={LIMITS[field]}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? problemId : undefined}
              onChange={(e) =>
                setTyped((t) => ({ ...t, [field]: e.target.value }))
              }
              readOnly={pending}
            />
            {invalid ? (
              <p
                id={problemId}
                role="alert"
                className="text-[12px] text-[var(--status-error-fg)]"
              >
                {problem.message}
              </p>
            ) : null}
          </div>
        );
      })}
      <p
        id={hintId}
        className={cn(
          "text-[12px] text-[var(--text-muted)]",
          problem && "sr-only",
        )}
      >
        {problem
          ? problem.message
          : edits
            ? "Your words are drawn exactly as typed. The palette, type and logo stay the same."
            : "Change a line to regenerate with your words."}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={pending}
          loadingText="Regenerating…"
          disabled={!ready}
          focusableWhenDisabled
          aria-describedby={hintId}
        >
          <RefreshCw aria-hidden="true" />
          Regenerate with my words
        </Button>
      </div>
    </form>
  );
}
