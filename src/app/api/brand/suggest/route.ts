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

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    field?: string;
    currentValue?: string;
    context?: BrandSuggestContext;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { field, currentValue = "", context } = body;
  if (!field || !Object.hasOwn(BRAND_SUGGEST_FIELDS, field) || !context) {
    return Response.json(
      { error: "Invalid field or context" },
      { status: 400 },
    );
  }

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
