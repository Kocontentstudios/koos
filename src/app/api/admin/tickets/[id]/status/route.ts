import { getAuthUser } from "@/lib/auth/get-user";
import { getDesignTicketById, updateDesignTicket } from "@/lib/db/queries";

const DESIGNER_SETTABLE = [
  "assigned",
  "in_progress",
  "ready_for_review",
] as const;
type DesignerStatus = (typeof DESIGNER_SETTABLE)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: { status?: string; claim?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const patch: { status?: DesignerStatus; assignedDesignerId?: string } = {};

  if (body.claim) {
    patch.assignedDesignerId = dbUser.id;
    patch.status = "assigned";
  }
  if (body.status) {
    if (!(DESIGNER_SETTABLE as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status as DesignerStatus;
  }
  if (!patch.status && !patch.assignedDesignerId) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await updateDesignTicket(id, patch);
  return Response.json({ ticket: updated });
}
