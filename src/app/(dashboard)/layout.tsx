import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getWorkspacesForUser } from "@/lib/db/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser, workspace, role } = await getActiveWorkspace();

  if (!dbUser) {
    redirect("/login");
  }

  const memberships = await getWorkspacesForUser(dbUser.id);

  const user = {
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    avatarUrl: dbUser.avatarUrl,
  };

  return (
    <DashboardShell
      user={user}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        logoUrl: workspace.logoUrl,
        role,
      }}
      memberships={memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        logoUrl: m.workspace.logoUrl,
        role: m.role,
      }))}
    >
      {children}
    </DashboardShell>
  );
}
