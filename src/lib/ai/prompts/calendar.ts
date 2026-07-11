import { BRIEF_STRUCTURES } from "@/lib/ai/prompts/brief-structures";
import { type BrandSummary, brandBlock } from "@/lib/ai/prompts/strategy";
import type { Strategy } from "@/lib/ai/strategy-schema";

export function buildCalendarSystemPrompt(brand: BrandSummary): string {
  return `You are KO, a content planner for ${brand.name}. You turn an approved content strategy into a concrete, day-by-day posting calendar. Plan roughly two weeks (14 days) of content. Every item must be ACTIONABLE and specific — never "post something on Instagram". Use realistic cadence drawn from the strategy's posting schedule, vary platforms and content types, and write a brief that a creator could execute directly. When an item needs a visual asset (carousel, reel cover, graphic, blog header), set designRequired=true and give a concrete designType and pixel dimensions; for text-only items (plain captions, emails, polls) set designRequired=false. Use dayOffset (0 = the first day) instead of calendar dates.

Write every item's brief as structured markdown adapted to its content type — not one continuous paragraph. ${BRIEF_STRUCTURES}

${brandBlock(brand)}`;
}

export function buildCalendarGenerationPrompt(
  strategy: Strategy,
  brand: BrandSummary,
): string {
  return `Generate a two-week content calendar for ${brand.name} that executes the strategy below. Return a list of calendar items, each with: dayOffset (0-13), time (e.g. "9:00 AM"), platform, contentType, a short title, an actionable brief (what to post and the hook/structure), designRequired (boolean), and when design is required a designType and dimensions. Spread items across the two weeks following the recommended posting cadence. Keep everything on-brand and grounded in the strategy.\n\n${brandBlock(brand)}\n\nStrategy:\n${JSON.stringify(strategy, null, 2)}`;
}
