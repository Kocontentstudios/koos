"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FrameEdits } from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { designSpecSchema } from "@/lib/design/spec";
import type { FrameSlot } from "./set-model";

/* The renderer's own limits, so a typed line is never cut by the server
   after the user saw it fit here. */
const LIMITS = {
  headline: designSpecSchema.shape.headline.maxLength ?? 70,
  subheadline: designSpecSchema.shape.subheadline.unwrap().maxLength ?? 140,
  cta: designSpecSchema.shape.cta.unwrap().maxLength ?? 32,
} as const;

type Field = keyof typeof LIMITS;

/** A frame's copy as drawn. Null is a line the client was not sent, which
 *  the form leaves to the frame rather than showing as empty. */
export type FrameCopy = Record<Field, string | null>;

type Wire = SerializedGeneration & {
  subheadline?: string | null;
  cta?: string | null;
};

export function frameCopyOf(
  generation: SerializedGeneration | null,
): FrameCopy {
  const row = generation as Wire | null;
  return {
    headline: row?.headline ?? null,
    subheadline: typeof row?.subheadline === "string" ? row.subheadline : null,
    cta: typeof row?.cta === "string" ? row.cta : null,
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
  typed: Record<Field, string>,
): FrameEdits | null {
  const edits: FrameEdits = {};
  for (const field of fields) {
    if (typed[field] !== (initial[field] ?? "")) edits[field] = typed[field];
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

const LABELS: Record<Field, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  cta: "Button text",
};

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
  const [typed, setTyped] = useState<Record<Field, string>>({
    headline: initial.headline ?? "",
    subheadline: initial.subheadline ?? "",
    cta: initial.cta ?? "",
  });
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const edits = editsFrom(fields, initial, typed);
  const hintId = `${id}-hint`;

  return (
    <form
      aria-label={`Edit ${frameName}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (edits) onSubmit(edits);
      }}
      className="flex flex-col gap-3 rounded-xl border bg-[var(--surface-container-low)] p-4"
      style={{ borderColor: "var(--border-control)" }}
    >
      {fields.map((field, i) => {
        const inputId = `${id}-${field}`;
        const unknown = initial[field] === null;
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
              placeholder={unknown ? "Leave empty to keep this line" : ""}
              onChange={(e) =>
                setTyped((t) => ({ ...t, [field]: e.target.value }))
              }
              readOnly={pending}
            />
          </div>
        );
      })}
      <p id={hintId} className="text-[12px] text-[var(--text-muted)]">
        {edits
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
          disabled={!edits}
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
