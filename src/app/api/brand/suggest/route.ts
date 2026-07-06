import { generateObject } from "ai";
import { z } from "zod";
import {
  BRAND_SUGGEST_FIELDS,
  type BrandSuggestContext,
  type BrandSuggestField,
  buildBrandFieldPrompt,
} from "@/lib/ai/prompts/brand";
import { getModel } from "@/lib/ai/provider";
import { getAuthUser } from "@/lib/auth/get-user";

const suggestionSchema = z.object({ suggestion: z.string() });

// Caps input-token spend per request; form fields are far shorter in practice.
const MAX_INPUT_LENGTH = 2000;

const inputString = z.string().max(MAX_INPUT_LENGTH).default("");

const contextSchema = z.object({
  name: inputString,
  overview: inputString,
  businessType: inputString,
  stage: inputString,
  targetAudience: inputString,
  offer: inputString,
  tone: inputString,
  values: inputString,
  differentiators: inputString,
  primaryGoal: inputString,
}) satisfies z.ZodType<BrandSuggestContext>;

const requestSchema = z.object({
  field: z.string(),
  currentValue: inputString,
  context: contextSchema,
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
  if (
    !parsed.success ||
    !Object.hasOwn(BRAND_SUGGEST_FIELDS, parsed.data.field)
  ) {
    return Response.json(
      { error: "Invalid field or context" },
      { status: 400 },
    );
  }
  const { field, currentValue, context } = parsed.data;

  const { system, prompt } = buildBrandFieldPrompt({
    field: field as BrandSuggestField,
    currentValue,
    context,
  });

  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: suggestionSchema,
      system,
      prompt,
    });
    return Response.json({ suggestion: object.suggestion });
  } catch (err) {
    console.error("brand suggest failed", err);
    return Response.json(
      { error: "Suggestion failed. Please try again." },
      { status: 500 },
    );
  }
}
