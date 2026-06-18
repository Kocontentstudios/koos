import { getAuthUser } from "@/lib/auth/get-user";
import { getNotifications, getUnreadNotificationCount } from "@/lib/db/queries";

export async function GET() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const [items, unread] = await Promise.all([
    getNotifications(dbUser.id),
    getUnreadNotificationCount(dbUser.id),
  ]);
  return Response.json({ items, unread });
}
