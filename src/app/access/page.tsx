import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { redirectToLogin } from "@/lib/auth/redirects";
import { isActiveWorkspaceOpen } from "@/lib/auth/require-open-workspace";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getWorkspacesForUser } from "@/lib/db/queries";
import { AccessGate } from "./access-gate";

export const metadata: Metadata = {
  title: "KO OS — Discover your workspace",
};

export default async function AccessPage() {
  const resolved = await getActiveWorkspace();
  if (!resolved.dbUser) redirectToLogin();
  // An approved workspace (or a staff account) has nothing to wait for.
  if (isActiveWorkspaceOpen(resolved)) redirect("/dashboard");

  const { dbUser, workspace } = resolved;
  const memberships = await getWorkspacesForUser(dbUser.id);
  const openWorkspaces = memberships
    .filter(
      (m) =>
        m.workspaceId !== workspace.id &&
        m.workspace.accessStatus === "approved",
    )
    .map((m) => ({ id: m.workspace.id, name: m.workspace.name }));

  return (
    <>
      <PostHogIdentify userId={dbUser.id} />
      <AccessGate
        workspaceId={workspace.id}
        email={dbUser.email}
        openWorkspaces={openWorkspaces}
      />
    </>
  );
}
