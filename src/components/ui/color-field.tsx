"use client";

import { Palette } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { contrastRatio } from "@/lib/design/palette";
import { cn } from "@/lib/utils";
import { normalizeHex } from "@/lib/validation/hex";

/** What the native picker opens on when the field holds no hex to start from. */
const PICKER_FALLBACK = "#138BC8";

/** Whichever ink the WCAG ratio says is more legible on this fill. */
function inkFor(swatch: string): "dark" | "light" {
  return contrastRatio("#000000", swatch) >= contrastRatio("#FFFFFF", swatch)
    ? "dark"
    : "light";
}

/**
 * Inline colour row: [wheel swatch] [hex or name] [label]. The swatch opens the
 * native colour picker; the text commits on blur.
 *
 * `allowFreeText` exists for the conversational onboarding path, which stores
 * colour NAMES: parseAdditionalColors never hex-validates, and the paid
 * onboarding eval asserts primaryColor contains "green". Reverting a non-hex
 * value there would silently discard what the user actually said, so the text
 * is kept verbatim and the swatch reads as empty instead.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  allowFreeText = false,
  placeholder,
  noun = "colour",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowFreeText?: boolean;
  placeholder?: string;
  /** Noun used in the swatch's accessible name. A prop because the two screens
   *  ship different spellings in their visible copy and this change is not a
   *  copy pass; unifying them is its own ticket. */
  noun?: string;
}) {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Take an externally-changed value ("Pick from logo", a draft restore) without
  // a setState-in-effect — but never mid-word, or the write lands on a user who
  // is still typing and deletes what they had.
  if (!editing && value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  const swatch = normalizeHex(value);

  function commit() {
    setEditing(false);
    // Visiting a field is not editing it. Tracked as a flag rather than by
    // comparing text to value, because an edit that nets back to the original
    // is still an edit — and because `value` may be a display fallback the
    // parent has not stored (create form: `state.primaryColor || "#138BC8"`),
    // so comparing against it would swallow a real commit.
    if (!dirty.current) {
      setLastValue(value);
      setText(value);
      return;
    }
    dirty.current = false;
    // The exits below deliberately leave `lastValue` alone: the parent is
    // expected to store what it is handed, so the next render's sync reconciles
    // it. A parent that rejects or rewrites the value inside onChange would
    // strand this field showing something it does not have.
    const hex = normalizeHex(text);
    if (hex) {
      setText(hex);
      onChange(hex);
      return;
    }
    if (!allowFreeText) {
      setText(value);
      return;
    }
    const kept = text.trim();
    setText(kept);
    onChange(kept);
  }

  function openPicker() {
    const input = colorInputRef.current;
    if (!input) return;
    // showPicker is the sanctioned API, but it throws without transient user
    // activation and does not exist before Chrome 99 / Safari 16.4 — click()
    // covers both, and is what jsdom exercises.
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  }

  return (
    <div className="relative flex items-center gap-2.5">
      <button
        type="button"
        aria-label={`Pick ${label} ${noun}`}
        data-empty={swatch ? "false" : "true"}
        onClick={openPicker}
        className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border data-[empty=true]:border-dashed"
        style={{
          backgroundColor: swatch ?? "transparent",
          // Inline, not a border-[] class: globals.css sets border-color on an
          // unlayered `*`, which beats every Tailwind utility. --border-control
          // rather than --border because a control boundary has to clear WCAG
          // 1.4.11's 3:1, and the surface tokens sit far below it.
          borderColor: "var(--border-control)",
        }}
      >
        <Palette
          aria-hidden="true"
          className={cn(
            "size-4",
            // The fill is user-chosen, so no theme token can be trusted against
            // it — the ink comes from the measured contrast instead. #FFFFFF is
            // the create form's default secondary, which fixed white vanishes on.
            !swatch && "text-[var(--text-muted)]",
            swatch &&
              (inkFor(swatch) === "dark" ? "text-black/70" : "text-white/90"),
          )}
        />
      </button>
      {/* Sibling, not a child of the button: a form control inside a <button>
          is invalid HTML and a real click would reach both. */}
      <input
        ref={colorInputRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        value={swatch ?? PICKER_FALLBACK}
        onChange={(e) => {
          const next = normalizeHex(e.target.value) ?? e.target.value;
          onChange(next);
          setText(next);
        }}
        className="pointer-events-none absolute bottom-0 left-0 size-0 opacity-0"
      />
      <Input
        id={id}
        aria-label={`${label} ${noun}`}
        // One width for both modes: a brand created conversationally carries
        // colour NAMES, and brand-to-form-state feeds those straight into the
        // create form, where a hex-sized box clips them.
        className="w-[140px]"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
        onFocus={() => setEditing(true)}
        onBlur={commit}
      />
      <label
        htmlFor={id}
        className="whitespace-nowrap text-[12px] text-[var(--text-muted)]"
      >
        {label}
      </label>
    </div>
  );
}
