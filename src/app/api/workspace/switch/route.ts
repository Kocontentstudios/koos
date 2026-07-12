import { getAuthUser } from "@/lib/auth/get-user";
import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import { getMembership } from "@/lib/db/queries";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  let body: { workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  // The cookie is a pointer, but never point it somewhere the user isn't.
  if (!(await getMembership(body.workspaceId, dbUser.id))) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  await setActiveWorkspaceCookie(body.workspaceId);
  return Response.json({ ok: true });
}
