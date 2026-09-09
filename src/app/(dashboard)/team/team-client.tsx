"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type BrandScope,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_RANK,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "@/lib/auth/workspace-access";

export interface TeamBrand {
  id: string;
  name: string;
}
interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  brandScope: BrandScope;
  assignedBrandIds: string[];
}
interface PendingInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  brandScope: BrandScope;
  assignedBrandIds: string[];
  expiresAt: string;
}

/* A 200 can still carry a warning: an invitation sent from a deployment whose
   links point at another deployment succeeded and is useless. Every caller
   goes through `run`, so the warning is surfaced once here rather than being
   wired per button — the Resend path was silently missing it. */
interface ApiResult {
  error: string | null;
  warning?: string;
  /** The request failed but wrote a row — the list is stale either way. */
  saved?: boolean;
}

async function api(path: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    warning?: string;
    saved?: boolean;
  } | null;
  if (res.ok) return { error: null, warning: body?.warning };
  return {
    error: body?.error ?? "Something went wrong. Please try again.",
    saved: body?.saved === true,
  };
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

/** Brands named on a scoped row, so a scoped member's reach is legible. */
function scopeSummary(
  brandScope: BrandScope,
  assignedBrandIds: string[],
  brands: TeamBrand[],
): string | null {
  if (brandScope !== "assigned") return null;
  if (assignedBrandIds.length === 0) return "No brands";
  const names = assignedBrandIds
    .map((id) => brands.find((b) => b.id === id)?.name)
    .filter(Boolean) as string[];
  if (names.length === 0) return "No brands";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
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

function BrandChecklist({
  brands,
  selected,
  disabled,
  onToggle,
}: {
  brands: TeamBrand[];
  selected: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  if (brands.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This workspace has no brands to assign yet.
      </p>
    );
  }
  return (
    <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
      {brands.map((b) => (
        <label
          key={b.id}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
        >
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={selected.includes(b.id)}
            disabled={disabled}
            onChange={() => onToggle(b.id)}
          />
          <span className="truncate">{b.name}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Role picker plus the brand assignment it implies. Scope is derived from the
 * role rather than chosen freely, mirroring resolveBrandScope on the server:
 * brand managers are always assignment-scoped, admins never are.
 */
function RoleFields({
  brands,
  assignableRoles,
  role,
  onRoleChange,
  limitToBrands,
  onLimitChange,
  brandIds,
  onToggleBrand,
  disabled,
  forceBrandPicker = false,
}: {
  brands: TeamBrand[];
  assignableRoles: WorkspaceRole[];
  role: WorkspaceRole;
  onRoleChange: (role: WorkspaceRole) => void;
  limitToBrands: boolean;
  onLimitChange: (next: boolean) => void;
  brandIds: string[];
  onToggleBrand: (id: string) => void;
  disabled: boolean;
  forceBrandPicker?: boolean;
}) {
  const forcedScope = role === "brand_manager" || forceBrandPicker;
  const showPicker = forcedScope || limitToBrands;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="member-role">Role</Label>
        <Select
          value={role}
          onValueChange={(v) => onRoleChange(v as WorkspaceRole)}
        >
          <SelectTrigger id="member-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignableRoles.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[role]}
        </p>
      </div>

      {role === "contributor" && !forceBrandPicker && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={limitToBrands}
            disabled={disabled}
            onChange={(e) => onLimitChange(e.target.checked)}
          />
          Limit to specific brands
        </label>
      )}

      {showPicker && (
        <div className="space-y-1.5">
          <Label>Brands</Label>
          <BrandChecklist
            brands={brands}
            selected={brandIds}
            disabled={disabled}
            onToggle={onToggleBrand}
          />
          <p className="text-xs text-muted-foreground">
            They&apos;ll reach only the brands you tick here.
          </p>
        </div>
      )}
    </>
  );
}

export function TeamClient({
  workspaceName,
  currentUserId,
  viewerRole,
  viewerBrandScope,
  canManage,
  canInvite,
  canManageBrandAccess,
  brands,
  members,
  invitations,
}: {
  workspaceName: string;
  currentUserId: string;
  viewerRole: WorkspaceRole;
  /** A brand-scoped viewer can only ever hand out their own brands, so the
   * picker is mandatory for them. Mirrors evaluateInvite on the server. */
  viewerBrandScope: BrandScope;
  canManage: boolean;
  canInvite: boolean;
  canManageBrandAccess: boolean;
  brands: TeamBrand[];
  members: Member[];
  invitations: PendingInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /* Which specific action is running. `pending` is one boolean for the whole
     component, but Resend/Revoke render per invitation row — keying on it
     alone would spin every row at once and claim five things are processing
     when one is. Mirrors admin/tickets/queue-client.tsx. */
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [formRole, setFormRole] = useState<WorkspaceRole>("contributor");
  const [formLimit, setFormLimit] = useState(false);
  const [formBrandIds, setFormBrandIds] = useState<string[]>([]);

  /* The picker offers only what the server would accept: strictly below the
     viewer's own role, never owner. A brand manager can invite but not manage
     the team, so they see contributor alone. */
  const assignableRoles = useMemo(() => {
    if (!canManage) return ["contributor"] as WorkspaceRole[];
    return WORKSPACE_ROLES.filter(
      (r) => r !== "owner" && ROLE_RANK[r] > ROLE_RANK[viewerRole],
    );
  }, [canManage, viewerRole]);

  function toggleBrand(id: string) {
    setFormBrandIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );
  }

  function run(
    call: () => Promise<ApiResult>,
    opts?: { successMessage?: string; after?: () => void; key?: string },
  ) {
    setRowError(null);
    setActingOn(opts?.key ?? null);
    startTransition(async () => {
      const { error, warning } = await call();
      if (error) {
        setRowError(error);
        toast.error(error);
      } else {
        opts?.after?.();
        // A warning replaces the success toast: the action worked, the result
        // does not, and a green tick beside it would bury that.
        if (warning) toast.warning(warning, { duration: 10_000 });
        else if (opts?.successMessage) toast.success(opts.successMessage);
        router.refresh();
      }
      setActingOn(null);
    });
  }

  function openInvite() {
    setInviteEmail("");
    setInviteError(null);
    // Least privilege by default: the list is ordered most-privileged first,
    // so taking [0] would make "invite and hit send" create an admin.
    setFormRole(assignableRoles[assignableRoles.length - 1] ?? "contributor");
    setFormLimit(false);
    setFormBrandIds([]);
    setInviteOpen(true);
  }

  function openEdit(m: Member) {
    setRowError(null);
    setFormRole(m.role);
    setFormLimit(m.brandScope === "assigned" && m.role === "contributor");
    setFormBrandIds(m.assignedBrandIds);
    setEditTarget(m);
  }

  const viewerIsScoped = viewerBrandScope === "assigned";
  const needsBrands =
    viewerIsScoped ||
    formRole === "brand_manager" ||
    (formRole === "contributor" && formLimit);

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (needsBrands && formBrandIds.length === 0) {
      setInviteError("Choose at least one brand for this person.");
      return;
    }
    startTransition(async () => {
      const { error, warning, saved } = await api(
        "/api/workspace/invitations",
        {
          method: "POST",
          body: JSON.stringify({
            email: inviteEmail,
            role: formRole,
            brandIds: needsBrands ? formBrandIds : [],
          }),
        },
      );
      if (error) {
        setInviteError(error);
        // The invitation was written even though the email failed; without
        // this the Pending tab the message points at is empty.
        if (saved) router.refresh();
      } else {
        setInviteOpen(false);
        setInviteEmail("");
        if (warning) toast.warning(warning, { duration: 10_000 });
        else toast.success("Invitation sent");
        router.refresh();
      }
    });
  }

  function submitEdit() {
    if (!editTarget) return;
    if (needsBrands && formBrandIds.length === 0) {
      setRowError("Choose at least one brand for this person.");
      return;
    }
    run(
      () =>
        api(`/api/workspace/members/${editTarget.userId}`, {
          method: "PATCH",
          body: JSON.stringify({
            role: formRole,
            brandScope: needsBrands ? "assigned" : "all",
            ...(canManageBrandAccess
              ? { brandIds: needsBrands ? formBrandIds : [] }
              : {}),
          }),
        }),
      { after: () => setEditTarget(null), successMessage: "Member updated" },
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"}
          {invitations.length > 0 && ` · ${invitations.length} pending`}
        </p>
        {canInvite && (
          <Button type="button" onClick={openInvite}>
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
            // Mirrors evaluateMemberAuthority: never yourself, never the
            // owner, never someone at or above your own role.
            const canActOn =
              canManage &&
              !isSelf &&
              m.role !== "owner" &&
              ROLE_RANK[m.role] > ROLE_RANK[viewerRole];
            const scope = scopeSummary(
              m.brandScope,
              m.assignedBrandIds,
              brands,
            );
            return (
              <PersonRow
                key={m.userId}
                name={m.name}
                email={m.email}
                avatarUrl={m.avatarUrl}
                right={
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end gap-0.5">
                      <Badge
                        variant={m.role === "owner" ? "default" : "secondary"}
                      >
                        {ROLE_LABELS[m.role]}
                      </Badge>
                      {scope && (
                        <span className="text-xs text-muted-foreground">
                          {scope}
                        </span>
                      )}
                    </div>
                    {isSelf && (
                      <span className="text-xs text-muted-foreground">You</span>
                    )}
                    {canActOn && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => openEdit(m)}
                        >
                          Edit
                        </Button>
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
                      </>
                    )}
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
          {invitations.map((i) => {
            const scope = scopeSummary(
              i.brandScope,
              i.assignedBrandIds,
              brands,
            );
            return (
              <PersonRow
                key={i.id}
                name=""
                email={i.email}
                right={
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col items-end gap-0.5">
                      <Badge variant="secondary">
                        {ROLE_LABELS[i.role]} · Pending
                      </Badge>
                      {scope && (
                        <span className="text-xs text-muted-foreground">
                          {scope}
                        </span>
                      )}
                    </div>
                    {canInvite && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={actingOn === `resend:${i.id}`}
                          loadingText="Resending…"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                api(
                                  `/api/workspace/invitations/${i.id}/resend`,
                                  { method: "POST" },
                                ),
                              {
                                successMessage: "Invitation resent",
                                key: `resend:${i.id}`,
                              },
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
                          loading={actingOn === `revoke:${i.id}`}
                          loadingText="Revoking…"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                api(`/api/workspace/invitations/${i.id}`, {
                                  method: "DELETE",
                                }),
                              {
                                successMessage: "Invitation revoked",
                                key: `revoke:${i.id}`,
                              },
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
            );
          })}
        </TabsContent>
      </Tabs>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader className="pr-8">
            <DialogTitle>Invite Team</DialogTitle>
            <DialogDescription>
              They&apos;ll get an email invitation to join {workspaceName}.
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
            <RoleFields
              brands={brands}
              assignableRoles={assignableRoles}
              role={formRole}
              onRoleChange={setFormRole}
              limitToBrands={formLimit}
              onLimitChange={setFormLimit}
              brandIds={formBrandIds}
              onToggleBrand={toggleBrand}
              disabled={pending}
              forceBrandPicker={viewerIsScoped}
            />
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

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent>
          <DialogHeader className="pr-8">
            <DialogTitle>Edit {editTarget?.name || "member"}</DialogTitle>
            <DialogDescription>
              Changes apply immediately, on their next request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RoleFields
              brands={brands}
              assignableRoles={assignableRoles}
              role={formRole}
              onRoleChange={setFormRole}
              limitToBrands={formLimit}
              onLimitChange={setFormLimit}
              brandIds={formBrandIds}
              onToggleBrand={toggleBrand}
              disabled={pending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={pending}
                loadingText="Saving…"
                onClick={submitEdit}
              >
                Save changes
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

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
              loading={pending}
              loadingText="Removing…"
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
