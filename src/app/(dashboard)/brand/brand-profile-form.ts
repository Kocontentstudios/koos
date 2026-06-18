import { z } from "zod";

export const businessTypeOptions = [
  "ecommerce",
  "service",
  "saas",
  "creator",
  "agency",
  "nonprofit",
  "restaurant",
  "fashion",
  "health",
  "education",
  "other",
] as const;
export const stageOptions = [
  "pre_launch",
  "early_growth",
  "established",
  "rebranding",
  "new_product",
] as const;
export const toneOptions = [
  "professional",
  "friendly",
  "playful",
  "bold",
  "calm",
  "luxurious",
  "educational",
  "aspirational",
] as const;
export const primaryGoalOptions = [
  "product_launch",
  "brand_awareness",
  "drive_sales",
  "grow_social",
  "build_email",
  "reengage",
  "seasonal",
  "thought_leadership",
] as const;

export const brandProfileSchema = z.object({
  name: z.string().min(2, "Brand name is required").max(100),
  overview: z.string().min(20, "Give at least a sentence").max(500),
  businessType: z.enum(businessTypeOptions),
  stage: z.enum(stageOptions),
  targetAudience: z.string().max(200).optional().or(z.literal("")),
  offer: z.string().max(200).optional().or(z.literal("")),
  tone: z.enum(toneOptions).optional().or(z.literal("")),
  primaryGoal: z.enum(primaryGoalOptions).optional().or(z.literal("")),
  primaryColor: z.string().optional().or(z.literal("")),
  secondaryColor: z.string().optional().or(z.literal("")),
  additionalColors: z.array(z.string()).optional(),
  logoUrl: z.string().optional().or(z.literal("")),
});

export type BrandProfileValues = z.infer<typeof brandProfileSchema>;
