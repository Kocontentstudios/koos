"use client";

import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { adminScopeParsers } from "@/lib/admin/scope-params";
import { cn } from "@/lib/utils";

export interface FilterChoice {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

/* Derived from the shared vocabulary so the custom form cannot drift from the
   grammar the server parses. */
const customParsers = {
  range: adminScopeParsers.range,
  from: adminScopeParsers.from,
  to: adminScopeParsers.to,
  page: adminScopeParsers.page,
};

export interface FilterGroup {
  /** The legend a screen reader hears before the options. */
  legend: string;
  choices: FilterChoice[];
}

/**
 * The analytics filter, behind a button.
 *
 * A button rather than four permanently-open chip rows: the ticket asks for a
 * "visible Filter button", and four groups expanded by default would push the
 * numbers they filter below the fold on a laptop. It opens expanded whenever a
 * filter is active, so an operator can never be looking at narrowed figures
 * with no visible reason why.
 *
 * Every option is a Link carrying the whole scope with one key patched, so the
 * panel needs no state of its own and a filtered view is a shareable URL.
 */
export function AnalyticsFilterBar({
  groups,
  activeCount,
  clearHref,
}: {
  groups: FilterGroup[];
  activeCount: number;
  clearHref: string;
}) {
  const [open, setOpen] = useState(activeCount > 0);
  const [isPending, startTransition] = useTransition();
  const [{ range, from, to }, setQuery] = useQueryStates(customParsers, {
    shallow: false,
    startTransition,
  });
  const fromId = useId();
  const toId = useId();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  /* Back/Forward changes the URL without touching local state. */
  const [lastBounds, setLastBounds] = useState(`${from}|${to}`);
  if (`${from}|${to}` !== lastBounds) {
    setLastBounds(`${from}|${to}`);
    setDraftFrom(from);
    setDraftTo(to);
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-surface-1">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide filters" : "Filter"}
        </Button>

        {activeCount > 0 && (
          <>
            <span className="text-[13px] text-[var(--text-secondary)]">
              {activeCount} {activeCount === 1 ? "filter" : "filters"} applied
            </span>
            <Link
              href={clearHref}
              className="text-[13px] font-semibold text-primary hover:underline"
            >
              Clear all
            </Link>
          </>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-[var(--border)] p-3">
          {groups.map((group) => (
            <fieldset
              key={group.legend}
              className="flex flex-wrap items-center gap-2 border-0 p-0"
            >
              <legend className="sr-only">{group.legend}</legend>
              <span className="min-w-24 text-[12px] uppercase tracking-wide text-[var(--text-secondary)]">
                {group.legend}
              </span>
              {group.choices.map(({ key, label, href, active }) => (
                <Link
                  key={key}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                    active
                      ? "bg-[var(--hover)] text-foreground ring-1 ring-[var(--border-accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              ))}
            </fieldset>
          ))}

          {/* The ticket's fourth date option. Submitting sets range=custom in
              the same navigation as the bounds, so a half-applied state — a
              custom range with the preset still selected — cannot exist. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery({
                range: "custom",
                from: draftFrom || null,
                to: draftTo || null,
                page: null,
              });
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <span className="min-w-24 text-[12px] uppercase tracking-wide text-[var(--text-secondary)]">
              Custom
            </span>
            <span className="flex flex-col gap-1">
              <label
                htmlFor={fromId}
                className="text-[11px] text-[var(--text-secondary)]"
              >
                From
              </label>
              <input
                id={fromId}
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-foreground focus:border-primary focus:outline-none"
              />
            </span>
            <span className="flex flex-col gap-1">
              <label
                htmlFor={toId}
                className="text-[11px] text-[var(--text-secondary)]"
              >
                To
              </label>
              <input
                id={toId}
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-foreground focus:border-primary focus:outline-none"
              />
            </span>
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              loading={isPending}
              disabled={!draftFrom && !draftTo}
            >
              Apply
            </Button>
            {range === "custom" && (
              <span className="text-[12px] text-[var(--text-secondary)]">
                Custom range applied
              </span>
            )}
          </form>

          <p
            role="status"
            className="min-h-4 text-[12px] text-[var(--text-secondary)]"
          >
            {isPending ? "Updating analytics…" : ""}
          </p>
        </div>
      )}
    </section>
  );
}
