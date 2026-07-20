"use client";

import { MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { resendVerificationEmail } from "@/app/(auth)/actions";

/** Soft-gate nag shown on every dashboard page until the email is verified. */
export function VerifyEmailBanner() {
  const [sending, setSending] = useState(false);

  async function resend() {
    setSending(true);
    try {
      const result = await resendVerificationEmail();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Verification email sent — check your inbox.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border)] bg-[var(--status-pending-bg)] px-4 py-2.5 text-[13px] text-[var(--status-pending-fg)]"
    >
      <MailWarning size={16} aria-hidden="true" className="shrink-0" />
      <span>
        Verify your email address to unlock strategy and calendar generation —
        we sent you a link.
      </span>
      <button
        type="button"
        onClick={resend}
        disabled={sending}
        className="font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
      >
        {sending ? "Sending…" : "Resend email"}
      </button>
    </div>
  );
}
