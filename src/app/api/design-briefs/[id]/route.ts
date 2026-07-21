import { designBriefUpdateSchema } from "@/lib/ai/design-brief-schema";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getDesignBriefById,
  updateDesignBrief,
} from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

/**
 * Edit a persisted Design Brief Card (title, type, dimensions, slides, brief
 * markdown, notes). Brand-scoped like the conversation it belongs to; 404
 * for anything the caller can't see so ids don't leak existence.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Brief not found" }, { status: 404 });
  }
  const brief = await getDesignBriefById(id);
  if (!brief) {
    return Response.json({ error: "Brief not found" }, { status: 404 });
  }
  const access = await checkBrandAccess(
    dbUser.id,
    brief.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json(
      { error: "Brief not found" },
      { status: access.status },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = designBriefUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid brief update" },
      { status: 400 },
    );
  }

  const updated = await updateDesignBrief(id, parsed.data);
  return Response.json({ brief: updated });
}
