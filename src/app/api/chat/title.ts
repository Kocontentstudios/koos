/** Prompt + sanitizer for AI-generated conversation titles. */

export function buildTitlePrompt(
  userText: string,
  assistantText: string,
): string {
  return `Write a short, specific title (3-7 words) for this marketing chat. Describe the topic, not the participants. No quotes, no trailing punctuation. Examples: 30-Day Launch Awareness Content Plan / Instagram Carousel for Product Launch.

User: ${userText.slice(0, 600)}

Assistant: ${assistantText.slice(0, 600)}

Title:`;
}

/** Normalize model output into a display title, or null when unusable. */
export function cleanGeneratedTitle(raw: string): string | null {
  const cleaned = raw
    .replace(/^["'`“”#*\s]+/, "")
    .replace(/["'`“”*\s.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}
