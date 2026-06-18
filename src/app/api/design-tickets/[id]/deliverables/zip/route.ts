import JSZip from "jszip";
import { getAuthUser } from "@/lib/auth/get-user";
import { getDeliverables, getDesignTicketById } from "@/lib/db/queries";
import { deliverablesZipName } from "@/lib/design/ticket";
import { getObjectBytes } from "@/lib/storage";

/** Bundle all of a ticket's deliverables into a single zip download. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = ticket.userId === dbUser.id;
  const isStaff = dbUser.role === "designer" || dbUser.role === "admin";
  if (!isOwner && !isStaff) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const deliverables = await getDeliverables(ticket.id);
  if (deliverables.length === 0) {
    return Response.json({ error: "No deliverables yet" }, { status: 404 });
  }

  const zip = new JSZip();
  const seen = new Map<string, number>();
  try {
    for (const d of deliverables) {
      // De-duplicate identical filenames within the zip.
      const count = seen.get(d.fileName) ?? 0;
      seen.set(d.fileName, count + 1);
      const name = count === 0 ? d.fileName : prefixName(d.fileName, count);
      zip.file(name, await getObjectBytes(d.fileUrl));
    }
  } catch (err) {
    console.error("zip build failed", err);
    return Response.json(
      { error: "Could not build the download." },
      { status: 502 },
    );
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${deliverablesZipName(ticket.ticketNumber)}"`,
    },
  });
}

function prefixName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${n}`;
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
}
