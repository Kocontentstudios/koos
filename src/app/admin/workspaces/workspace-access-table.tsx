"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkspaceAccessStatus } from "@/lib/auth/workspace-approval";

export interface WorkspaceAccessRow {
  id: string;
  name: string;
  accessStatus: WorkspaceAccessStatus;
  ownerName: string;
  ownerEmail: string;
  signedUpAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

type Action = "approve" | "revoke";

const ACTION_STATUS: Record<Action, WorkspaceAccessStatus> = {
  approve: "approved",
  revoke: "pending",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function decisionLabel(row: WorkspaceAccessRow): string | null {
  if (!row.decidedAt) {
    return row.accessStatus === "approved" ? "Approved before the gate" : null;
  }
  const verb = row.accessStatus === "approved" ? "Approved" : "Revoked";
  const by = row.decidedBy ? ` by ${row.decidedBy}` : "";
  return `${verb}${by}, ${formatDate(row.decidedAt)}`;
}

export function WorkspaceAccessTable({ rows }: { rows: WorkspaceAccessRow[] }) {
  const router = useRouter();
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<WorkspaceAccessRow | null>(
    null,
  );

  async function act(row: WorkspaceAccessRow, action: Action) {
    setActingOn(`${action}:${row.id}`);
    try {
      const res = await fetch(`/api/admin/workspaces/${row.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ACTION_STATUS[action] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        changed?: boolean;
        emailSent?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not update access");
      reportOutcome(row.name, action, data);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update access",
      );
    } finally {
      setActingOn(null);
      setConfirmRevoke(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
        No workspaces yet.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Signed up</th>
              <th className="px-4 py-3 font-semibold">Access</th>
              <th className="px-4 py-3 font-semibold">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pending = row.accessStatus === "pending";
              return (
                <tr
                  key={row.id}
                  className="border-t border-[var(--border)] align-top text-foreground"
                >
                  <td className="px-4 py-3 font-semibold">{row.name}</td>
                  <td className="px-4 py-3">
                    <div>{row.ownerName || "—"}</div>
                    <div className="text-[var(--text-secondary)]">
                      {row.ownerEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--text-secondary)]">
                    {formatDate(row.signedUpAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={pending ? "pending" : "ready"}>
                      {pending ? "Waiting" : "Approved"}
                    </StatusBadge>
                    {decisionLabel(row) && (
                      <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                        {decisionLabel(row)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {pending ? (
                      <Button
                        onClick={() => act(row, "approve")}
                        loading={actingOn === `approve:${row.id}`}
                        loadingText={
                          <>
                            Approving{" "}
                            <span className="sr-only">{row.name}</span>…
                          </>
                        }
                        disabled={actingOn !== null}
                      >
                        Approve <span className="sr-only">{row.name}</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmRevoke(row)}
                        disabled={actingOn !== null}
                      >
                        Revoke{" "}
                        <span className="sr-only">access for {row.name}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open && actingOn === null) setConfirmRevoke(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke access for {confirmRevoke?.name}?</DialogTitle>
            <DialogDescription>
              Everyone in this workspace goes back to the booking page until it
              is approved again. Their brands and content are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmRevoke(null)}
              disabled={actingOn !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && act(confirmRevoke, "revoke")}
              loading={
                confirmRevoke !== null &&
                actingOn === `revoke:${confirmRevoke.id}`
              }
              loadingText="Revoking…"
            >
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function reportOutcome(
  name: string,
  action: Action,
  data: { changed?: boolean; emailSent?: boolean },
) {
  if (!data.changed) {
    toast.info(
      action === "approve"
        ? `${name} was already approved`
        : `${name} was already waiting`,
    );
    return;
  }
  if (action === "revoke") {
    toast.success(`Access revoked for ${name}`);
    return;
  }
  if (data.emailSent) {
    toast.success(`${name} approved. The owner has been emailed.`);
  } else {
    toast.warning(
      `${name} approved, but the email to the owner did not send. Let them know directly.`,
    );
  }
}
