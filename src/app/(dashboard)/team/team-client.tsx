"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "owner" | "member";
}
interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
}

async function api(path: string, init?: RequestInit): Promise<string | null> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "Something went wrong. Please try again.";
}

function initialsOf(name: string, email: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length)
    return parts
      .map((p) => p[0])
      .slice(0, 2)
      .join("");
  return email.slice(0, 2).toUpperCase();
}

function PersonRow({
  name,
  email,
  avatarUrl,
  right,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <Avatar
        size="lg"
        className="shrink-0 bg-gradient-to-br from-[#e8a0b0] to-[#7c5cff]"
      >
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name || email} />}
        <AvatarFallback className="bg-transparent text-sm font-semibold text-white">
          {initialsOf(name, email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name || email}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
      {right}
    </div>
  );
}

export function TeamClient({
  workspaceName,
  currentUserId,
  canManage,
  members,
  invitations,
}: {
  workspaceName: string;
  currentUserId: string;
  canManage: boolean;
  members: Member[];
  invitations: PendingInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function run(
    call: () => Promise<string | null>,
    opts?: { successMessage?: string; after?: () => void },
  ) {
    setRowError(null);
    startTransition(async () => {
      const error = await call();
      if (error) {
        setRowError(error);
        toast.error(error);
      } else {
        opts?.after?.();
        if (opts?.successMessage) toast.success(opts.successMessage);
        router.refresh();
      }
    });
  }

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    startTransition(async () => {
      const error = await api("/api/workspace/invitations", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (error) {
        setInviteError(error);
      } else {
        setInviteOpen(false);
        setInviteEmail("");
        toast.success("Invitation sent");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"}
          {invitations.length > 0 && ` · ${invitations.length} pending`}
        </p>
        {canManage && (
          <Button
            type="button"
            onClick={() => {
              setInviteEmail("");
              setInviteError(null);
              setInviteOpen(true);
            }}
          >
            <Plus />
            Invite Team
          </Button>
        )}
      </div>

      {rowError && (
        <p role="alert" className="text-sm text-[var(--status-error-fg)]">
          {rowError}
        </p>
      )}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">All Members</TabsTrigger>
          <TabsTrigger value="pending">
            Pending{invitations.length > 0 ? ` (${invitations.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-3 space-y-2">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            return (
              <PersonRow
                key={m.userId}
                name={m.name}
                email={m.email}
                avatarUrl={m.avatarUrl}
                right={
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={m.role === "owner" ? "default" : "secondary"}
                    >
                      {m.role === "owner" ? "Owner" : "Member"}
                    </Badge>
                    {canManage &&
                      (isSelf ? (
                        <span className="text-xs text-muted-foreground">
                          You
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => setRemoveTarget(m)}
                          className="text-[var(--status-error-fg)] hover:text-[var(--status-error-fg)]"
                        >
                          Remove
                        </Button>
                      ))}
                  </div>
                }
              />
            );
          })}
        </TabsContent>

        <TabsContent value="pending" className="mt-3 space-y-2">
          {invitations.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          )}
          {invitations.map((i) => (
            <PersonRow
              key={i.id}
              name=""
              email={i.email}
              right={
                <div className="flex items-center gap-1">
                  <Badge variant="secondary">Pending</Badge>
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              api(`/api/workspace/invitations/${i.id}/resend`, {
                                method: "POST",
                              }),
                            { successMessage: "Invitation resent" },
                          )
                        }
                        className="text-primary hover:text-primary"
                      >
                        Resend
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              api(`/api/workspace/invitations/${i.id}`, {
                                method: "DELETE",
                              }),
                            { successMessage: "Invitation revoked" },
                          )
                        }
                        className="text-[var(--status-error-fg)] hover:text-[var(--status-error-fg)]"
                      >
                        Revoke
                      </Button>
                    </>
                  )}
                </div>
              }
            />
          ))}
        </TabsContent>
      </Tabs>

      {/* Invite Team modal — email only, per the prototype */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader className="pr-8">
            <DialogTitle>Invite Team</DialogTitle>
            <DialogDescription>
              They&apos;ll get an email invitation to join {workspaceName} as a
              Member.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="teammate@company.com"
                value={inviteEmail}
                disabled={pending}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            {inviteError && (
              <p role="alert" className="text-sm text-[var(--status-error-fg)]">
                {inviteError}
              </p>
            )}
            <DialogFooter>
              <DialogClose
                render={<Button type="button" variant="secondary" />}
              >
                Cancel
              </DialogClose>
              <Button type="submit" loading={pending} loadingText="Sending…">
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove member confirmation */}
      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <DialogContent>
          <DialogHeader className="pr-8">
            <DialogTitle>Remove {removeTarget?.name || "member"}?</DialogTitle>
            <DialogDescription>
              They immediately lose access to all workspace data — brands,
              campaigns, calendars, and design tickets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRemoveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!removeTarget) return;
                run(
                  () =>
                    api(`/api/workspace/members/${removeTarget.userId}`, {
                      method: "DELETE",
                    }),
                  {
                    after: () => setRemoveTarget(null),
                    successMessage: "Member removed",
                  },
                );
              }}
              className="bg-[var(--status-error-fg)] text-white hover:bg-[var(--status-error-fg)]/90"
            >
              Remove Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
