import { brandExportFilename, toBrandExport } from "@/lib/admin/brand-export";
import { getAuthUser } from "@/lib/auth/get-user";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  // Routes authorize independently — the admin layout guard does not cover them.
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }
  const row = await getBrandForAdmin(id);
  if (!row) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  const payload = {
    ...toBrandExport(row.brand),
    owner: row.ownerEmail,
    workspace: row.workspaceName,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${brandExportFilename(row.brand)}"`,
    },
  });
}
