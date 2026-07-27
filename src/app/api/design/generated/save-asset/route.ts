import { z } from "zod";
import { getAuthUser } from "@/lib/auth/get-user";
import { addBrandAsset, checkBrandAccess } from "@/lib/db/queries";
import { publicUrl, STORAGE_PREFIXES } from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

const requestSchema = z.object({
  brandId: z.string().refine(isUuid, "Invalid brandId"),
  key: z.string().trim().min(1, "Key is required"),
  fileName: z.string().trim().min(1, "File name is required"),
});

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, key, fileName } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  // Guards against saving an arbitrary or cross-brand R2 object as this
  // brand's asset: only keys the generation flow itself wrote are allowed.
  if (!key.startsWith(`${STORAGE_PREFIXES.generated}/${brandId}/`)) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  try {
    const fileUrl = process.env.R2_PUBLIC_BASE_URL ? publicUrl(key) : key;
    const asset = await addBrandAsset({
      brandId,
      assetType: "image",
      fileUrl,
      fileName,
    });
    return Response.json({ asset });
  } catch (err) {
    console.error("save generated asset failed", err);
    return Response.json(
      { error: "Failed to save asset. Please try again." },
      { status: 500 },
    );
  }
}
