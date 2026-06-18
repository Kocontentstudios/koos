import { getAuthUser } from "@/lib/auth/get-user";
import { isRole } from "@/lib/auth/roles";
import { getUserById, updateUserRole } from "@/lib/db/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  // Only admins may change roles (designers cannot).
  if (!dbUser || dbUser.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: { role?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!isRole(body.role)) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }

  const target = await getUserById(id);
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  // Guard against an admin demoting themselves and locking everyone out.
  if (target.id === dbUser.id && body.role !== "admin") {
    return Response.json(
      { error: "You can't change your own admin role." },
      { status: 400 },
    );
  }

  const updated = await updateUserRole(id, body.role);
  return Response.json({ user: { id: updated.id, role: updated.role } });
}
