/**
 * How well the brief reader (src/lib/jobs/directions/brief-read.ts) finds a
 * brief's hard facts, against facts a person labelled.
 *
 * Compared word by word, ignoring the glue around a fact ("from", "call",
 * "at our"): "from Monday" is "Monday", "Call 08035550142" is
 * "08035550142". A fact may join two labels whole ("every weekday from
 * 8am"), but one that takes part of another label ("9 Bourdillon Road,
 * Thursday" across the address and "Thursday to Sunday") is wrong, which is
 * exactly the round-4 failure.
 */

export interface LabelledFact {
  /** The brief's words for it. */
  text: string;
  /** Read or not, it is not counted against recall: a fact two careful
   *  readers would disagree about ("One size"). */
  optional?: boolean;
}

export interface LabelledOffering {
  kind: "product" | "event" | "service" | "none";
  /** Acceptable phrases: the reader's must be one of them, word for word
   *  apart from glue. Empty for none. */
  phrases: string[];
}

/**
 * The kind a label is held to when coverage is measured against it, read
 * off its words. Labels are fixed fixtures, so this is a table in code, and
 * read-score.test.ts pins every label's kind.
 */
export function labelKind(
  text: string,
):
  | "contact"
  | "price"
  | "time"
  | "age"
  | "date"
  | "day"
  | "place"
  | "quantity"
  | "offer" {
  const t = text.toLowerCase();
  if (
    /(?:\d[\s().-]{0,2}){7,}|@[\w.]+|\b[\w-]+\.(?:ng|com|co|org|io)\b|\b(whatsapp|instagram)\b/.test(
      t,
    )
  ) {
    return "contact";
  }
  if (/[₦$£€]|\bngn\b|\bnaira\b/.test(t)) return "price";
  if (/\d\s?(am|pm)\b|\bnoon\b|^\d{1,2}\s?[-–]\s?\d{1,2}$/.test(t)) {
    return "time";
  }
  if (/\bages?\b|\d\+/.test(t)) return "age";
  if (
    /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
      t,
    )
  ) {
    return "date";
  }
  if (
    /\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b|\bdaily\b|\bweek(day|end)s?\b/.test(
      t,
    )
  ) {
    return "day";
  }
  if (/\d.*\b(road|street|way|avenue|ave|mall|close|crescent)\b/.test(t)) {
    return "place";
  }
  if (
    /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/.test(
      t,
    )
  ) {
    return "quantity";
  }
  return "offer";
}

export interface ReadScore {
  /** Facts the reader returned (after settling). */
  extracted: number;
  /** Of those, made only of whole labelled facts. */
  precise: number;
  /** Required labels. */
  labelled: number;
  /** Of those, contained whole in some extracted fact. */
  recalled: number;
  /** What it got wrong, for the log. */
  extras: string[];
  misses: string[];
  offeringRight: boolean | null;
  peopleRight: boolean | null;
}

/* A fact ends on one of these only when it is cut off. */
const DANGLING_END =
  /\s(?:a|an|the|and|or|of|for|to|with|from|at|in|on|by|per|your|our|their|its|this|that)$/i;

const GLUE = new Set(
  "a an the our your this that these from on at in to by for of and or via call text dm book booking whatsapp instagram ages age available only is are be with".split(
    " ",
  ),
);

/* A fact made only of glue ("WhatsApp" as the way to book) is its own
   words. Numbers keep their grouping: "8,500" is not "500". */
