import JSZip from "jszip";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getDeliverables,
  getDesignTicketById,
} from "@/lib/db/queries";
import {
  deliverablesZipName,
  groupDeliverablesByVersion,
} from "@/lib/design/ticket";
import { getObjectBytes } from "@/lib/storage";

/** Bundle one delivery round into a zip download, latest round by default.
 * Zipping every round together would hand the client superseded artwork under
 * near-identical filenames, with only a "-1" suffix to tell them apart. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const versionParam = new URL(req.url).searchParams.get("version");
  let requestedVersion: number | null = null;
  if (versionParam !== null) {
    const parsed = Number(versionParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return Response.json({ error: "Invalid version" }, { status: 400 });
    }
    requestedVersion = parsed;
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const access = await checkBrandAccess(
    dbUser.id,
    ticket.brandId,
    "manage_content",
  );
  const isWorkspaceMember = access.ok;
  const isStaff = dbUser.role === "designer" || dbUser.role === "admin";
  if (!isWorkspaceMember && !isStaff) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Files stay view-only until the client marks the design satisfied, so every
  // request is driven to an explicit sign-off instead of trailing off after a
  // silent download. Gating on approvedAt rather than status means a later
  // correction round reopens the review without revoking earned downloads.
  if (!ticket.approvedAt && !isStaff) {
    return Response.json(
      { error: "Approve the design to download it." },
      { status: 403 },
    );
  }

  const groups = groupDeliverablesByVersion(await getDeliverables(ticket.id));
  const group =
    requestedVersion === null
      ? groups[0]
      : groups.find((g) => g.version === requestedVersion);
  if (!group) {
    return Response.json({ error: "No deliverables yet" }, { status: 404 });
  }

  const zip = new JSZip();
  const seen = new Map<string, number>();
  try {
    for (const d of group.items) {
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
      "Content-Disposition": `attachment; filename="${deliverablesZipName(ticket.ticketNumber, group.version)}"`,
    },
  });
}

function prefixName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${n}`;
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
}
