import { isTrustedStorageUrl } from "@/lib/admin/logo-proxy";
import { getAuthUser } from "@/lib/auth/get-user";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

const EXT_BY_TYPE = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/svg+xml", "svg"],
]);

/**
 * Stream a brand logo as an attachment. Proxied rather than linked directly
 * because logoUrl points at external object storage, where a `download`
 * attribute on an anchor is ignored cross-origin.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }
  const row = await getBrandForAdmin(id);
  if (!row?.brand.logoUrl) {
    return Response.json({ error: "No logo on file" }, { status: 404 });
  }

  // logoUrl is user-controllable; only proxy our own storage origin (SSRF guard).
  if (!isTrustedStorageUrl(row.brand.logoUrl, process.env.R2_PUBLIC_BASE_URL)) {
    return Response.json({ error: "Logo is not available" }, { status: 404 });
  }

  // redirect: "manual" so a 3xx to an internal host can't bypass the origin check.
  const upstream = await fetch(row.brand.logoUrl, { redirect: "manual" });
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Could not fetch the logo" },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const ext = EXT_BY_TYPE.get(contentType.toLowerCase());
  if (!ext) {
    return Response.json({ error: "Unsupported logo format" }, { status: 415 });
  }
  const slug = row.brand.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${slug || "brand"}-logo.${ext}"`,
    },
  });
}
