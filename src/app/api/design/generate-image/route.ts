import { z } from "zod";
import { generateBrandImage } from "@/lib/ai/image";
import { buildImagePrompt } from "@/lib/ai/prompts/image";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { checkBrandAccess } from "@/lib/db/queries";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import {
  getSignedReadUrl,
  publicUrl,
  STORAGE_PREFIXES,
  uploadObject,
} from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for the Bedrock image call plus the R2 upload.
export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 1000;

const requestSchema = z.object({
  brandId: z.string().refine(isUuid, "Invalid brandId"),
  prompt: z.string().trim().min(1, "Prompt is required").max(MAX_PROMPT_LENGTH),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
});

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `image-generate:${dbUser.id}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

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
  const { brandId, prompt, style, aspectRatio } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  try {
    const composedPrompt = buildImagePrompt({
      brand: access.brand,
      userPrompt: prompt,
      style,
    });
    const { bytes, contentType } = await generateBrandImage({
      prompt: composedPrompt,
      aspectRatio,
    });

    const key = `${STORAGE_PREFIXES.generated}/${brandId}/${crypto.randomUUID()}.png`;
    await uploadObject({ key, body: bytes, contentType });

    // No usage_kind enum value fits generated images, and adding one is out
    // of scope for this task — skip the usage_events row rather than
    // mislabeling it under an existing kind.
    const url = process.env.R2_PUBLIC_BASE_URL
      ? publicUrl(key)
      : await getSignedReadUrl(key, 3600);

    return Response.json({ url, key, contentType });
  } catch (err) {
    console.error("image generation failed", err);
    return Response.json(
      { error: "Image generation failed. Please try again." },
      { status: 500 },
    );
  }
}