export function coreWords(text: string): Set<string> {
  const tokens =
    text.toLowerCase().match(/[\p{L}\p{N}@]+(?:[.,'’-][\p{L}\p{N}@]+)*/gu) ??
    [];
  const core = tokens.filter((word) => !GLUE.has(word));
  return new Set(core.length > 0 ? core : tokens);
}

function within(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Where `text` sits in the brief, ignoring case and runs of spaces. */
function spanIn(brief: string, text: string): [number, number] | null {
  const pattern = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!pattern) return null;
  const m = new RegExp(pattern, "i").exec(brief);
  return m ? [m.index, m.index + m[0].length] : null;
}

const overlaps = (a: [number, number], b: [number, number]) =>
  a[0] < b[1] && b[0] < a[1];

/**
 * A fact is precise when every required label it reaches is either whole
 * inside it or holds it whole (a part of one fact, "Yaba" of "Yaba and
 * Surulere bars"), and it reaches at least one label. Reaching into a label
 * without holding it or being held by it is the round-4 garbage ("9
 * Bourdillon Road, Thursday" across the address and "Thursday to Sunday").
 * A required label is recalled when the facts that reach it say all of it
 * between them.
 */
export function scoreBriefRead({
  read,
  labels,
  brief,
  offering,
  people,
  expected,
}: {
  read: readonly { text: string }[];
  labels: readonly LabelledFact[];
  brief: string;
  offering?: { kind: string; phrase: string } | null;
  people?: readonly string[];
  expected?: { offering?: LabelledOffering; people?: string[] };
}): ReadScore {
  const placed = labels.flatMap((label) => {
    const span = spanIn(brief, label.text);
    return span ? [{ label, span, words: coreWords(label.text) }] : [];
  });
  const facts = read.map((fact) => ({
    text: fact.text,
    span: spanIn(brief, fact.text),
    words: coreWords(fact.text),
  }));
  const extras: string[] = [];
  let precise = 0;
  const saidOf = (label: (typeof placed)[number]) =>
    new Set(
      facts
        .filter((f) => f.span && overlaps(f.span, label.span))
        .flatMap((f) => [...f.words]),
    );
  for (const fact of facts) {
    const span = fact.span;
    const reached = span ? placed.filter((l) => overlaps(l.span, span)) : [];
    const labelWords = new Set(reached.flatMap((l) => [...l.words]));
    /* Round-5 code critic: "₦3,000 an amazing" and "₦4,500 a box for the"
       scored precise because each held a label whole. A fact carrying a
       word no label it reaches has, or ending mid-phrase, is not one. */
    const strays = [...fact.words].some((w) => !labelWords.has(w));
    const dangling = DANGLING_END.test(fact.text.trim());
    const clean =
      span !== null &&
      reached.length > 0 &&
      !strays &&
      !dangling &&
      reached.every(
        (l) =>
          l.label.optional ||
          within(l.words, fact.words) ||
          /* A part of one fact ("Yaba" of "Yaba and Surulere bars") only
             when the rest of it is read too: "Shop 4" alone, cut from
             "Shop 4, Sunday Market, Ikeja", loses the address. */
          (within(fact.words, l.words) && within(l.words, saidOf(l))),
      );
    if (clean) precise += 1;
    else extras.push(fact.text);
  }
  const required = placed.filter((l) => !l.label.optional);
  const misses = required
    .filter((l) => {
      const said = new Set(
        facts
          .filter((f) => f.span && overlaps(f.span, l.span))
          .flatMap((f) => [...f.words]),
      );
      return !within(l.words, said);
    })
    .map((l) => l.label.text);
  const want = expected?.offering;
  const offeringRight = want
    ? want.kind === "none"
      ? !offering
      : Boolean(
          offering &&
            offering.kind === want.kind &&
            want.phrases.some((p) => {
              const a = coreWords(p);
              const b = coreWords(offering.phrase);
              return within(a, b) && within(b, a);
            }),
        )
    : null;
  const peopleRight = expected?.people
    ? expected.people.length === (people?.length ?? 0) &&
      expected.people.every((name) =>
        (people ?? []).some((p) => p.toLowerCase() === name.toLowerCase()),
      )
    : null;
  return {
    extracted: read.length,
    precise,
    labelled: required.length,
    recalled: required.length - misses.length,
    extras,
    misses,
    offeringRight,
    peopleRight,
  };
}

export interface ReadTotals {
  briefs: number;
  /** Briefs the reader could not be reached for. */
  unavailable: number;
  precision: number;
  recall: number;
  offeringAccuracy: number;
  peopleAccuracy: number;
}

export function aggregateReads(
  scores: readonly (ReadScore | null)[],
): ReadTotals {
  const got = scores.filter((s): s is ReadScore => s !== null);
  const sum = (pick: (s: ReadScore) => number) =>
    got.reduce((n, s) => n + pick(s), 0);
  const extracted = sum((s) => s.extracted);
  const labelled = sum((s) => s.labelled);
  const offerings = got.filter((s) => s.offeringRight !== null);
  const people = got.filter((s) => s.peopleRight !== null);
  return {
    briefs: scores.length,
    unavailable: scores.length - got.length,
    precision: extracted === 0 ? 1 : sum((s) => s.precise) / extracted,
    recall: labelled === 0 ? 1 : sum((s) => s.recalled) / labelled,
    offeringAccuracy:
      offerings.length === 0
        ? 1
        : offerings.filter((s) => s.offeringRight).length / offerings.length,
    peopleAccuracy:
      people.length === 0
        ? 1
        : people.filter((s) => s.peopleRight).length / people.length,
  };
}

/** Frozen before the round-5 run. */
export const READ_THRESHOLDS = {
  /** Facts drawn on a design that are not a whole fact of the brief: the
   *  "9 Bourdillon Road, Thursday" class. */
  minPrecision: 0.95,
  /** Hard facts a design must carry that the reader missed. */
  minRecall: 0.9,
  minOfferingAccuracy: 0.85,
  minPeopleAccuracy: 1,
  maxUnavailable: 0,
} as const;

export function readFailures(
  t: ReadTotals,
  limits: typeof READ_THRESHOLDS = READ_THRESHOLDS,
): string[] {
  const failures: string[] = [];
  if (t.precision < limits.minPrecision) {
    failures.push(
      `read precision ${t.precision.toFixed(2)} < ${limits.minPrecision}`,
    );
  }
  if (t.recall < limits.minRecall) {
    failures.push(`read recall ${t.recall.toFixed(2)} < ${limits.minRecall}`);
  }
  if (t.offeringAccuracy < limits.minOfferingAccuracy) {
    failures.push(
      `read offering ${t.offeringAccuracy.toFixed(2)} < ${limits.minOfferingAccuracy}`,
    );
  }
  if (t.peopleAccuracy < limits.minPeopleAccuracy) {
    failures.push(
      `read people ${t.peopleAccuracy.toFixed(2)} < ${limits.minPeopleAccuracy}`,
    );
  }
  if (t.unavailable > limits.maxUnavailable) {
    failures.push(`read unavailable ${t.unavailable}`);
  }
  return failures;
}
