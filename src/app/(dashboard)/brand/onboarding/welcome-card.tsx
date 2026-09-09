"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * First-run greeting, shown over the onboarding start screen.
 *
 * Shown over the locked dashboard, which is where every auth path now ends for
 * a user without a brand. "Maybe later" simply closes it and leaves them with
 * the preview underneath; "Set Up Your Brand" walks them into onboarding.
 */
export function WelcomeCard({ onboardingHref }: { onboardingHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  /* Both CTAs answer the question, so both close it for good. Fired without
     awaiting: a failed write should cost a repeat greeting, never a modal the
     user cannot get out of. */
  function resolve(action: "start" | "later") {
    setOpen(false);
    // Act first, record after: what the user asked for must never depend on
    // the telemetry write landing.
    if (action === "start") router.push(onboardingHref);
    try {
      void Promise.resolve(
        fetch("/api/welcome/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
          keepalive: true,
        }),
      ).catch(() => {});
    } catch {
      // A dismissal that fails to record costs a repeat greeting, nothing more.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resolve("later")}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[640px] p-8 text-center sm:p-10"
      >
        <div className="mb-2 flex items-center justify-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#0a6d9e] text-sm font-bold text-white"
          >
            KO
          </span>
          <span className="font-[family-name:var(--font-heading)] text-lg font-semibold text-foreground">
            KO OS
          </span>
        </div>

        <DialogTitle className="font-display text-[28px] font-bold text-foreground sm:text-[32px]">
          Welcome to KO OS
        </DialogTitle>

        <DialogDescription className="mx-auto max-w-[520px] text-[15px] leading-relaxed text-[var(--text-secondary)]">
          One place to run your entire brand: content, campaigns, calendar and
          design. Start with a quick AI onboarding so KO OS learns your brand.
          It takes 2 minutes, and everything you create after will be on-brand.
        </DialogDescription>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            size="lg"
            className="h-12 w-full text-[15px]"
            onClick={() => resolve("start")}
          >
            Set Up Your Brand
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="h-12 w-full text-[15px]"
            onClick={() => resolve("later")}
          >
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
