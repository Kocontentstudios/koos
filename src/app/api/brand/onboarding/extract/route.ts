import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { ProposalSchema } from "@/lib/ai/tools/proposals";
import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess } from "@/lib/db/queries";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

// Caps input-token spend per request; an onboarding conversation is a short
// back-and-forth, not a full transcript dump.
const MAX_TRANSCRIPT_LENGTH = 8000;

const bodySchema = z.object({
  brandId: z.string().uuid(),
  transcript: z.string().min(1).max(MAX_TRANSCRIPT_LENGTH),
});

// Mirrors ProposalSchema's brand_fields shape exactly — every key here must
// stay in lockstep with that union member, or a valid extraction gets
// silently stripped when we validate the built proposal below.
const extractionSchema = z.object({
  fields: z.object({
    name: z.string().optional(),
    overview: z.string().optional(),
    businessType: z.string().optional(),
    stage: z.string().optional(),
    targetAudience: z.string().optional(),
    offer: z.string().optional(),
    tone: z.string().optional(),
    primaryGoal: z.string().optional(),
    values: z.string().optional(),
    wordsLove: z.string().optional(),
    wordsAvoid: z.string().optional(),
    brandStyle: z.string().optional(),
    competitors: z.string().optional(),
    differentiators: z.string().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    additionalNotes: z.string().optional(),
  }),
  summary: z.string(),
});

const SYSTEM_PROMPT = [
  "You extract structured brand-profile fields from an onboarding conversation transcript.",
  "Only fill a field when the transcript states or clearly implies it — never invent or assume a value.",
  "Leave a field out entirely if it wasn't discussed.",
  "Keep each field concrete and concise, matching how it would appear on a brand profile form (no preamble, no restating the question).",
  "Write a one-sentence `summary` describing what was captured, for a confirm-to-fill UI card.",
].join(" ");

function omitEmptyStrings<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.trim().length === 0) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

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
      // Bedrock truncates unbounded output before it satisfies the schema;
      // this is small (17 short strings + a summary) but still needs a cap.
      maxOutputTokens: 2000,
    });

    const { summary, fields } = object;
    const proposal = {
      kind: "brand_fields" as const,
      summary,
      data: { fields: omitEmptyStrings(fields) },
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
