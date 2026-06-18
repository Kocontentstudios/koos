"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { normalizeHex } from "@/lib/validation/hex";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  id?: string;
}

export function ColorPicker({
  value,
  onChange,
  label,
  id: idProp,
}: ColorPickerProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  function handleBlur() {
    const n = normalizeHex(text);
    if (n) {
      setText(n);
      onChange(n);
      setError(null);
    } else {
      setError("Enter a valid hex color");
    }
  }

  function handleColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = normalizeHex(e.target.value) ?? e.target.value;
    onChange(n);
    setText(n);
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="text-[13px] text-[var(--text-secondary)]"
        >
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(
            "size-8 rounded-md border border-[var(--border)] shrink-0",
          )}
          style={{ backgroundColor: value }}
          aria-label="Pick color"
          onClick={() => colorInputRef.current?.click()}
        />
        <input
          ref={colorInputRef}
          type="color"
          className="sr-only"
          value={value}
          onChange={handleColorChange}
          tabIndex={-1}
        />
        <input
          id={id}
          type="text"
          className={cn(
            "flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-[13px] text-foreground outline-none focus:border-[var(--border-accent)]",
            error && "border-[var(--status-error-fg)]",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          aria-invalid={!!error}
        />
      </div>
      {error && (
        <p className="text-[12px] text-[var(--status-error-fg)]">{error}</p>
      )}
    </div>
  );
}
