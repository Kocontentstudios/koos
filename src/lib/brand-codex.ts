import type { BrandGuide } from "@/lib/ai/brand-guide";

export interface CodexBrand {
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
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
  competitors?: string | null;
  competitorStrengths?: string | null;
  differentiators?: string | null;
  platforms?: string[] | null;
  primaryPlatform?: string | null;
  postingFrequency?: string | null;
  additionalNotes?: string | null;
}

/** A labelled value, dropped entirely when the brand never answered. */
function line(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `- **${label}:** ${trimmed}` : null;
}

function listLine(
  label: string,
  values: string[] | null | undefined,
): string | null {
  const cleaned = values?.map((v) => v.trim()).filter(Boolean) ?? [];
  return cleaned.length > 0 ? `- **${label}:** ${cleaned.join(", ")}` : null;
}

function section(heading: string, body: (string | null)[]): string | null {
  const kept = body.filter((l): l is string => Boolean(l));
  return kept.length > 0 ? `## ${heading}\n\n${kept.join("\n")}` : null;
}

function bulletSection(heading: string, items: string[]): string | null {
  const kept = items.map((i) => i.trim()).filter(Boolean);
  return kept.length > 0
    ? `### ${heading}\n\n${kept.map((i) => `- ${i}`).join("\n")}`
    : null;
}

/**
 * The brand's Codex as a Markdown document.
 *
 * Deliberately drops unanswered fields rather than printing empty labels —
 * unlike the admin export, which keeps nulls because a missing answer is
 * information to an operator. This is the user's own document, and blank rows
 * read as an unfinished product.
 */
export function toBrandCodexMarkdown(
  brand: CodexBrand,
  guide: BrandGuide | null,
): string {
  const blocks = [
    `# ${brand.name.trim()} — Brand Codex`,

    section("Overview", [
      line("What we do", brand.overview),
      line("Business type", brand.businessType),
      line("Stage", brand.stage),
      line("Primary goal", brand.primaryGoal),
      line("Offer", brand.offer),
    ]),

    section("Audience", [line("Who we're for", brand.targetAudience)]),

    section("Personality", [
      line("Tone", brand.tone),
      line("Values", brand.values),
      line("Words we love", brand.wordsLove),
      line("Words we avoid", brand.wordsAvoid),
    ]),

    guide
      ? [
          "## Voice & Messaging Guide",
          bulletSection("Tone spectrum", guide.toneSpectrum),
          bulletSection("Do", guide.dos),
          bulletSection("Don't", guide.donts),
          bulletSection("Writing style rules", guide.writingStyleRules),
          bulletSection("Vocabulary guardrails", guide.vocabularyGuardrails),
          bulletSection("Sounds like", guide.exampleLines),
        ]
          .filter(Boolean)
          .join("\n\n")
      : null,

    section("Visual identity", [
      line("Style", brand.brandStyle),
      line("Primary colour", brand.primaryColor),
      line("Secondary colour", brand.secondaryColor),
      listLine("Additional colours", brand.additionalColors),
    ]),

    section("Market", [
      line("Competitors", brand.competitors),
      line("What sets us apart", brand.differentiators),
      line("Where competitors lead", brand.competitorStrengths),
    ]),

    section("Platforms", [
      listLine("Active on", brand.platforms),
      line("Primary platform", brand.primaryPlatform),
      line("Posting frequency", brand.postingFrequency),
    ]),

    section("Notes", [line("Anything else", brand.additionalNotes)]),
  ];

  return `${blocks.filter(Boolean).join("\n\n")}\n`;
}

/** Safe, recognisable filename: "Lagos Loom" becomes "lagos-loom-brand-codex.md". */
export function brandCodexFilename(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand";
  return `${slug}-brand-codex.md`;
}
