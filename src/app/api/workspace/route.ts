import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import { guardWorkspaceRoute } from "@/lib/auth/workspace-guard";
import {
  deleteWorkspaceOwnedBy,
  getWorkspacesForUser,
  updateWorkspace,
} from "@/lib/db/queries";

export async function GET() {
  const guard = await guardWorkspaceRoute();
  if ("response" in guard) return guard.response;
  const { workspace, role } = guard.ctx;
  return Response.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      logoUrl: workspace.logoUrl,
    },
    role,
  });
}

export async function PATCH(req: Request) {
  const guard = await guardWorkspaceRoute("manage_settings");
  if ("response" in guard) return guard.response;
  const { workspace } = guard.ctx;

  let body: { name?: string; logoUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: { name?: string; logoUrl?: string | null } = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 80) {
      return Response.json(
        { error: "Workspace name must be 1–80 characters." },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if (body.logoUrl !== undefined) patch.logoUrl = body.logoUrl;
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await updateWorkspace(workspace.id, patch);
  return Response.json({ ok: true });
}

export async function DELETE() {
  const guard = await guardWorkspaceRoute("delete_workspace");
  if ("response" in guard) return guard.response;
  const { dbUser, workspace } = guard.ctx;

  const memberships = await getWorkspacesForUser(dbUser.id);
  if (memberships.length <= 1) {
    return Response.json(
      { error: "You can't delete your only workspace." },
      { status: 400 },
    );
  }

  const deleted = await deleteWorkspaceOwnedBy(workspace.id, dbUser.id);
  if (!deleted) {
    return Response.json(
      { error: "Only the workspace owner can delete a workspace." },
      { status: 403 },
    );
  }

  // Point the cookie at a surviving workspace so the reload lands cleanly.
  const remaining = memberships.find((m) => m.workspaceId !== workspace.id);
  if (remaining) await setActiveWorkspaceCookie(remaining.workspaceId);
  return Response.json({ ok: true });
}
