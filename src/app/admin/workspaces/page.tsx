import { requireRole } from "@/lib/auth/require-role";
import { listWorkspacesForAccessReview } from "@/lib/db/queries";
import { WorkspaceAccessTable } from "./workspace-access-table";

export default async function AdminWorkspaceAccessPage() {
  await requireRole(["admin"]);
  const rows = await listWorkspacesForAccessReview();
  const waiting = rows.filter((r) => r.accessStatus === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Workspace access
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          New workspaces wait here until their onboarding call and payment are
          confirmed. Approving one opens the app to its whole team and emails
          the owner.
        </p>
        <p className="mt-2 text-[13px] font-semibold text-foreground">
          {waiting === 0
            ? "Nobody is waiting for approval."
            : `${waiting} waiting for approval`}
        </p>
      </div>
      <WorkspaceAccessTable
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          accessStatus: r.accessStatus,
          ownerName: `${r.ownerFirstName} ${r.ownerLastName}`.trim(),
          ownerEmail: r.ownerEmail,
          signedUpAt: r.createdAt.toISOString(),
          decidedAt: r.accessDecidedAt?.toISOString() ?? null,
          decidedBy: r.deciderFirstName
            ? `${r.deciderFirstName} ${r.deciderLastName ?? ""}`.trim()
            : null,
        }))}
      />
    </div>
  );
}
