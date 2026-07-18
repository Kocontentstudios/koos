import { getActiveWorkspace } from "@/lib/auth/workspace";
import { type Capability, can } from "@/lib/auth/workspace-access";

type ActiveWorkspace = Awaited<ReturnType<typeof getActiveWorkspace>>;
type Guarded = ActiveWorkspace & {
  dbUser: NonNullable<ActiveWorkspace["dbUser"]>;
};

// Existing routes each phrase their 403 differently ("...manage the team." /
// "...change settings." / "...delete a workspace."). Keep those exact
// strings alive here so refactoring onto the shared guard doesn't change a
// single response byte.
const CAPABILITY_DENIED_MESSAGE: Record<Capability, string> = {
  manage_content: "You don't have permission to do that in this workspace.",
  delete_content: "You don't have permission to do that in this workspace.",
  manage_team: "Only the workspace owner can manage the team.",
  manage_settings: "Only the workspace owner can change settings.",
  delete_workspace: "Only the workspace owner can delete a workspace.",
};

/** Shared route guard: 401 when signed out, 403 when the capability is denied.
 * Returns either the failure Response to return as-is, or the narrowed context. */
export async function guardWorkspaceRoute(
  capability?: Capability,
): Promise<{ response: Response } | { ctx: Guarded }> {
  const resolved = await getActiveWorkspace();
  if (!resolved.dbUser) {
    return {
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (capability && !can(resolved.role, capability)) {
    return {
      response: Response.json(
        { error: CAPABILITY_DENIED_MESSAGE[capability] },
        { status: 403 },
      ),
    };
  }
  return { ctx: resolved as Guarded };
}
