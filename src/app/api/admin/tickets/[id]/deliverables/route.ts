import { randomBytes } from "node:crypto";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  addDeliverables,
  createNotification,
  getDesignTicketById,
  updateDesignTicket,
} from "@/lib/db/queries";
import {
  isStorageConfigured,
  STORAGE_PREFIXES,
  uploadObject,
} from "@/lib/storage";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per deliverable
const ALLOWED = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["application/zip", "zip"],
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }

  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const form = await req.formData();
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  const rows: {
    ticketId: string;
    fileUrl: string;
    fileName: string;
    slideIndex: number;
  }[] = [];
  try {
    for (const [i, file] of files.entries()) {
      if (file.size > MAX_BYTES) {
        return Response.json(
          { error: `"${file.name}" exceeds the 25MB limit.` },
          { status: 400 },
        );
      }
      const ext = ALLOWED.get(file.type);
      if (!ext) {
        return Response.json(
          { error: `Unsupported file type for "${file.name}".` },
          { status: 400 },
        );
      }
      const key = `${STORAGE_PREFIXES.deliverables}/${ticket.id}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
      await uploadObject({
        key,
        body: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
      });
      // Store the object KEY; reads go through short-lived signed URLs.
      rows.push({
        ticketId: ticket.id,
        fileUrl: key,
        fileName: file.name,
        slideIndex: i,
      });
    }
  } catch (err) {
    console.error("deliverable upload failed", err);
    return Response.json({ error: "Upload failed." }, { status: 502 });
  }

  await addDeliverables(rows);
  await updateDesignTicket(ticket.id, { status: "ready_for_review" });
  await createNotification({
    userId: ticket.userId,
    type: "design_ready",
    payload: {
      ticketId: ticket.id,
      designType: ticket.designType,
      count: rows.length,
    },
  });

  return Response.json({ ok: true, count: rows.length });
}
