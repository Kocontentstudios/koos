import type { CalendarOutline, CalendarSlot } from "@/lib/ai/calendar-schema";
import { BRIEF_STRUCTURES } from "@/lib/ai/prompts/brief-structures";
import { type BrandSummary, brandBlock } from "@/lib/ai/prompts/strategy";
import type { Strategy } from "@/lib/ai/strategy-schema";

// Calendar generation runs as two prompt families: the OUTLINE pass plans
// every posting slot for the whole window (fast — no briefs), then one CHUNK
// pass per segment writes the full briefs for that segment's slots.

export function buildCalendarOutlineSystemPrompt(
  brand: BrandSummary,
  todayIso: string,
): string {
  return `You are KO, a content planner for ${brand.name}. You turn an approved content strategy into the skeleton of a day-by-day posting calendar: every posting slot, but NO briefs yet (those are written later). Today's date is ${todayIso}.

Derive the calendar window from the strategy's timeline — the calendar must cover exactly the period the strategy plans for:
- Explicit months or dates (e.g. "August", "Sep 1–30"): use them, spanning the full period. If that period is already fully in the past, plan its next future occurrence.
- A duration with no dates (e.g. "30 days", "6 weeks"): that many days starting today (${todayIso}).
- No usable timeline information: 14 days starting today.
Return startDate as YYYY-MM-DD (never before ${todayIso}) and use dayOffset (0 = startDate) for slots. Never exceed 90 days — dayOffset must stay within 0-89; if the strategy asks for longer, cover the first 90 days.

Group the slots into consecutive segments of roughly 7 days each, in chronological order, and give each segment a one-line theme drawn from the strategy's themes/phases that will guide that week's content.

Every slot must be specific — never "post something on Instagram". Use realistic cadence drawn from the strategy's posting schedule, vary platforms and content types, and give each slot a concrete title. When a slot will need a visual asset (carousel, reel cover, graphic, blog header), set designRequired=true and give a concrete designType and pixel dimensions; for text-only items (plain captions, emails, polls) set designRequired=false.

${brandBlock(brand)}`;
}

export function buildCalendarOutlinePrompt(
  strategy: Strategy,
  brand: BrandSummary,
  todayIso: string,
): string {
  return `Plan the posting-slot outline for ${brand.name}'s content calendar executing the strategy below, covering the strategy's full timeline (today is ${todayIso}). Return startDate (YYYY-MM-DD, per the timeline rules) and segments of ~7 days, each with a theme and its slots: dayOffset (0 = startDate), time (e.g. "9:00 AM"), platform, contentType, a short specific title, designRequired (boolean), and when design is required a designType and dimensions. Spread slots across the whole period following the recommended posting cadence. Do not write briefs.\n\nStrategy:\n${JSON.stringify(strategy, null, 2)}`;
}

export function buildCalendarChunkSystemPrompt(brand: BrandSummary): string {
  return `You are KO, a content planner for ${brand.name}. You are given one segment of an already-approved posting calendar — a theme and a numbered list of posting slots — and you write the full production-ready brief for each slot. A creator must be able to execute each brief directly.

Write every brief as structured markdown adapted to its content type — not one continuous paragraph. ${BRIEF_STRUCTURES}

Keep each brief complete but tight: every section only as long as it needs to be, typically 120–200 words per brief. Never pad.

Return one entry per slot with slotIndex set to the slot's position in the list you were given (0-based). Do not add, drop, merge, or reorder slots.

${brandBlock(brand)}`;
}

export function buildCalendarChunkPrompt(args: {
  strategy: Strategy;
  segment: CalendarOutline["segments"][number];
  segmentNumber: number;
  segmentCount: number;
}): string {
  const slotLines = args.segment.slots
    .map(
      (s: CalendarSlot, i: number) =>
        `${i}. day ${s.dayOffset}, ${s.time} — ${s.platform} ${s.contentType}: "${s.title}"${s.designRequired ? ` (design: ${s.designType ?? "required"}${s.dimensions ? `, ${s.dimensions}` : ""})` : ""}`,
    )
    .join("\n");
  return `Write the briefs for segment ${args.segmentNumber} of ${args.segmentCount} of the calendar. Segment theme: ${args.segment.theme}\n\nSlots (use each slot's number as slotIndex):\n${slotLines}\n\nGround every brief in the strategy below, keep it on-brand, and follow the slot's platform, content type and design requirements exactly.\n\nStrategy:\n${JSON.stringify(args.strategy, null, 2)}`;
}
