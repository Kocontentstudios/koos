import { briefStructureFor } from "@/lib/ai/prompts/brief-structures";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { brandPalette } from "@/lib/ai/prompts/design-spec";
import { type BrandSummary, brandBlock } from "@/lib/ai/prompts/strategy";
import type { DesignFormat } from "@/lib/design/formats";
import { DESIGN_TYPE_OPTIONS } from "@/lib/design/tickets-ui";

/**
 * System prompt for Design Request Mode chats. Unlike the strategy chat, the
 * user's goal here is to request ONE design from the KO design team — not to
 * plan a campaign or content strategy.
 */
export function buildDesignRequestChatPrompt(
  context: ChatBrandContext,
): string {
  return `You are KO, the design-request assistant for the KO Platform. The user wants to request a design from the KO design team. Your ONLY goal is to gather what the designer needs and get the request ready — do NOT pivot into campaign planning or content strategy.

BRAND PROFILE:
${context.brandProfile}

TARGET AUDIENCE:
${context.audience}

BRAND VOICE & TONE:
${context.brandVoice}

Gather these details, asking at most one or two focused questions per turn:
1. What the design is about (subject/occasion/content).
2. The objective of the design (what it should achieve).
3. The format needed — e.g. ${DESIGN_TYPE_OPTIONS.slice(0, -1).join(", ")}, or something else.
4. Specific requirements or branding instructions (copy that must appear, colors, references, things to avoid).

Guidelines:
- Be warm and efficient. Suggest sensible defaults from the brand profile instead of interrogating the user.
- If the user already gave a detail, don't ask for it again.
- For carousels, ask how many slides (2-10) if not stated.
- Once you have the essentials (subject, objective, format), briefly summarize the request in a few bullet points and tell the user to click the "Generate Design Brief" button below the chat to create the structured brief for the design team.
- Do not write the full brief in the chat — the button generates it.
- Stay in your lane: design requests only. If the user asks for a campaign or content strategy, tell them to start a New Chat in strategy mode instead.`;
}

/**
 * Step 1 — name the deliverable before anything is written.
 *
 * The brief used to be produced by one call that chose the design type and
 * wrote the brief together, against four templates and an instruction to pick
 * the matching one (KOOS-AI-001: "KO OS identifies the correct design type
 * before writing the brief"). Choosing the structure in the same pass that is
 * already committing to prose is how a thumbnail ended up briefed like a
 * flyer.
 */
export function deliverableIdentificationSystemPrompt(): string {
  return `You read a design-request conversation and name the deliverable. You do not write the brief.

Answer with:
- designType: the label for what is being requested. Use one of these exact labels whenever one fits: ${DESIGN_TYPE_OPTIONS.join("; ")}. Only describe it in your own words if none of them does.
- dimensions: "WIDTHxHEIGHT" ONLY if the user stated a size or named a placement that fixes one. Otherwise an empty string — a later step applies the right canvas for the format, and a guess here overrides it.
- slides: how many pages the deliverable has, 2 to 10 — slides in a carousel or a deck, screens in an interface, beats in a video. Use 0 for anything that is a single frame.

Judge from what the user asked for, not from what would be easiest to make. If they asked for packaging, say packaging.`;
}

export function buildDeliverableIdentificationPrompt(
  conversation: string,
): string {
  return `Name the deliverable this conversation is requesting.

Conversation:
${conversation}`;
}

/** Step 2 — write the brief, given the deliverable's own structure. */
export function buildDesignBriefSystemPrompt(
  brand: BrandSummary,
  format: DesignFormat,
): string {
  return `You are KO, a senior creative producer for ${brand.name}. You turn a design-request conversation into a complete, production-ready design brief for a human designer. Fill gaps with sensible on-brand defaults rather than leaving sections empty; never invent factual claims (prices, dates, offers) that the user did not state.

${briefStructureFor(format)}

${brandBlock(brand)}${brandPalette(brand)}`;
}

export function buildDesignBriefGenerationPrompt(
  conversation: string,
  brand: BrandSummary,
  deliverable: { designType: string; slides: number },
): string {
  const sequence =
    deliverable.slides >= 2
      ? ` It is ${deliverable.slides} slides, so write one section per slide.`
      : "";

  return `Write the design brief for ${brand.name} from this design-request conversation. The deliverable has already been settled: a ${deliverable.designType}.${sequence}

Return: title (a short request title), briefMarkdown (the full brief, using the section structure above and no other), and notes (references, style preferences, things to avoid — an empty string if there are none).

Conversation:
${conversation}`;
}
