import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import {
  type BriefFact,
  detailHeldElsewhere,
  droppedSafely,
  type FactCopy,
  factStated,
} from "./brief-facts";
import { contentStems } from "./text-overlap";

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
    "You edit social media designs. For each direction below, mark every footer item that repeats, in any words, something the same direction's headline, subheadline, button or another of its footer items already says: the same date, time, place, price, count, offer or instruction, abbreviated or reworded ('12–14 December' and 'Friday 12 December · Sunday 14 December', 'Register Free' and 'Free registration', a phone number under a 'WhatsApp to book' button, 'Free Wi-Fi' beside 'Free Wi-Fi for lunch guests'). Of two footer items saying the same thing, mark the one that says less. Do not mark an item about something said nowhere else.",
    'When a marked item adds a detail to what is above (the weekdays of a date range, the number for a \'WhatsApp to book\' button), also give "field": "subheadline", and "rewrite": the subheadline written again with the detail in (a short new subheadline carrying it when there is none), using only words and facts from the subheadline and the item, within 140 characters, as one or two sentences, not a list. Never rewrite the headline or the button: the headline stays the idea and the button stays an action (\'WhatsApp to book\'). Otherwise leave field and rewrite empty.',
    blocks.join("\n\n"),
    'Return "repeats": one entry per marked item with its id ("0.1"), in a few words what above it the item repeats, and field and rewrite as above. An empty list when nothing repeats.',
  ].join("\n\n");
}

const schema = z.object({
  repeats: z
    .array(
      z.object({
        id: z.string(),
        /* A long explanation is cut, not a reason to lose the whole
           reading (round-6 live critic: fintech's check went unavailable
           on one 200-character answer). */
        repeats: z.string(),
        field: z.enum(["headline", "subheadline", "button", ""]).optional(),
        rewrite: z.string().optional(),
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
        /* A merge never replaces a button's ask or the headline's idea
           (Oluwaseyi's rulings); those marks are asked again for a
           subheadline. */
        const field =
          mark.field === "subheadline"
            ? (mark.field as FooterRepeatMark["field"])
            : undefined;
        const rewrite =
          typeof mark.rewrite === "string" ? mark.rewrite.trim() : "";
        return {
          id: mark.id,
          repeats: mark.repeats.slice(0, 200),
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
      const trial = droppedSafely(current, mark.item, facts);
      outcomes.push({
        direction: i,
        item: mark.item,
        repeats: mark.repeats,
        dropped: trial !== null,
        ...(trial
          ? {}
          : {
              kept: "it carries a fact, or a time, price, date, place or contact, said nowhere else",
            }),
      });
      if (trial) current = trial;
    }
    return current;
  });
  return { directions: out, outcomes };
}

/* A button stays an action ("WhatsApp to book"): a merge never rewrites
   it (Oluwaseyi's ruling; the round-6 live run had put the phone number on
   the button in place of the ask). */
const LIMITS = { headline: 70, subheadline: 140 } as const;

/* Round-6 eval, event slot 1: three merges made a 130-character
   subheadline of three clauses, a footer read aloud in the wrong place. */
const CLAUSE_BREAK = /[.!?](?:\s+|$)|\s+·\s+|\s+[—–]\s+|;\s*/;

export function readsAsList(text: string): boolean {
  return text.split(CLAUSE_BREAK).filter((part) => part.trim()).length > 2;
}

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
  /** False when the merged set leaves two directions near-duplicates. */
  keepsApart: (directions: T[]) => boolean = () => true,
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
    /* The headline is the idea, never a carrier for footer details (round-6
       live run: a phone number ended a headline; round-6 eval: a merged
       "Order your strawberry mille-feuille from 7am." became its sibling's
       headline again). */
    if (mark.field === "headline") {
      outcomes.push({ ...outcome, kept: "a headline is never rewritten" });
      continue;
    }
    const field = mark.field;
    const current = out[outcome.direction];
    const from = current[field] ?? "";
    const to = mark.rewrite.replace(/\s+/g, " ").trim();
    const stated = (copy: T) => facts.filter((f) => factStated(f, copy)).length;
    const trial = { ...withoutItem(current, outcome.item), [field]: to } as T;
    const fits = to.length > 0 && to.length <= LIMITS[field] && to !== from;
    if (fits && readsAsList(to)) {
      outcomes.push({ ...outcome, kept: "the merged field reads as a list" });
      continue;
    }
    if (
      fits &&
      !keepsApart(out.map((d, i) => (i === outcome.direction ? trial : d)))
    ) {
      outcomes.push({
        ...outcome,
        kept: "the merged field would leave two directions near-duplicates",
      });
      continue;
    }
    const merges =
      fits &&
      stated(trial) >= stated(current) &&
      detailHeldElsewhere(outcome.item, trial) &&
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
    "You edit social media designs. Each footer item below repeats something its direction already says above, but carries a detail the copy above does not (a weekday, a phone number, an address). For each, write the direction's subheadline again (a short new one when it has none) so it carries that detail too: the whole subheadline, using only words and facts from it and the item, within 140 characters, as one or two sentences, not a list. Never touch the headline or the button.",
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
    'Return "rewrites": one entry per item with its id, "field" ("subheadline") and "rewrite".',
  ].join("\n\n");
}

const rewriteSchema = z.object({
  rewrites: z
    .array(
      z.object({
        id: z.string(),
        field: z.enum(["headline", "subheadline"]),
        rewrite: z.string(),
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
        r.field === "subheadline" &&
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
    if (hasSubheadlineRewrite(mark)) return [];
    const [d, j] = mark.id.split(".").map(Number);
    const item = footerItemsOf(directions[d]?.footerLines ?? [])[j];
    if (!item || !facts.some((f) => factStated(f, item))) return [];
    return [{ id: mark.id, item }];
  });
}

/** A mark already carrying the one merge allowed: into the subheadline. */
export function hasSubheadlineRewrite(mark: FooterRepeatMark): boolean {
  return Boolean(mark.rewrite) && mark.field === "subheadline";
}

/* Half an item's words on the button, and no fact of its own, is the
   button's ask said again (round-6 live run: "Order ahead for pickup"
   under "Order Ahead", unmarked by the model). */
const BUTTON_ECHO_SHARE = 0.5;

function echoesButton(
  item: string,
  button: string,
  facts: readonly BriefFact[],
): boolean {
  if (!button || facts.some((f) => factStated(f, item))) return false;
  const words = contentStems(item);
  if (words.size === 0) return false;
  const ask = contentStems(button);
  const shared = [...words].filter((w) => ask.has(w)).length;
  return shared / words.size >= BUTTON_ECHO_SHARE;
}

/**
 * The directions without footer items that only say the button's action
 * again, when the drop loses nothing (droppedSafely).
 */
export function dropButtonEchoes<T extends FactCopy>(
  directions: T[],
  facts: readonly BriefFact[],
): { directions: T[]; outcomes: FooterRepeatOutcome[] } {
  const outcomes: FooterRepeatOutcome[] = [];
  const out = directions.map((direction, i) => {
    let current = direction;
    for (const item of footerItemsOf(direction.footerLines)) {
      if (!echoesButton(item, direction.cta ?? "", facts)) continue;
      const trial = droppedSafely(current, item, facts);
      if (!trial) continue;
      current = trial;
      outcomes.push({
        direction: i,
        item,
        repeats: "the button's action",
        dropped: true,
      });
    }
    return current;
  });
  return { directions: out, outcomes };
}
