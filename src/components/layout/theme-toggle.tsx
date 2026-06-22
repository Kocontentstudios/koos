"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
] as const;

/**
 * 3-way light / dark / system theme toggle.
 * Mirrors the `.ko-theme-toggle` component from koos_complete/assets/js/theme.js.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — the active button depends on client-only state.
  useEffect(() => setMounted(true), []);

  return (
    <fieldset
      aria-label="Theme"
      className={cn(
        "m-0 border-0 p-0",
        "inline-flex items-center gap-0.5 rounded-[10px] border border-border bg-[var(--hover)] p-[3px]",
        className,
      )}
    >
      {MODES.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-text-secondary transition-colors",
              "hover:text-foreground",
              active && "bg-[var(--accent-glow)] text-primary",
            )}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </fieldset>
  );
}
