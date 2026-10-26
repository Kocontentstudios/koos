import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { type BriefFact, type FactCopy, factStated } from "./brief-facts";

/**
 * Footer items that say again, in other words, what the headline,
 * subheadline or button already says. Code matches words, numbers and
 * times; "Free registration" under a "Register Free" button, or "Friday 12
 * December · Sunday 14 December" under "12–14 December", are the same thing
 * in other words, and the round-6 eval's judge read such repeats on four in
 * ten directions (Oluwaseyi's decision: a model marks them, code decides).
 *
 * Reading is the model's: it marks items. Dropping is code's: a marked item
 * goes only when every brief fact the direction states is still stated
 * without it (dropMarkedRepeats). Fail-soft: an unreachable check drops
 * nothing.
 */

export interface FooterRepeatMark {
  /** "0.1": direction 0, footer item 1 in reading order. */
  id: string;
  /** What above it the item repeats, in the model's words. */
  repeats: string;
}

export type FooterRepeatChecker = (
  directions: readonly Pick<
    FactCopy,
    "headline" | "subheadline" | "cta" | "footerLines"
  >[],
) => Promise<FooterRepeatMark[] | null>;

const FOOTER_JOIN = " · ";

function footerItemsOf(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    line
      .split(FOOTER_JOIN)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function buildFooterRepeatPrompt(
  directions: Parameters<FooterRepeatChecker>[0],
): string {
  const blocks = directions.map((d, i) =>
    [
      `Direction ${i}:`,
      `  headline: ${d.headline}`,
      d.subheadline ? `  subheadline: ${d.subheadline}` : null,
      d.cta ? `  button: ${d.cta}` : null,
      ...footerItemsOf(d.footerLines).map(
        (item, j) => `  footer item ${i}.${j}: ${item}`,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "You edit social media designs. For each direction below, mark every footer item that only repeats, in any words, something the same direction's headline, subheadline or button already says: the same date, time, place, price, count, offer or instruction, abbreviated or reworded ('12–14 December' and 'Friday 12 December · Sunday 14 December', 'Register Free' and 'Free registration'). Do not mark an item that adds anything a customer would need: a detail, a number, a contact or a place that is not said above it.",
    blocks.join("\n\n"),
    'Return "repeats": one entry per marked item with its id ("0.1") and, in a few words, what above it the item repeats. An empty list when nothing repeats.',
  ].join("\n\n");
}

const schema = z.object({
  repeats: z
    .array(z.object({ id: z.string(), repeats: z.string().max(200) }))
    .max(30),
});

export const checkFooterRepeats: FooterRepeatChecker = async (directions) => {
  const ids = new Set(
    directions.flatMap((d, i) =>
      footerItemsOf(d.footerLines).map((_, j) => `${i}.${j}`),
    ),
  );
  if (ids.size === 0) return [];
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      maxOutputTokens: 1200,
      prompt: buildFooterRepeatPrompt(directions),
    });
    const repeats = (object as { repeats?: unknown }).repeats;
    if (!Array.isArray(repeats)) return null;
    return repeats.filter(
      (mark): mark is FooterRepeatMark =>
        typeof mark?.id === "string" &&
        typeof mark?.repeats === "string" &&
        ids.has(mark.id),
    );
  } catch (err) {
    console.error("footer repeat check unavailable; dropping nothing", err);
    return null;
  }
};

/** What became of one marked item, for the usage row and the eval. */
export interface FooterRepeatOutcome {
  direction: number;
  item: string;
  repeats: string;
  dropped: boolean;
  /** Why a marked item stayed. */
  kept?: string;
}

/**
 * The directions without the marked footer items whose removal loses no
 * brief fact the direction states; every other marked item stays, and why
 * is recorded.
 */
export function dropMarkedRepeats<T extends FactCopy>(
  directions: T[],
  marks: readonly FooterRepeatMark[],
  facts: readonly BriefFact[],
): { directions: T[]; outcomes: FooterRepeatOutcome[] } {
  const outcomes: FooterRepeatOutcome[] = [];
  const out = directions.map((direction, i) => {
    const items = footerItemsOf(direction.footerLines);
    const marked = marks
      .filter((m) => m.id.startsWith(`${i}.`))
      .map((m) => ({ ...m, item: items[Number(m.id.split(".")[1])] }))
      .filter((m) => m.item !== undefined);
    let current = direction;
    for (const mark of marked) {
      const stated = (copy: T) =>
        facts.filter((f) => factStated(f, copy)).length;
      const footerLines = current.footerLines
        .map((line) =>
          line
            .split(FOOTER_JOIN)
            .map((item) => item.trim())
            .filter((item) => item !== mark.item)
            .join(FOOTER_JOIN),
        )
        .filter(Boolean);
      const trial = {
        ...current,
        footerLines,
        footerStyle: footerLines.length > 0 ? current.footerStyle : "none",
      } as T;
      const keepsFacts = stated(trial) === stated(current);
      outcomes.push({
        direction: i,
        item: mark.item,
        repeats: mark.repeats,
        dropped: keepsFacts,
        ...(keepsFacts
          ? {}
          : { kept: "it carries a brief fact said nowhere else" }),
      });
      if (keepsFacts) current = trial;
    }
    return current;
  });
  return { directions: out, outcomes };
}
