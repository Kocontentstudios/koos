"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  initialDesignTeamEmail,
}: {
  initialDesignTeamEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialDesignTeamEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designTeamEmail: email.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not save settings.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="design-team-email">
          Design team notification email
        </Label>
        <Input
          id="design-team-email"
          type="email"
          value={email}
          disabled={pending}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="design@yourcompany.com"
        />
        <p className="text-[11px] text-[var(--text-muted)]">
          New design requests are emailed here. Leave blank to use the mail
          account's default address.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      <Button
        variant="default"
        loading={pending}
        loadingText="Saving…"
        disabled={pending}
        onClick={submit}
        className="self-start"
      >
        Save
      </Button>
    </div>
  );
}
