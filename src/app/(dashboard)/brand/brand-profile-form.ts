import { z } from "zod";

/* ──────────────────────────────────────────────────────────────────────────
   Dropdown option sets — labels are the SOURCE OF TRUTH from the
   KO OS Brand Onboarding Form spec (koos_complete). These are stored verbatim
   as text. Selecting "Other (Specify)" lets the user type a custom value, so
   the stored value is free-form text (not a strict enum).
   ────────────────────────────────────────────────────────────────────────── */

export const OTHER_OPTION = "Other (Specify)";

export const businessTypeOptions = [
  "E-commerce / Product",
  "Service / Freelance",
  "SaaS / Digital Product",
  "Agency / Studio",
  "Creator / Personal Brand",
  OTHER_OPTION,
] as const;

export const stageOptions = [
  "Pre-launch / New product",
  "Early (0–50 customers)",
  "Growing (50–500 customers)",
  "Scaling (500+ customers)",
  OTHER_OPTION,
] as const;

export const toneOptions = [
  "Friendly & Educational",
  "Bold & Direct",
  "Premium & Minimal",
  "Playful & Fun",
  "Professional & Corporate",
  "Warm & Community-Driven",
  OTHER_OPTION,
] as const;

export const primaryGoalOptions = [
  "Product Launch / Awareness",
  "Lead Generation",
  "Sales / Conversions",
  "Community Growth",
  "App Installs / Signups",
] as const;

export const brandStyleOptions = [
  "Minimalist",
  "Bold & Vibrant",
  "Corporate / Professional",
  "Streetwear / Urban",
  "Luxury / Premium",
  "Playful / Fun",
  OTHER_OPTION,
] as const;

export const platformOptions = [
  "Instagram",
  "TikTok",
  "X (Twitter)",
  "LinkedIn",
  "YouTube",
  "Facebook",
  "Other",
] as const;

export const primaryPlatformOptions = [
  "Instagram",
  "TikTok",
  "X (Twitter)",
  "LinkedIn",
  "YouTube",
  "Facebook",
] as const;

export const postingFrequencyOptions = [
  "3x / week",
  "5x / week",
  "Daily",
  "Custom",
] as const;

const optionalText = z.string().trim().max(500).optional().or(z.literal(""));

export const brandProfileSchema = z.object({
  // Section 1 — Business Basics (required)
  name: z.string().trim().min(2, "Brand name is required").max(100),
  overview: z.string().trim().min(20, "Give at least a sentence").max(500),
  businessType: z.string().trim().min(1, "Business type is required").max(100),
  stage: z.string().trim().min(1, "Stage is required").max(100),
  // Section 2 — Brand Direction
  targetAudience: optionalText,
  offer: optionalText,
  tone: optionalText,
  primaryGoal: optionalText,
  // Section 3 — Brand Personality
  values: optionalText,
  wordsLove: optionalText,
  wordsAvoid: optionalText,
  // Section 4 — Visual Identity
  hasLogo: z.boolean().optional(),
  primaryColor: z.string().optional().or(z.literal("")),
  secondaryColor: z.string().optional().or(z.literal("")),
  additionalColors: z.array(z.string()).optional(),
  logoUrl: z.string().optional().or(z.literal("")),
  brandStyle: optionalText,
  // Section 5 — Competitors
  competitors: optionalText,
  competitorStrengths: optionalText,
  differentiators: optionalText,
  // Section 6 — Platforms & Posting
  platforms: z.array(z.string()).optional(),
  primaryPlatform: optionalText,
  postingFrequency: optionalText,
  // Section 7 — Anything Else
  additionalNotes: optionalText,
  helpfulLinks: optionalText,
});

export type BrandProfileValues = z.infer<typeof brandProfileSchema>;
