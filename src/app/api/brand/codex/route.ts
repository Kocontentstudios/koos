import type { BrandGuide } from "@/lib/ai/brand-guide";
import { getAuthUser } from "@/lib/auth/get-user";
import { brandCodexFilename, toBrandCodexMarkdown } from "@/lib/brand-codex";
import {
  checkBrandAccess,
  getBrandById,
  getBrandContext,
} from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

/**
 * The user's own Brand Codex, as a Markdown download.
 *
 * Distinct from /api/admin/brands/[id]/export, which is admin-only, keeps
 * nulls, and answers a different question. This is guarded by brand access
 * like every other user-facing brand route.
 */
export async function GET(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const brandId = new URL(req.url).searchParams.get("brandId");
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

  const brand = await getBrandById(brandId);
  if (!brand) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  // The guide is synthesized after onboarding and may simply not exist yet;
  // the Codex is still worth downloading without it.
  const stored = await getBrandContext(brandId, "brand_foundation");
  const guide = (stored?.dataJson as { guide?: BrandGuide } | null)?.guide;

  const markdown = toBrandCodexMarkdown(brand, guide ?? null);

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${brandCodexFilename(brand.name)}"`,
      // A brand edited a minute ago must not serve last week's codex.
      "Cache-Control": "no-store",
    },
  });
}
