import { getAuthUser } from "@/lib/auth/get-user";
import { markNotificationsRead } from "@/lib/db/queries";

export async function POST() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  await markNotificationsRead(dbUser.id);
  return Response.json({ ok: true });
}
