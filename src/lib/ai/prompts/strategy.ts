export interface BrandSummary {
  name: string;
  overview?: string | null;
  businessType?: string | null;
  stage?: string | null;
  targetAudience?: string | null;
  offer?: string | null;
  tone?: string | null;
  primaryGoal?: string | null;
  values?: string | null;
  wordsLove?: string | null;
  wordsAvoid?: string | null;
  brandStyle?: string | null;
  competitors?: string | null;
  differentiators?: string | null;
  platforms?: string[] | null;
  primaryPlatform?: string | null;
  postingFrequency?: string | null;
}

export function brandBlock(b: BrandSummary): string {
  return [
    `Brand: ${b.name}`,
    b.overview ? `Overview: ${b.overview}` : null,
    b.businessType ? `Business type: ${b.businessType}` : null,
    b.stage ? `Stage: ${b.stage}` : null,
    b.targetAudience ? `Target audience: ${b.targetAudience}` : null,
    b.offer ? `Offer: ${b.offer}` : null,
    b.tone ? `Tone of voice: ${b.tone}` : null,
    b.primaryGoal ? `Primary goal: ${b.primaryGoal}` : null,
    b.values ? `Brand values: ${b.values}` : null,
    b.wordsLove ? `Words to favor: ${b.wordsLove}` : null,
    b.wordsAvoid ? `Words to avoid: ${b.wordsAvoid}` : null,
    b.brandStyle ? `Visual style: ${b.brandStyle}` : null,
    b.competitors ? `Competitors: ${b.competitors}` : null,
    b.differentiators ? `How they differ: ${b.differentiators}` : null,
    b.platforms?.length ? `Active platforms: ${b.platforms.join(", ")}` : null,
    b.primaryPlatform ? `Primary platform: ${b.primaryPlatform}` : null,
    b.postingFrequency ? `Posting frequency: ${b.postingFrequency}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildStrategistSystemPrompt(brand: BrandSummary): string {
  return `You are KO, an expert content strategist for ${brand.name}. Have a short, focused conversation to understand the user's goal: ask about their objective, target audience, the platforms they use, their timeline, and any constraints — one or two questions at a time, not a wall of questions. Be warm, concise, and practical. Ground every suggestion in the brand context below. When you have enough to recommend a plan, summarize your recommendation in prose and tell the user they can click "Build Strategy" to generate a structured content strategy.\n\n${brandBlock(brand)}`;
}

export function buildStrategyGenerationPrompt(
  conversationText: string,
  brand: BrandSummary,
): string {
  return `Based on the conversation below, produce a complete, on-brand content strategy for ${brand.name}. It must include: a catchy campaign name, a measurable objective, the target audience, a single key message, recommended channels (each with a short rationale), a content mix (content type + how many of each), a phased timeline (phase, date range, focus), content themes (title + description), and an optimal posting schedule (channel + cadence). Keep it specific and realistic for this brand.\n\n${brandBlock(brand)}\n\nConversation:\n${conversationText}`;
}
