"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startConversationalOnboarding } from "./actions";

export function OnboardingStart() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    const result = await startConversationalOnboarding();
    if (!result.ok) {
      toast.error(result.error);
      setStarting(false);
      return;
    }
    // Leave the button in its loading state through the refresh: the server
    // re-render swaps this component out for the chat, so clearing it here
    // only flashes an enabled button the user could double-fire.
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col justify-center gap-6 py-10">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
          KO
        </div>
        <div className="rounded-xl rounded-tl-sm border border-[var(--border)] bg-surface-1 px-4 py-3 text-sm leading-relaxed text-foreground">
          Hi! I'm KO. Instead of filling in a long form, let's just talk — I'll
          ask about your brand a question at a time, then fill in your whole
          profile from what you tell me. You can type, or tap the mic and speak
          to me.
        </div>
      </div>

      <div className="pl-10">
        <Button
          size="lg"
          loading={starting}
          loadingText="Setting things up…"
          onClick={handleStart}
        >
          <Sparkles aria-hidden="true" />
          Start with KO
        </Button>

        <p className="mt-5 text-[13px] text-[var(--text-muted)]">
          Prefer to do it yourself?{" "}
          <Link
            href="/brand/create"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Fill in the form instead
          </Link>
        </p>
      </div>
    </div>
  );
}
