import { getActiveWorkspace } from "@/lib/auth/workspace";
import { type Capability, can } from "@/lib/auth/workspace-access";

type ActiveWorkspace = Awaited<ReturnType<typeof getActiveWorkspace>>;
type Guarded = ActiveWorkspace & {
  dbUser: NonNullable<ActiveWorkspace["dbUser"]>;
};

/* Denial copy is per capability so the message names the bar the caller
   missed. These deliberately say "workspace admin access" rather than
   "the workspace owner": admins hold everything here except deleting the
   workspace, which stays owner-only. */
const CAPABILITY_DENIED_MESSAGE: Record<Capability, string> = {
  manage_content: "You don't have permission to do that in this workspace.",
  create_brand: "You need workspace admin access to add a brand.",
  delete_brand: "You need workspace admin access to delete a brand.",
  approve_deliverables: "You don't have permission to approve this work.",
  manage_team: "You need workspace admin access to manage the team.",
  invite_contributor: "You don't have permission to invite people.",
  manage_brand_access:
    "You need workspace admin access to change brand access.",
  manage_settings: "You need workspace admin access to change settings.",
  delete_workspace: "Only the workspace owner can delete a workspace.",
  transfer_ownership: "Only the workspace owner can transfer ownership.",
  view_billing: "Only the workspace owner can see billing.",
  manage_billing: "Only the workspace owner can manage billing.",
};

/**
 * Shared route guard: 401 when signed out, 403 when the capability is denied.
 * Returns either the failure Response to return as-is, or the narrowed
 * context. An array of capabilities passes when the caller holds ANY of them
 * (the invite route accepts manage_team or invite_contributor); the denial
 * message then names the first, which is the broader bar.
 */
export async function guardWorkspaceRoute(
  capability?: Capability | Capability[],
): Promise<{ response: Response } | { ctx: Guarded }> {
  const resolved = await getActiveWorkspace();
  if (!resolved.dbUser) {
    return {
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (capability) {
    const required = Array.isArray(capability) ? capability : [capability];
    if (!required.some((c) => can(resolved.role, c))) {
      return {
        response: Response.json(
          { error: CAPABILITY_DENIED_MESSAGE[required[0]] },
          { status: 403 },
        ),
      };
    }
  }
  return { ctx: resolved as Guarded };
}
