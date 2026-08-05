import { generateObject } from "ai";
import { z } from "zod";
import { buildImproveBriefPrompt } from "@/lib/ai/prompts/improve-brief";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import { specsSchema } from "@/lib/design/request-form";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

const improvedSchema = z.object({ brief: z.string() });

const requestSchema = z.object({
  brandId: z.uuid(),
  requestType: z.string().min(1).max(100),
  title: z.string().max(200).optional(),
  brief: z.string().min(20).max(20000),
  specs: specsSchema.nullish(),
});

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `improve-brief:${dbUser.id}`,
    limit: 20,
    windowSeconds: 600,
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
    return Response.json(
      { error: "Write at least a few sentences first, then improve." },
      { status: 400 },
    );
  }
  const { brandId, requestType, title, brief, specs } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const { system, prompt } = buildImproveBriefPrompt({
    requestType,
    title,
    brandName: access.brand.name,
    brief,
    specs,
  });

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: improvedSchema,
      system,
      prompt,
      // Bedrock defaults to 4096 output tokens, which truncates long briefs
      // into schema-mismatch errors.
      maxOutputTokens: 4000,
    });
    return Response.json({ brief: object.brief });
  } catch (err) {
    console.error("improve brief failed", err);
    return Response.json(
      { error: "Could not improve the brief. Please try again." },
      { status: 500 },
    );
  }
}
