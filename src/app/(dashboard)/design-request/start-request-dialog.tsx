"use client";

import {
  CalendarDays,
  ChevronRight,
  FilePen,
  type LucideIcon,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { captureEvent } from "@/lib/analytics/posthog-client";
import { cn } from "@/lib/utils";
import {
  START_REQUEST_OPTIONS,
  type StartRequestKey,
  type StartRequestOption,
} from "./start-request-options";

const OPTION_ICONS: Record<StartRequestKey, LucideIcon> = {
  direct: FilePen,
  calendar: CalendarDays,
  campaign: Rocket,
};

/** Hover must not resolve toward the dialog's own surface: in light mode
 *  --surface-1 and --surface-2 are both #ffffff, and in dark mode surface-2 is
 *  the popover colour, so the card would dissolve into the sheet on hover. */
const HOVER_TINT = "hover:bg-[var(--hover)]";

function OptionCard({
  option,
  quiet = false,
}: {
  option: StartRequestOption;
  quiet?: boolean;
}) {
  const Icon = OPTION_ICONS[option.key];
  return (
    <Link
      href={option.href}
      onClick={() =>
        captureEvent("design_request_start_selected", { option: option.key })
      }
      className={cn(
        "group flex items-center gap-3 rounded-xl text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]",
        HOVER_TINT,
        quiet
          ? "p-3"
          : "border border-[var(--border)] bg-surface-1 p-4 hover:border-[var(--border-accent)]",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          quiet
            ? "bg-[var(--border)] text-[var(--text-secondary)]"
            : "bg-[rgba(19,139,200,0.15)] text-primary",
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "font-semibold text-foreground",
            quiet ? "text-[13px]" : "text-[14px]",
          )}
        >
          {option.title}
        </span>
        <span className="text-[12px] leading-snug text-[var(--text-secondary)]">
          {option.description}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="ml-auto h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-foreground"
      />
    </Link>
  );
}

interface StartRequestDialogProps {
  label: string;
}

export function StartRequestDialog({ label }: StartRequestDialogProps) {
  const [directOption, calendarOption, campaignOption] = START_REQUEST_OPTIONS;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) captureEvent("design_request_start_opened", { label });
      }}
    >
      <DialogTrigger render={<Button variant="default" size="lg" />}>
        {label}
      </DialogTrigger>
      {/* Bottom sheet on phones rather than a full-screen takeover: three short
          options do not fill a viewport, and covering the backdrop would remove
          tap-outside-to-dismiss, leaving the small corner X as the only exit. */}
      <DialogContent className="grid-rows-[minmax(0,1fr)] gap-0 sm:max-h-[90vh] sm:max-w-md max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[85vh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-8 max-sm:[&_[data-slot=dialog-close]]:size-11 [@media(hover:none)]:[&_[data-slot=dialog-close]]:size-11">
        {/* Scroll the contents, not the popup: the close button is positioned
            against the popup, so scrolling that would carry the X off-screen on
            short viewports. */}
        <div className="flex flex-col overflow-y-auto">
          <DialogHeader className="pr-8 pb-4 max-sm:pr-14 [@media(hover:none)]:pr-14">
            <DialogTitle className="font-display text-[18px] font-bold">
              How do you want to start?
            </DialogTitle>
            <DialogDescription>
              Design requests can start from scratch or from something you have
              already planned.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <OptionCard option={directOption} />
            <OptionCard option={calendarOption} />
            {/* Campaign creation leaves the request flow entirely, so it reads as
              a detour below the divider rather than a third peer. */}
            <Separator className="my-1 h-px w-full" />
            <OptionCard option={campaignOption} quiet />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
