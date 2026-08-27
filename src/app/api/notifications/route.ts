import { getAuthUser } from "@/lib/auth/get-user";
import { getNotifications, getUnreadNotificationCount } from "@/lib/db/queries";
import { notificationHref } from "@/lib/notifications/links";

export async function GET() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const [rows, unread] = await Promise.all([
    getNotifications(dbUser.id),
    getUnreadNotificationCount(dbUser.id),
  ]);
  // Resolved here rather than client-side: the destination depends on the
  // reader's role, which the browser has no business being told.
  const items = rows.map((row) => ({
    ...row,
    href: notificationHref(row.type, row.payload, dbUser.role),
  }));
  return Response.json({ items, unread });
}
