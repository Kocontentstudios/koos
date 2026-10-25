import { generateObject } from "ai";
import type { CountryCode } from "libphonenumber-js/max";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import {
  BRIEF_FACT_KINDS,
  type BriefFact,
  needsFor,
  phoneRegions,
  type ReadFact,
  settleBriefFacts,
} from "./brief-facts";

/**
 * One small structured call that reads a brief: its hard facts, what it
 * offers, and the real people it names. Reading a brief is judgement on
 * ambiguous text, so a model does it; settleBriefRead then holds every
 * answer to the brief's own words in code: a fact is drawn only in the
 * brief's words, and what the reader saw but could not be held to them is
 * recorded, never drawn.
 *
 * Its own call rather than a field of the directions answer: it runs beside
 * that call (no added wait), it can be measured on a labelled set without
 * paying for two directions (eval:design-directions), and a regenerate
 * reads the same brief the same way.
 */

export const OFFERING_KINDS = ["product", "event", "service", "none"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

const readSchema = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(BRIEF_FACT_KINDS),
        text: z.string().max(200),
      }),
    )
    .max(30),
  offering: z.object({
    kind: z.enum(OFFERING_KINDS),
    phrase: z.string().max(120),
  }),
  people: z.array(z.string().max(80)).max(10),
});

export interface RawBriefRead {
  facts: ReadFact[];
  offering: { kind: string; phrase: string } | null;
  people: string[];
}

export type BriefReader = (input: {
  briefText: string;
  title: string;
}) => Promise<RawBriefRead | null>;

