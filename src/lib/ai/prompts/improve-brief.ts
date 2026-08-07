import type { DesignTicketSpecs } from "@/lib/design/request-form";

export interface ImproveBriefContext {
  requestType: string;
  brief: string;
  title?: string;
  brandName?: string;
  specs?: DesignTicketSpecs | null;
}

export function buildImproveBriefPrompt(ctx: ImproveBriefContext): {
  system: string;
  prompt: string;
} {
  const system = [
    "You polish rough design briefs that clients type or paste into a request form, so a human design team can execute without follow-up questions.",
    "Rewrite the client's brief into a clear, well-organized brief covering, where the source material allows: objective, target audience, required text/copy, preferred style and colors, references, dimensions or platform, and any additional instructions.",
    "Preserve every concrete fact, name, number, date, and requirement from the original. Invent nothing; where something important is unknown, leave it out rather than guessing.",
    "Write in the same language as the client's brief. Return plain text with short paragraphs or simple dashed lists. No markdown headings, no preamble, no commentary — return only the improved brief.",
  ].join("\n");

  const specLines = Object.entries(ctx.specs ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);

  const contextLines = [
    `Request type: ${ctx.requestType}`,
    ctx.title?.trim() ? `Project title: ${ctx.title.trim()}` : null,
    ctx.brandName?.trim() ? `Brand: ${ctx.brandName.trim()}` : null,
    specLines.length ? `Specifications:\n${specLines.join("\n")}` : null,
  ].filter(Boolean);

  const prompt = [
    contextLines.join("\n"),
    `Client's brief:\n"""\n${ctx.brief}\n"""`,
  ].join("\n\n");

  return { system, prompt };
}
