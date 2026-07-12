import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { countWorkspaceBrands, getWorkspacesForUser } from "@/lib/db/queries";
import { SettingsClient } from "./settings-client";

export default async function WorkspaceSettingsPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");
  if (!can(role, "manage_settings")) redirect("/dashboard");

  const [brandCount, memberships] = await Promise.all([
    countWorkspaceBrands(workspace.id),
    getWorkspacesForUser(dbUser.id),
  ]);

  return (
    <SettingsClient
      workspace={{
        id: workspace.id,
        name: workspace.name,
        logoUrl: workspace.logoUrl,
      }}
      brandCount={brandCount}
      canDelete={memberships.length > 1}
    />
  );
}
