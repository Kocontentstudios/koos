import { isTrustedStorageUrl } from "@/lib/admin/logo-proxy";
import { extractLogoColors } from "@/lib/ai/logo-colors";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getObjectBytes } from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

/**
 * Suggests brand colours from an uploaded logo.
 *
 * The logo is read out of our own bucket by key, never fetched from an
 * arbitrary URL: logoUrl arrives from the client, and following it verbatim
 * would make this a server-side request forgery gadget. Anything outside the
 * storage origin is refused outright.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // A vision call per request, so it is worth a limit of its own.
  const limit = await checkRateLimit({
    key: `logo-colors:${dbUser.id}`,
    limit: 20,
    windowSeconds: 600,
  });
  if (!limit.ok) return tooManyRequests(limit);

  let body: { brandId?: string; logoUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { brandId, logoUrl } = body;
  if (!brandId || !isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId" },
      { status: 400 },
    );
  }

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!logoUrl || !isTrustedStorageUrl(logoUrl, base) || !base) {
    return Response.json(
      { error: "Logo must be an uploaded file." },
      { status: 400 },
    );
  }

  let image: { bytes: Uint8Array; contentType: string };
  try {
    const bytes = await getObjectBytes(logoUrl.slice(base.length + 1));
    image = { bytes: new Uint8Array(bytes), contentType: "image/png" };
  } catch {
    return Response.json(
      { error: "Could not read the logo." },
      { status: 404 },
    );
  }

  // Never throws: an unavailable or text-only model yields an empty palette
  // and the user types the hexes instead.
  const palette = await extractLogoColors(image);
  return Response.json({ palette });
}
