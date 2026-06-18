import { getAuthUser } from "@/lib/auth/get-user";
import { getDeliverableById, getDesignTicketById } from "@/lib/db/queries";
import { getSignedReadUrl } from "@/lib/storage";

/** Redirect to a short-lived signed URL for a deliverable (ownership-checked). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; deliverableId: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id, deliverableId } = await params;

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = ticket.userId === dbUser.id;
  const isStaff = dbUser.role === "designer" || dbUser.role === "admin";
  if (!isOwner && !isStaff) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const deliverable = await getDeliverableById(deliverableId);
  if (!deliverable || deliverable.ticketId !== ticket.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const url = await getSignedReadUrl(deliverable.fileUrl, 300);
    return Response.redirect(url, 302);
  } catch (err) {
    console.error("signed url failed", err);
    return Response.json({ error: "Could not generate link" }, { status: 502 });
  }
}
