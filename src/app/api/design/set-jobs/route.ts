import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import { listOpenSetJobs } from "@/lib/design/sequence/open-set-jobs.server";
import { isUuid } from "@/lib/validation/uuid";

/**
 * The caller's set and frame jobs for a brand that have not ended. Design
 * Studio polls each through /api/jobs/[id], so a set keeps resuming and
 * reads as being made wherever it was started.
 */
export async function GET(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!multiFrameEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
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
  return Response.json({ jobs: await listOpenSetJobs(dbUser.id, brandId) });
}
