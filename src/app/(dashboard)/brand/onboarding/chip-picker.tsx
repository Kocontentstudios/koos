"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CADENCE_CHIPS,
  type ChipPrompt,
  COMPETITOR_STRENGTH_CHIPS,
  DIFFERENTIATION_CHIPS,
  isSingleSelect,
  maxSelectionFor,
  PLATFORM_CHIPS,
  PRIMARY_PLATFORM_CHIPS,
  VOICE_TONE_CHIPS,
  WORDS_TO_AVOID_CHIPS,
} from "@/lib/onboarding/chips";
import { cn } from "@/lib/utils";

const COPY: Record<
  ChipPrompt,
  {
    options: readonly string[];
    placeholder: string;
    submit: string;
    /** Named per kind: "enough for a clear voice" is nonsense under a
        question about what competitors are good at. */
    atCapNoun: string;
  }
> = {
  tone: {
    options: VOICE_TONE_CHIPS,
    placeholder: "Add your own word",
    submit: "Use these words",
    atCapNoun: "a clear voice",
  },
  avoid: {
    options: WORDS_TO_AVOID_CHIPS,
    placeholder: "Add a word to avoid",
    submit: "Avoid these",
    atCapNoun: "a clear no-go list",
  },
  differentiation: {
    options: DIFFERENTIATION_CHIPS,
    placeholder: "Add your own advantage",
    submit: "That's our edge",
    atCapNoun: "sharp positioning",
  },
  "competitor-strengths": {
    options: COMPETITOR_STRENGTH_CHIPS,
    placeholder: "Add another strength",
    submit: "That's where they lead",
    atCapNoun: "a clear picture of the field",
  },
  platforms: {
    options: PLATFORM_CHIPS,
    placeholder: "Add another channel",
    submit: "These are what we're active on",
    atCapNoun: "a full picture of your channels",
  },
  "primary-platform": {
    options: PRIMARY_PLATFORM_CHIPS,
    placeholder: "Add another channel",
    submit: "That's our main one",
    atCapNoun: "a primary channel",
  },
  "posting-cadence": {
    options: CADENCE_CHIPS,
    placeholder: "Describe how often",
    submit: "That's how often we post",
    atCapNoun: "a cadence",
  },
};

/**
 * Multi-select chips offered under an assistant question, so the user answers
 * by tapping rather than typing. Mirrors PlatformChips' semantics — the same
 * aria-pressed pill with a check when active — but adds a free-text tag input,
 * since a brand's own vocabulary will never be fully covered by a fixed list.
 */
export function ChipPicker({
  kind,
  onSubmit,
  disabled,
}: {
  kind: ChipPrompt;
  onSubmit: (selected: string[]) => void;
  disabled?: boolean;
}) {
  const { options, placeholder, submit, atCapNoun } = COPY[kind];
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  const single = isSingleSelect(kind);
  const max = maxSelectionFor(kind);
  /* A single-select poll is never "at capacity": it holds exactly one by
     design, and picking a second swaps it rather than being refused. */
  const atCap = !single && selected.length >= max;

  function toggle(word: string) {
    setSelected((current) => {
      if (current.includes(word)) return current.filter((w) => w !== word);
      if (single) return [word];
      return current.length >= max ? current : [...current, word];
    });
  }

  function addCustom() {
    const word = custom.trim();
    // Case-insensitive so "bold" cannot sit beside the "Bold" chip.
    const clash = selected.some((w) => w.toLowerCase() === word.toLowerCase());
    if (!word || clash || atCap) return;
    setSelected((current) => (single ? [word] : [...current, word]));
    setCustom("");
  }

  const customAdded = selected.filter(
    (w) => !options.includes(w as (typeof options)[number]),
  );

  return (
    <div className="mt-2 ml-10 flex max-w-[560px] flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {[...options, ...customAdded].map((word) => {
          const active = selected.includes(word);
          return (
            <li key={word}>
              <button
                type="button"
                disabled={disabled || (!active && atCap)}
                aria-pressed={active}
                onClick={() => toggle(word)}
                className={cn(
                  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] transition-colors disabled:opacity-40",
                  active
                    ? "border-[var(--border-accent)] bg-[var(--accent-glow)] text-primary"
                    : "border-transparent bg-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] hover:bg-[rgba(19,139,200,0.12)] hover:text-foreground",
                )}
              >
                {active && <Check aria-hidden="true" className="size-3" />}
                {word}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={custom}
          disabled={disabled || atCap}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-[200px]"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || atCap || custom.trim().length === 0}
          onClick={addCustom}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || selected.length === 0}
          onClick={() => onSubmit(selected)}
        >
          {submit}
        </Button>
      </div>

      {atCap && (
        <p className="text-[12px] text-[var(--text-muted)]">
          That's {max} — enough for {atCapNoun}. Deselect one to swap it.
        </p>
      )}
    </div>
  );
}
