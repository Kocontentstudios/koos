import { generateObject } from "ai";
import {
  bodySchema,
  EXTRACTION_OUTPUT_TOKEN_CAP,
  extractionSchema,
  omitUnfilled,
  SYSTEM_PROMPT,
} from "@/lib/ai/onboarding/extraction";
import { getModel } from "@/lib/ai/provider";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const verdict = await checkRateLimit({
    key: `onboarding-extract:${dbUser.id}`,
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

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { brandId, transcript } = parsed.data;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: extractionSchema,
      system: SYSTEM_PROMPT,
      prompt: transcript,
      // Bedrock truncates unbounded output mid-JSON, which surfaces as a
      // schema-mismatch retry loop rather than a token error. The cap is a
      // ceiling, not a reservation — we only pay for what's generated — so it
      // sits well clear of a rich conversation where overview, audience and
      // differentiators all come back paragraph-length.
      maxOutputTokens: EXTRACTION_OUTPUT_TOKEN_CAP,
    });

    const { summary, fields } = object;
    const proposal = {
      kind: "brand_fields" as const,
      summary,
      data: { fields: omitUnfilled(fields) },
    };

    const validated = ProposalSchema.safeParse(proposal);
    if (!validated.success) {
      console.error("onboarding extract: invalid proposal", validated.error);
      return Response.json(
        { error: "Extraction produced an invalid proposal." },
        { status: 502 },
      );
    }

    return Response.json({ proposal: validated.data });
  } catch (err) {
    console.error("onboarding extract failed", err);
    return Response.json(
      { error: "Extraction failed. Please try again." },
      { status: 500 },
    );
  }
}