export function buildBriefReadPrompt({
  briefText,
  title,
}: {
  briefText: string;
  title: string;
}): string {
  return [
    "You read a small business's design brief so a designer can put every fact a customer needs on the design. Copy the brief's words exactly; never rephrase, correct or complete them.",
    `The brief: ${briefText}`,
    title ? `Its title (not part of the brief): ${title}` : null,
    `"facts": every hard fact a customer would act on, each once, as {kind, text} where text is copied character for character from the brief. Kinds:
- day: a weekday, weekday range or recurrence ("Saturdays", "Thursday to Sunday", "every weekday").
- date: a calendar date, with its weekday when the brief joins them ("Saturday 15 November", "3 November", "12/11").
- time: a clock time or range, including bare hour ranges ("7am to 7pm", "2pm", "9-5", "0900-1700").
- price: a price with the unit or quantity it is for, kept together ("₦4,500 a slice", "NGN 34,000 for a set of four", "₦25,000 per person"); a discount ("20% off"); something free, with what it is ("Free registration", "first class free").
- quantity: a count or limit ("only 15 made", "12 places", "set of four" when no price is attached, "three shots").
- age: an age limit ("ages 13 to 17", "16+").
- place: an address or named place, ending before any day or time that follows it ("9 Bourdillon Road, Ikoyi" from "9 Bourdillon Road, Thursday to Sunday"; "our Yaba bar").
- contact: one way to reach the business with its channel ("WhatsApp 0803 555 0142", "Call 08035550142", "@cake.ng on Instagram", "adirehouse.ng", an email). A phone number ends at its last digit: never include an hour, count or second number after it. Two numbers are two facts.
- offer: what is included or given ("apron and starter to take home", "all milk and beans included", "first class free").
- condition: a rule the customer must follow ("pre-orders close 12 February", "booking required", "ask the barista to wrap yours").
Not facts: the product or event's own name, the brand's name, how it is made, served or described ("served over ice", "handwoven"), adjectives and mood.`,
    `"offering": what the brief promotes. kind is "product" for a physical thing sold, "event" for something that happens at a time (class, workshop, panel, launch party), "service" for work done for the customer (a salon, a gym class pass, an app's transfers), "none" for a greeting or message with nothing on offer. phrase is the brief's shortest exact words naming it, whole ("strawberry mille-feuille", "cold brew", "jade organza overcoat", "teen sourdough baking class"), never one word of a longer name, never a channel, place, shop or price; "" for none.`,
    `"people": every real person the brief names, exactly as written ("Ada Obi"), or an empty list.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const readBriefWithModel: BriefReader = async (input) => {
  const ask = async () => {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: readSchema,
      maxOutputTokens: 1500,
      prompt: buildBriefReadPrompt(input),
    });
    return object as Partial<RawBriefRead>;
  };
  let answer: Partial<RawBriefRead>;
  try {
    answer = await ask();
  } catch (first) {
    console.error("brief read failed once; asking again", first);
    try {
      answer = await ask();
    } catch (err) {
      console.error("brief read unavailable", err);
      return null;
    }
  }
  if (!Array.isArray(answer?.facts)) return null;
  return {
    facts: answer.facts.filter(
      (f): f is ReadFact =>
        typeof f?.kind === "string" && typeof f?.text === "string",
    ),
    offering:
      answer.offering && typeof answer.offering.phrase === "string"
        ? answer.offering
        : null,
    people: Array.isArray(answer.people)
      ? answer.people.filter((p): p is string => typeof p === "string")
      : [],
  };
};

export interface BriefRead {
  /** False when the reader could not be reached: the design is still made,
   *  with no facts to cover, and the usage row says so. */
  available: boolean;
  facts: BriefFact[];
  /** What the brief promotes, in its own words, or null when it names
   *  nothing (or the reader's phrase is not the brief's). */
  offering: { kind: Exclude<OfferingKind, "none">; phrase: string } | null;
  /** Real people the brief names, in its words. */
  people: string[];
  /** Each named person as a fact every direction must state, in the
   *  brief's words with the role it gives them ("with head baker Tunde
   *  Okafor"). */
  peopleFacts: BriefFact[];
  /** What the reader said that was not the brief's own words, or not a
   *  usable fact. */
  dropped: { text: string; why: string }[];
  /** Facts the reader saw but in words not the brief's (settleBriefFacts):
   *  checked against the delivered copy, never drawn. */
  unread: BriefFact[];
  /** Phone numbers the brief gives that the reader did not return. */
  phonesAdded: string[];
}

/** Every fact a design must state: the brief's facts and the people it
 *  names. */
export function coverFactsOf(read: BriefRead): BriefFact[] {
  return [...read.facts, ...read.peopleFacts];
}

/* Words that are never what a brief sells, however the reader frames them
   (round-3 code critic: "WhatsApp", "shop" and "bakery's" resolved as
   products). */
export const NOT_AN_OFFERING =
  /^(?:our\s+|the\s+)?(?:shop|store|bar|studio|bakery'?s?|salon|brand|business|whatsapp|instagram|facebook|tiktok|website|app)$/i;

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** `phrase` as the brief writes it, matched on whole words: "ice" is not in
 *  "price", nor "Ada" in "Adaeze" (round-5 code critic). */
export function inBrief(
  phrase: string,
  brief: string,
): { text: string; start: number } | null {
  const said = phrase.trim().replace(/[\s.,;:!]+$/, "");
  if (!said) return null;
  const lower = brief.toLowerCase();
  const wanted = said.toLowerCase();
  for (
    let at = lower.indexOf(wanted);
    at >= 0;
    at = lower.indexOf(wanted, at + 1)
  ) {
    const end = at + said.length;
    const before = at > 0 ? brief[at - 1] : "";
    const after = end < brief.length ? brief[end] : "";
    const clean =
      !(before && WORD_CHAR.test(before) && WORD_CHAR.test(brief[at])) &&
      !(after && WORD_CHAR.test(after) && WORD_CHAR.test(brief[end - 1]));
    if (clean) return { text: brief.slice(at, end), start: at };
  }
  return null;
}

/* The role a brief gives a person, read back from their name: "with head
   baker Tunde Okafor", "Speaker: Ada Obi", "hosted by Chef Funke". */
const ROLE_BEFORE =
  /\b(?:with|featuring|feat\.?|by|hosted by|led by|taught by|speakers?|hosts?|guests?|keynote|panell?ists?)\s*:?\s+(?:[\p{L}'’.-]+\s+){0,3}$/iu;

function personFact(
  brief: string,
  found: { text: string; start: number },
): BriefFact {
  const role = ROLE_BEFORE.exec(
    brief.slice(Math.max(0, found.start - 60), found.start),
  );
  const between = role?.[0] ?? "";
  /* Only lower-case role words may sit between the cue and the name; a
     capitalised word there is another name or a sentence. */
  const words = between.trim().split(/\s+/).slice(1);
  const plain = words.every(
    (w) =>
      !/^\p{Lu}/u.test(w) ||
      /^(?:Chef|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Pastor|Coach|DJ|MC)$/.test(w),
  );
  const text =
    role && plain
      ? brief.slice(
          found.start - between.length,
          found.start + found.text.length,
        )
      : found.text;
  return {
    kind: "person",
    text: text.charAt(0).toUpperCase() + text.slice(1),
    needs: needsFor("person", found.text),
  };
}

/** The reader's answer, held to the brief (settleBriefFacts for the facts;
 *  the offering and the people must be the brief's own words too). */
export function settleBriefRead(
  raw: RawBriefRead | null,
  briefText: string,
  region: CountryCode,
): BriefRead {
  const brief = briefText ?? "";
  const regions = phoneRegions(brief, region);
  if (!raw) {
    /* The reader is the reading; without it the brief's phone numbers are
       still facts, found by libphonenumber alone. */
    const phones = settleBriefFacts([], brief, { region: regions });
    return {
      available: false,
      facts: phones.facts,
      offering: null,
      people: [],
      peopleFacts: [],
      dropped: [],
      unread: [],
      phonesAdded: phones.phonesAdded,
    };
  }
  const dropped: BriefRead["dropped"] = [];
  const phrase = raw.offering
    ? inBrief(raw.offering.phrase, brief)?.text
    : null;
  const kind = raw.offering?.kind;
  let offering: BriefRead["offering"] = null;
  if (
    phrase &&
    (kind === "product" || kind === "event" || kind === "service") &&
    !NOT_AN_OFFERING.test(phrase) &&
    !/\d/.test(phrase)
  ) {
    offering = { kind, phrase };
  } else if (raw.offering?.phrase && kind !== "none") {
    dropped.push({
      text: raw.offering.phrase,
      why: "offering not named in the brief's own words",
    });
  }
  const people: string[] = [];
  const peopleFacts: BriefFact[] = [];
  for (const name of raw.people) {
    const found = inBrief(name, brief);
    if (!found) {
      dropped.push({ text: name, why: "person not in the brief" });
      continue;
    }
    if (people.includes(found.text)) continue;
    people.push(found.text);
    peopleFacts.push(personFact(brief, found));
  }
  const settled = settleBriefFacts(raw.facts, brief, {
    region: regions,
    product: offering?.phrase ?? "",
  });
  return {
    available: true,
    facts: settled.facts,
    offering,
    people,
    peopleFacts,
    dropped: [...dropped, ...settled.dropped],
    unread: settled.unread,
    phonesAdded: settled.phonesAdded,
  };
}
