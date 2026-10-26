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
 * Reading is the model's: it marks items, and for an item that only adds
 * detail to something above ("Friday 12 December to Sunday 14 December"
 * under "12–14 December") it writes that field again carrying the detail.
 * Deciding is code's: a marked item goes when every brief fact the
 * direction states is still stated without it (dropMarkedRepeats), or when
 * the rewritten field carries it and passes every rule a correction must
 * (mergeMarkedRepeats, Oluwaseyi's ruling). Fail-soft: an unreachable
 * check changes nothing.
 */

export interface FooterRepeatMark {
  /** "0.1": direction 0, footer item 1 in reading order. */
  id: string;
  /** What above it the item repeats, in the model's words. */
  repeats: string;
  /** For an item that adds detail to something above: the field to carry
   *  it and that field written again with the detail. */
  field?: "headline" | "subheadline" | "button";
  rewrite?: string;
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
    "You edit social media designs. For each direction below, mark every footer item that repeats, in any words, something the same direction's headline, subheadline or button already says: the same date, time, place, price, count, offer or instruction, abbreviated or reworded ('12–14 December' and 'Friday 12 December · Sunday 14 December', 'Register Free' and 'Free registration', a phone number under a 'WhatsApp to book' button). Do not mark an item about something not said above it at all.",
    "When a marked item adds a detail to what is above (the weekdays of a date range, the number for a 'WhatsApp to book' button), also give \"field\": the subheadline, or the headline when there is no subheadline, and \"rewrite\": that whole field written again with the detail in, using only words and facts from the field and the item, within its limit (headline 70 characters, subheadline 140). Never rewrite the button: it stays an action ('WhatsApp to book'). Otherwise leave field and rewrite empty.",
    blocks.join("\n\n"),
    'Return "repeats": one entry per marked item with its id ("0.1"), in a few words what above it the item repeats, and field and rewrite as above. An empty list when nothing repeats.',
  ].join("\n\n");
}

const schema = z.object({
  repeats: z
    .array(
      z.object({
        id: z.string(),
        repeats: z.string().max(200),
        field: z.enum(["headline", "subheadline", "button", ""]).optional(),
        rewrite: z.string().max(200).optional(),
      }),
    )
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
    return repeats
      .filter(
        (mark) =>
          typeof mark?.id === "string" &&
          typeof mark?.repeats === "string" &&
          ids.has(mark.id),
      )
      .map((mark): FooterRepeatMark => {
        /* A merge never replaces a button's ask (Oluwaseyi's ruling). */
        const field = ["headline", "subheadline"].includes(mark.field)
          ? (mark.field as FooterRepeatMark["field"])
          : undefined;
        const rewrite =
          typeof mark.rewrite === "string" ? mark.rewrite.trim() : "";
        return {
          id: mark.id,
          repeats: mark.repeats,
          ...(field && rewrite ? { field, rewrite } : {}),
        };
      });
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
  /** The field above rewritten to carry the item's detail, when it was. */
  merged?: {
    field: "headline" | "subheadline";
    from: string;
    to: string;
  };
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
          : {
              kept: "it carries a brief fact said nowhere else, and no rewrite of the field above was offered",
            }),
      });
      if (keepsFacts) current = trial;
    }
    return current;
  });
  return { directions: out, outcomes };
}

/* A button stays an action ("WhatsApp to book"): a merge never rewrites
   it (Oluwaseyi's ruling; the round-6 live run had put the phone number on
   the button in place of the ask). */
const LIMITS = { headline: 70, subheadline: 140 } as const;

function withoutItem<T extends FactCopy>(copy: T, item: string): T {
  const footerLines = copy.footerLines
    .map((line) =>
      line
        .split(FOOTER_JOIN)
        .map((i) => i.trim())
        .filter((i) => i !== item)
        .join(FOOTER_JOIN),
    )
    .filter(Boolean);
  return {
    ...copy,
    footerLines,
    footerStyle: footerLines.length > 0 ? copy.footerStyle : "none",
  } as T;
}

/**
 * dropMarkedRepeats, then the merge Oluwaseyi ruled for: a marked item that
 * carries a fact said nowhere else in full goes when the model's rewrite of
 * the field above carries it instead ("Friday 12 to Sunday 14 December" for
 * "12–14 December" over "Friday 12 December to Sunday 14 December"). The
 * rewrite is held like any correction (`holds`: limits, the brief's facts
 * and language, the offering, and the claim check), and every fact the
 * direction stated must still be stated; otherwise the item stays.
 */
