"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AttachmentRef } from "@/lib/design/attachments";
import {
  buildGroups,
  type ContextOption,
  GROUP_LABELS,
  groupKey,
  MAX_PER_GROUP,
} from "@/lib/design/context-search";
import { cn } from "@/lib/utils";

/** The picker's own key for an option, since ids are only unique per type. */
const keyOf = (o: Pick<ContextOption, "type" | "id">) => `${o.type}:${o.id}`;

interface ContextPickerProps {
  brandId: string;
  selected: ContextOption[];
  onChange: (next: ContextOption[]) => void;
  disabled?: boolean;
}

export function ContextPicker({
  brandId,
  selected,
  onChange,
  disabled,
}: ContextPickerProps) {
  const [options, setOptions] = useState<ContextOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded on first open rather than on mount: most sessions never attach
  // anything, and this is five queries on the server.
  useEffect(() => {
    if (!open || options !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/design/context?brandId=${brandId}`);
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as { options: ContextOption[] };
        if (!cancelled) setOptions(data.options);
      } catch {
        if (!cancelled) {
          setError("Could not load your content.");
          setOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, options, brandId]);

  /* Which groups the user has opened. Reset when the picker closes, so it
     does not reopen showing 200 rows from a search the user has forgotten. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(
    () => buildGroups(options ?? [], query, undefined, expanded),
    [options, query, expanded],
  );

  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);

  function toggle(option: ContextOption) {
    const key = keyOf(option);
    onChange(
      selectedKeys.has(key)
        ? selected.filter((s) => keyOf(s) !== key)
        : [...selected, option],
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <li key={keyOf(item)}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(19,139,200,0.12)] py-1 pr-1 pl-2.5 text-xs font-medium text-primary">
                <span className="max-w-[180px] truncate">{item.label}</span>
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  aria-label={`Remove ${item.label}`}
                  className="rounded-full p-0.5 hover:bg-[rgba(19,139,200,0.2)]"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Combobox
        multiple
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Closing forgets what was expanded; reopening starts short again.
          if (!next) setExpanded(new Set());
        }}
        inputValue={query}
        onInputValueChange={setQuery}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <ComboboxTrigger
                disabled={disabled}
                aria-label="Give context"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              />
            }
          >
            <Plus aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Give context</TooltipContent>
        </Tooltip>

        <ComboboxPortal>
          <ComboboxPositioner align="start">
            <ComboboxPopup>
              <div className="p-1">
                <ComboboxInput
                  placeholder="Search your briefs, calendar, campaigns…"
                  aria-label="Search context to attach"
                />
              </div>
              {error ? (
                <p className="px-3 py-6 text-center text-[13px] text-[var(--status-error-fg)]">
                  {error}
                </p>
              ) : options === null ? (
                <p
                  role="status"
                  className="px-3 py-6 text-center text-[13px] text-[var(--text-secondary)]"
                >
                  Loading your content…
                </p>
              ) : (
                <ComboboxList>
                  {groups.length === 0 && (
                    <ComboboxEmpty>Nothing matches that.</ComboboxEmpty>
                  )}
                  {groups.map((group) => {
                    const key = groupKey(group.type, group.groupId);
                    const isExpanded = expanded.has(key);
                    /* On the TOTAL, not on what is hidden: `hidden` drops to
                       zero the moment a group expands, so a hidden-based
                       condition removes the control exactly when it is needed
                       to collapse again. */
                    const capped = group.total > MAX_PER_GROUP;
                    /* A calendar sub-group is titled by its campaign; the type
                       heading would repeat "Content calendar" once per
                       calendar and say nothing. */
                    const heading = group.groupId
                      ? `${GROUP_LABELS[group.type]} · ${group.label}`
                      : GROUP_LABELS[group.type];
                    return (
                      <ComboboxGroup
                        key={key}
                        className="grid grid-cols-[1fr_auto] items-center"
                      >
                        <ComboboxGroupLabel>
                          {heading}
                          <span className="ml-1 text-[var(--text-muted)] tabular-nums">
                            {/* The cap used to be stated by the "Show N more"
                                text. Removing that text must not remove the
                                honesty with it. */}
                            {group.options.length < group.total
                              ? `${group.options.length} of ${group.total}`
                              : group.total}
                          </span>
                        </ComboboxGroupLabel>

                        {/* An Item, not a button. A focusable element inside
                            Combobox.List is bounced straight back to the input
                            by the popup's focusin handler, and is invisible to
                            arrow-key navigation because it is not registered in
                            the composite list — which is why the old control
                            was unreachable by both pointer and keyboard.
                            Rendered BEFORE the options so its own index cannot
                            move when rows are inserted or removed beneath it. */}
                        {capped && (
                          <ComboboxItem
                            value={`expand:${key}`}
                            aria-label={
                              isExpanded
                                ? `Show fewer in ${heading}`
                                : `Show all ${group.total} in ${heading}`
                            }
                            className="justify-self-end size-6 justify-center p-0"
                            onClick={(event) => {
                              /* Stops base-ui's own handler, which commits a
                                 selection and — in multiple mode with the input
                                 in the popup — clears the search box. Expanding
                                 must never wipe what the user typed. */
                              event.preventBaseUIHandler();
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (!next.delete(key)) next.add(key);
                                return next;
                              });
                            }}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "size-3.5 transition-transform",
                                isExpanded && "rotate-180",
                              )}
                            />
                          </ComboboxItem>
                        )}

                        {group.options.map((option) => (
                          <ComboboxItem
                            key={keyOf(option)}
                            value={option}
                            className="col-span-2"
                            onClick={() => toggle(option)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-foreground">
                                {option.label}
                              </span>
                              {option.hint && (
                                <span className="block truncate text-[11px] text-[var(--text-muted)]">
                                  {option.hint}
                                </span>
                              )}
                            </span>
                            {selectedKeys.has(keyOf(option)) && (
                              <ComboboxItemIndicator keepMounted />
                            )}
                          </ComboboxItem>
                        ))}
                      </ComboboxGroup>
                    );
                  })}
                </ComboboxList>
              )}
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  );
}

/** What the generate request needs from the picker's selection. */
export function toAttachmentRefs(selected: ContextOption[]): AttachmentRef[] {
  return selected.map(({ type, id }) => ({ type, id }));
}
