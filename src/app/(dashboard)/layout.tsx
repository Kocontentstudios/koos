import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { GenerationWatcher } from "@/components/layout/generation-watcher";
import { VerifyEmailBanner } from "@/components/layout/verify-email-banner";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getWorkspacesForUser } from "@/lib/db/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser, workspace, role } = await getActiveWorkspace();

  if (!dbUser) {
    redirectToLogin();
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
      <PostHogIdentify userId={dbUser.id} />
      <GenerationWatcher />
      {!dbUser.emailVerifiedAt && <VerifyEmailBanner />}
      {children}
    </DashboardShell>
  );
}
