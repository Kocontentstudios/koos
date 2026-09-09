import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess, getDesignGenerationById } from "@/lib/db/queries";
import { generationFileName } from "@/lib/design/download-name";
import { getSignedReadUrl, STORAGE_PREFIXES } from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

/**
 * Save a generated design at full resolution.
 *
 * Same-origin and authorized, rather than a `download` attribute on the public
 * R2 URL: that attribute is ignored cross-origin, so the browser navigates to
 * the PNG instead of saving it — the reason Download did nothing. Redirecting
 * to a short-lived signed URL keeps the bytes out of the function (see the
 * deliverables route, which does the same) and R2 sets the filename.
 *
 * This adds an authorized path; it does not remove the anonymous one.
 * serializeGeneration still hands the grids a public R2 URL whenever
 * R2_PUBLIC_BASE_URL is set, so a `generated/` object is still reachable by
 * anyone holding that URL. Making those objects private is a separate change.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const generation = await getDesignGenerationById(id);
  if (!generation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  /* One body for both, matching evaluateBrandAccess's own rule: a workspace
     the caller cannot reach must be indistinguishable from one that does not
     exist, or the id becomes an existence oracle. */
  const access = await checkBrandAccess(
    dbUser.id,
    generation.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  /* A variant that failed, or is still rendering, has no bytes to send. */
  if (!generation.imageKey) {
    return Response.json(
      { error: "This design is not ready to download yet." },
      { status: 404 },
    );
  }

  /* Pinned to its prefix before signing. The key is written by the generation
     job and is not user-controllable, but the commit this sits on established
     that a stored key is never handed to the storage client unchecked. */
  if (!generation.imageKey.startsWith(`${STORAGE_PREFIXES.generated}/`)) {
    console.error(
      `design ${generation.id} has an imageKey outside the generated prefix`,
    );
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const url = await getSignedReadUrl(generation.imageKey, 300, {
      disposition: "attachment",
      fileName: generationFileName(generation),
    });
    return Response.redirect(url, 302);
  } catch (err) {
    console.error("design download link failed", err);
    return Response.json({ error: "Could not generate link" }, { status: 502 });
  }
}
