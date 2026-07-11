import { BRIEF_STRUCTURES } from "@/lib/ai/prompts/brief-structures";
import { type BrandSummary, brandBlock } from "@/lib/ai/prompts/strategy";
import type { Strategy } from "@/lib/ai/strategy-schema";

export function buildCalendarSystemPrompt(
  brand: BrandSummary,
  todayIso: string,
): string {
  return `You are KO, a content planner for ${brand.name}. You turn an approved content strategy into a concrete, day-by-day posting calendar. Today's date is ${todayIso}.

Derive the calendar window from the strategy's timeline — the calendar must cover exactly the period the strategy plans for:
- Explicit months or dates (e.g. "August", "Sep 1–30"): use them, spanning the full period. If that period is already fully in the past, plan its next future occurrence.
- A duration with no dates (e.g. "30 days", "6 weeks"): that many days starting today (${todayIso}).
- No usable timeline information: 14 days starting today.
Return startDate as YYYY-MM-DD (never before ${todayIso}) and use dayOffset (0 = startDate) for items. Never exceed 90 days — dayOffset must stay within 0-89; if the strategy asks for longer, cover the first 90 days.

Every item must be ACTIONABLE and specific — never "post something on Instagram". Use realistic cadence drawn from the strategy's posting schedule, vary platforms and content types, and write a brief that a creator could execute directly. When an item needs a visual asset (carousel, reel cover, graphic, blog header), set designRequired=true and give a concrete designType and pixel dimensions; for text-only items (plain captions, emails, polls) set designRequired=false.

Write every item's brief as structured markdown adapted to its content type — not one continuous paragraph. ${BRIEF_STRUCTURES}

${brandBlock(brand)}`;
}

export function buildCalendarGenerationPrompt(
  strategy: Strategy,
  brand: BrandSummary,
  todayIso: string,
): string {
  return `Generate the content calendar for ${brand.name} that executes the strategy below, covering the strategy's full timeline (today is ${todayIso}). Return startDate (YYYY-MM-DD, per the timeline rules) and a list of calendar items, each with: dayOffset (0 = startDate), time (e.g. "9:00 AM"), platform, contentType, a short title, an actionable structured-markdown brief (what to post and the hook/structure), designRequired (boolean), and when design is required a designType and dimensions. Spread items across the whole period following the recommended posting cadence. Keep everything on-brand and grounded in the strategy.\n\n${brandBlock(brand)}\n\nStrategy:\n${JSON.stringify(strategy, null, 2)}`;
}
