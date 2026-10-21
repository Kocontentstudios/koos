import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import {
  ACCESS_GATE_PATH,
  isWorkspaceOpen,
} from "@/lib/auth/workspace-approval";

type ActiveWorkspace = Awaited<ReturnType<typeof getActiveWorkspace>>;
type Resolved = Extract<ActiveWorkspace, { dbUser: object }>;

export function isActiveWorkspaceOpen(resolved: Resolved): boolean {
  return isWorkspaceOpen(resolved.workspace.accessStatus, resolved.dbUser.role);
}

/**
 * Page/layout guard: signed out → login, pending workspace → the access gate.
 * Server actions that return result objects use isActiveWorkspaceOpen instead,
 * because a redirect thrown inside their try/catch would be swallowed.
 */
export async function requireOpenWorkspace(): Promise<Resolved> {
  const resolved = await getActiveWorkspace();
  if (!resolved.dbUser) redirectToLogin();
  if (!isActiveWorkspaceOpen(resolved)) redirect(ACCESS_GATE_PATH);
  return resolved;
}
