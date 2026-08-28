"use client";

import { Plus, X } from "lucide-react";
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
} from "@/lib/design/context-search";

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

  const groups = useMemo(
    () => buildGroups(options ?? [], query),
    [options, query],
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
        onOpenChange={setOpen}
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
                  {groups.map((group) => (
                    <ComboboxGroup key={group.type}>
                      <ComboboxGroupLabel>
                        {GROUP_LABELS[group.type]}
                      </ComboboxGroupLabel>
                      {group.options.map((option) => (
                        <ComboboxItem
                          key={keyOf(option)}
                          value={option}
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
                  ))}
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
