/**
 * Prompt builder for the brand-field "Suggest / Enhance" helper. Single source
 * of truth for WHICH fields are AI-assistable and their per-field guidance;
 * the API route and the SuggestButton both derive from BRAND_SUGGEST_FIELDS.
 */

export const BRAND_SUGGEST_FIELDS = {
  overview: {
    label: "Business Overview",
    guidance:
      "One to two clear sentences on what the business does and who it serves. Concrete, not buzzwordy. Max ~60 words.",
  },
  targetAudience: {
    label: "Target Audience",
    guidance:
      "A specific customer description — demographics, context, and what they care about. One sentence. Max ~40 words.",
  },
  offer: {
    label: "Offer",
    guidance:
      "The core product/service and its value in one concrete line (include a price or format if known). Max ~30 words.",
  },
  values: {
    label: "Brand Values",
    guidance:
      "Three to five short brand values as a comma-separated list. No sentences.",
  },
  differentiators: {
    label: "What You Want to Do Differently",
    guidance:
      "One to two sentences on how this brand differs from competitors. Specific and credible. Max ~50 words.",
  },
} as const;

export type BrandSuggestField = keyof typeof BRAND_SUGGEST_FIELDS;

export interface BrandSuggestContext {
  name: string;
  overview: string;
  businessType: string;
  stage: string;
  targetAudience: string;
  offer: string;
  tone: string;
  values: string;
  differentiators: string;
  primaryGoal: string;
}

function contextLines(context: BrandSuggestContext): string {
  const rows: Array<[string, string]> = [
    ["Brand name", context.name],
    ["Overview", context.overview],
    ["Business type", context.businessType],
    ["Stage", context.stage],
    ["Target audience", context.targetAudience],
    ["Offer", context.offer],
    ["Tone", context.tone],
    ["Values", context.values],
    ["Differentiators", context.differentiators],
    ["Primary goal", context.primaryGoal],
  ];
  return rows
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join("\n");
}

export function buildBrandFieldPrompt({
  field,
  currentValue,
  context,
}: {
  field: BrandSuggestField;
  currentValue: string;
  context: BrandSuggestContext;
}): { system: string; prompt: string } {
  const meta = BRAND_SUGGEST_FIELDS[field];
  const enhancing = currentValue.trim().length > 0;

  const system = enhancing
    ? "You improve a single brand-profile field. Rewrite the user's draft to be clearer, more specific, and on-brand, keeping their intent. Return ONLY the improved field value — no preamble, quotes, or labels."
    : "You suggest a single brand-profile field from the brand context. Return ONLY the field value — no preamble, quotes, or labels.";

  const task = enhancing
    ? `Improve the "${meta.label}" field. Current draft:\n"""${currentValue.trim()}"""`
    : `Write a strong "${meta.label}" field for this brand.`;

  const prompt = [
    task,
    "",
    `Guidance for this field: ${meta.guidance}`,
    "",
    "Brand context:",
    contextLines(context) ||
      "- (little context provided; make a reasonable, concrete suggestion)",
  ].join("\n");

  return { system, prompt };
}