export async function settleMarkedRepeats<T extends FactCopy>(
  directions: T[],
  marks: readonly FooterRepeatMark[],
  facts: readonly BriefFact[],
  holds: (before: T, after: T) => Promise<boolean>,
): Promise<{ directions: T[]; outcomes: FooterRepeatOutcome[] }> {
  const dropped = dropMarkedRepeats(directions, marks, facts);
  const out = [...dropped.directions];
  const outcomes: FooterRepeatOutcome[] = [];
  for (const outcome of dropped.outcomes) {
    const mark = marks.find(
      (m) =>
        m.id.startsWith(`${outcome.direction}.`) &&
        footerItemsOf(directions[outcome.direction].footerLines)[
          Number(m.id.split(".")[1])
        ] === outcome.item,
    );
    if (outcome.dropped || !mark?.field || !mark.rewrite) {
      outcomes.push(outcome);
      continue;
    }
    if (mark.field === "button") {
      outcomes.push({ ...outcome, kept: "a button stays an action" });
      continue;
    }
    /* The headline carries a detail only when there is no subheadline to
       take it (round-6 live run: a phone number ended a headline). */
    if (mark.field === "headline" && out[outcome.direction].subheadline) {
      outcomes.push({
        ...outcome,
        kept: "a headline is not rewritten while there is a subheadline",
      });
      continue;
    }
    const field = mark.field;
    const current = out[outcome.direction];
    const from = current[field] ?? "";
    const to = mark.rewrite.replace(/\s+/g, " ").trim();
    const stated = (copy: T) => facts.filter((f) => factStated(f, copy)).length;
    const trial = { ...withoutItem(current, outcome.item), [field]: to } as T;
    const fits = to.length > 0 && to.length <= LIMITS[field] && to !== from;
    const merges =
      fits &&
      stated(trial) === stated(current) &&
      (await holds(current, trial));
    if (merges) {
      out[outcome.direction] = trial;
      outcomes.push({
        ...outcome,
        dropped: true,
        merged: { field, from, to },
      });
      const { kept: _kept, ...rest } = outcomes[outcomes.length - 1];
      outcomes[outcomes.length - 1] = rest;
    } else {
      outcomes.push({
        ...outcome,
        kept: fits
          ? "the merged field did not hold to the brief's rules"
          : "the merged field would not fit",
      });
    }
  }
  return { directions: out, outcomes };
}

/** A rewrite of the field above for one marked footer item. */
export interface FooterRewrite {
  id: string;
  field: "headline" | "subheadline";
  rewrite: string;
}

export type FooterRewriter = (
  directions: Parameters<FooterRepeatChecker>[0],
  items: readonly { id: string; item: string }[],
) => Promise<FooterRewrite[] | null>;

export function buildFooterRewritePrompt(
  directions: Parameters<FooterRepeatChecker>[0],
  items: readonly { id: string; item: string }[],
): string {
  return [
    "You edit social media designs. Each footer item below repeats something its direction already says above, but carries a detail the copy above does not (a weekday, a phone number, an address). For each, write the direction's subheadline again (or its headline when it has no subheadline) so it carries that detail too: the whole field, using only words and facts from the field and the item, within its limit (headline 70 characters, subheadline 140). Never touch the button.",
    ...items.map(({ id, item }) => {
      const d = directions[Number(id.split(".")[0])];
      return [
        `Item ${id}: ${item}`,
        `  headline: ${d.headline}`,
        d.subheadline ? `  subheadline: ${d.subheadline}` : null,
        d.cta ? `  button: ${d.cta}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }),
    'Return "rewrites": one entry per item with its id, "field" ("subheadline" or "headline") and "rewrite".',
  ].join("\n\n");
}

const rewriteSchema = z.object({
  rewrites: z
    .array(
      z.object({
        id: z.string(),
        field: z.enum(["headline", "subheadline"]),
        rewrite: z.string().max(200),
      }),
    )
    .max(30),
});

/**
 * The second, targeted ask: a rewrite for every marked item that carries a
 * fact and came back without one, so each gets a merge attempt. Fail-soft
 * like the first.
 */
export const askFooterRewrites: FooterRewriter = async (directions, items) => {
  if (items.length === 0) return [];
  const ids = new Set(items.map((i) => i.id));
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: rewriteSchema,
      maxOutputTokens: 1200,
      prompt: buildFooterRewritePrompt(directions, items),
    });
    const rewrites = (object as { rewrites?: unknown }).rewrites;
    if (!Array.isArray(rewrites)) return null;
    return rewrites.filter(
      (r): r is FooterRewrite =>
        typeof r?.id === "string" &&
        ids.has(r.id) &&
        (r.field === "headline" || r.field === "subheadline") &&
        typeof r.rewrite === "string" &&
        r.rewrite.trim().length > 0,
    );
  } catch (err) {
    console.error("footer rewrite ask unavailable", err);
    return null;
  }
};

/** The marked items that carry a brief fact and have no rewrite yet. */
export function marksNeedingRewrite(
  directions: Parameters<FooterRepeatChecker>[0],
  marks: readonly FooterRepeatMark[],
  facts: readonly BriefFact[],
): { id: string; item: string }[] {
  return marks.flatMap((mark) => {
    if (mark.rewrite) return [];
    const [d, j] = mark.id.split(".").map(Number);
    const item = footerItemsOf(directions[d]?.footerLines ?? [])[j];
    if (!item || !facts.some((f) => factStated(f, item))) return [];
    return [{ id: mark.id, item }];
  });
}
