"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailHealthReport } from "@/lib/admin/email-health";

type Health = EmailHealthReport & {
  connection: { ok: boolean; kind: string | null; detail: string | null };
};

const NOTES_FALLBACK: string[] = [];

const CONNECTION_LABEL: Record<string, string> = {
  config: "Not configured",
  auth: "Credentials rejected",
  relay: "Sender address refused",
  recipient: "Recipient address rejected",
  tls: "TLS handshake failed",
  throttled: "Mail server is throttling us",
  connection: "Mail server unreachable",
  unknown: "Connection failed",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
      <span className="text-right text-[13px] font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * Authenticating is not the same as delivering. A refused sender address or an
 * invite link pointing at another deployment both leave verify() succeeding
 * while every recipient gets nothing, so a warning downgrades the headline
 * rather than sitting underneath a green tick.
 */
function headline(health: Health) {
  if (!health.connection.ok) {
    return {
      Icon: XCircle,
      tone: "text-[var(--status-error-fg)]",
      text:
        CONNECTION_LABEL[health.connection.kind ?? "unknown"] ??
        "Connection failed",
    };
  }
  if (health.warnings.length > 0) {
    return {
      Icon: AlertTriangle,
      tone: "text-[var(--status-pending-fg)]",
      text: "Authenticated, but delivery is at risk",
    };
  }
  /* Never claim delivery over an unresolved note. Authenticating proves the
     credentials, not that a message lands or that its links reach this
     deployment — a green tick above an open question reads as an all-clear. */
  if ((health.notes ?? NOTES_FALLBACK).length > 0) {
    return {
      Icon: Info,
      tone: "text-[var(--text-secondary)]",
      text: "Connected — delivery not fully verified",
    };
  }
  return {
    Icon: CheckCircle2,
    tone: "text-[var(--status-ready-fg)]",
    text: "Connected and delivering",
  };
}

export function EmailHealthPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/email/health");
      if (!res.ok) throw new Error("Could not read the email configuration.");
      setHealth((await res.json()) as Health);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "Could not read the configuration.",
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendTest() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send the test.");
      toast.success(`Test email sent to ${to.trim()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  const state = health ? headline(health) : null;

  return (
    <section
      aria-label="Email delivery health"
      className="flex max-w-md flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-foreground">
            Email (SMTP)
          </h2>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Credentials come from environment variables and are never shown
            here.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={checking}
          loadingText="Checking…"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Re-check
        </Button>
      </div>

      {/* Scoped to the report: a live region must not wrap the test-send form,
          or assistive tech re-announces the controls on every refresh. */}
      <div role="status" className="flex flex-col gap-3">
        {loadError ? (
          <p className="text-[13px] text-[var(--status-error-fg)]">
            {loadError}
          </p>
        ) : !health || !state ? (
          <div className="flex flex-col gap-2">
            <span className="sr-only">Checking the mail server…</span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <state.Icon
                aria-hidden="true"
                className={`size-4 ${state.tone}`}
              />
              <span className="text-[13px] font-medium text-foreground">
                {state.text}
              </span>
            </div>

            {health.warnings.map((warning) => (
              <p
                key={warning}
                className="flex gap-2 text-[12px] text-[var(--status-pending-fg)]"
              >
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {warning}
              </p>
            ))}

            {/* Things the environment cannot settle. Kept visually quieter
                than a warning so a correct setup is not permanently amber. */}
            {(health.notes ?? NOTES_FALLBACK).map((note) => (
              <p
                key={note}
                className="flex gap-2 text-[12px] text-[var(--text-muted)]"
              >
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {note}
              </p>
            ))}

            {health.connection.detail ? (
              <p className="text-[12px] text-[var(--status-error-fg)]">
                {health.connection.detail}
              </p>
            ) : null}

            <div className="divide-y divide-[var(--border)]">
              <Row label="Server" value={`${health.host}:${health.port}`} />
              <Row label="Mailbox" value={health.smtpUser ?? "not set"} />
              <Row
                label="Sends as"
                value={
                  health.mailFrom
                    ? `${health.mailFrom}${health.fromMatchesUser ? "" : " (alias)"}`
                    : "not set"
                }
              />
              <Row label="Environment" value={health.vercelEnv ?? "local"} />
              <Row label="Invite links use" value={health.inviteLinkBase} />
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
        <Label htmlFor="smtp-test-to">Send a test email</Label>
        <div className="flex gap-2">
          <Input
            id="smtp-test-to"
            type="email"
            value={to}
            disabled={sending}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
          />
          <Button
            variant="secondary"
            loading={sending}
            loadingText="Sending…"
            disabled={!to.trim()}
            onClick={sendTest}
          >
            Send
          </Button>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Authentication succeeding is not proof of delivery — a refused sender
          address only fails on a real send.
        </p>
      </div>
    </section>
  );
}
