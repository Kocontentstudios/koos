import type { DesignContext } from "@/lib/design/context";
import { brandFacts } from "@/lib/jobs/directions/brief";
import {
  type BriefFact,
  drawnText,
  needsFor,
  withVenueOrBrand,
} from "@/lib/jobs/directions/brief-facts";
import { coverFactsOf } from "@/lib/jobs/directions/brief-read";
import {
  type FactLedger,
  factLedger,
  inventedFacts,
  NUMBER_WORDS,
} from "@/lib/jobs/directions/claims";
import { commercialClaims } from "./commercial";
import type { FrameBeat } from "./contract";
import { profileStatements } from "./points";
import { frameCopy } from "./validate";

/** The facts a set is held to, read exactly as draftDirections reads them
 *  (brief.ts): a venue the brief calls "our Yaba bar" is stated by the
 *  brand's name and the area, as a single design's would be. */
export function sequenceFacts(
  read: Parameters<typeof coverFactsOf>[0],
  brandName: string,
  briefText = "",
): BriefFact[] {
  return withVenueOrBrand(
    coverFactsOf(read).map((fact) =>
      withTurnaround(withCountWord(fact, briefText), briefText),
    ),
    brandName,
  );
}

/* NUMBER_WORDS leaves "one" out, as copy says "one of a kind"; right
   before a figure ("One 60-minute session") it is a count. */
const COUNT_WORDS = ["one", ...Object.keys(NUMBER_WORDS)];

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The fact as the brief counts it: a reader that returns "60-minute
 * session" from "One 60-minute session" drops how many, and copy written
 * to the shorter words is then held to fewer than the brief gives. A
 * number word the brief puts right before the fact is part of it.
 */
export function withCountWord(fact: BriefFact, briefText: string): BriefFact {
  const before = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${COUNT_WORDS.join("|")})\\s+${escaped(fact.text)}(?![\\p{L}\\p{N}])`,
    "iu",
  ).exec(briefText);
  if (!before || /^\p{N}/u.test(fact.text) === false) return fact;
  const text = `${before[1]} ${fact.text}`;
  return { ...fact, text, needs: needsFor(fact.kind, text) };
}

const DURATION =
  /^(?:\p{N}+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)(?:\s*(?:-|to)\s*\p{N}+)?[\s-]*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|working days?|business days?)$/iu;
const TURNAROUND =
  "ready|done|delivered|back|returned|fixed|finished|completed|shipped|collected|installed|repaired|cleaned|available|dispatched";

/**
 * A duration as the brief promises it: a reader that returns "2 days"
 * from "Shoes resoled and ready in 2 days" keeps the length and loses
 * what happens in it, so copy saying "Booked in 2 days" would count. The word
 * and "in" or "within" the brief puts before the duration are part of
 * the fact.
 */
export function withTurnaround(fact: BriefFact, briefText: string): BriefFact {
  if (!DURATION.test(fact.text.trim())) return fact;
  const lead = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])((?:${TURNAROUND})\\s+(?:in|within))\\s+${escaped(fact.text)}(?![\\p{L}\\p{N}])`,
    "iu",
  ).exec(briefText);
  if (!lead) return fact;
  const text = `${lead[1].toLowerCase()} ${fact.text}`;
  return { ...fact, text, needs: needsFor(fact.kind, text) };
}

/**
 * What the brief and brand vouch for. Unlike a single design's ledger, the
 * profile's statements (profileStatements) license what the brief does: a
 * thin brief's frame makes a profile point by decision (Oluwaseyi,
 * 2026-10-30), so a claim taken word for word from the brand's
 * differentiators is sourced. The goal licenses nothing: it is what the
 * business wants, not what is true. `stated` is what the owner wrote into
 * the approved outline (rubric Addendum A, O4): the owner vouches for it
 * as the brief does.
 */
export function sequenceLedger(
  context: DesignContext,
  memorySummary: string,
  stated: readonly string[] = [],
): FactLedger {
  const brand = context.brandSummary;
  const statements = profileStatements(brand);
  const goal = brand.primaryGoal?.trim();
  const rest = brandFacts(brand).filter(
    (source) =>
      source?.trim() !== goal && !statements.includes(source?.trim() ?? ""),
  );
  return factLedger(
    [
      context.briefText,
      context.title,
      ...statements,
      ...stated,
      ...rest,
      memorySummary,
    ],
    2 + statements.length + stated.length,
  );
}

/** Numbers, days, claims and commercial terms on a frame that neither the
 *  brief nor the brand gives. Not a contract rule: the fix call is asked
 *  to take them out, and the eval counts any that stay. */
export function inventedOn(beat: FrameBeat, ledger: FactLedger): string[] {
  const text = drawnText(frameCopy(beat));
  /* Field by field: a number that ends one field is never a count of the
     word that opens the next ("Lekki Phase 1" over "Our shop is..."). */
  const fields = [
    beat.headline,
    beat.subheadline,
    beat.cta,
    ...beat.footerLines,
  ];
  const made = fields
    .filter(Boolean)
    .flatMap((field) =>
      inventedFacts(field, ledger).filter(
        (found) => !invitationWord(found, field, field === beat.cta, ledger),
      ),
    )
    .filter((found) => !sourcedYear(found, ledger));
  return [...new Set(made), ...commercialClaims(text, ledger.text)];
}

/* An action line ("Book now", "Get a fresh tune-up today") asks the reader
   to act; "now" and "today" there set no date and promise nothing, so a
   regenerate must not be refused for them. "Tonight only" is still a
   promise, and so is "today" on a line that does not ask for an action. */
const ACTION_LINE =
  /^\s*(?:book|order|call|visit|join|register|get|start|reserve|message|dm|whatsapp|shop|buy|sign\s+up|apply|try|text|email|contact|enrol|enroll|subscribe|download|claim|grab|come|bring|drop|send|pick)\b/i;
const URGENCY = /^(?:now|today)\b/i;
/* "Fresh" is a quality claim only about what can go stale: bread, a juice,
   peppers. "A fresh tune-up" or "ride fresh" claims nothing checkable. */
const PERISHABLE =
  /\b(?:food|bread|bak\w*|cake|pastr\w*|meal|kitchen|restaurant|caf[eé]|coffee|beans?|tea|juice|drinks?|milk|fruit|vegetables?|veg|fish|meat|chicken|pepper\w*|sauce|spice\w*|flowers?|produce|farm\w*|grocer\w*|eggs?)\b/i;

function invitationWord(
  found: string,
  field: string,
  isButton: boolean,
  ledger: FactLedger,
): boolean {
  if (/^fresh(?:ly)?$/i.test(found)) return !PERISHABLE.test(ledger.text);
  if (!URGENCY.test(found) || /\bonly\b/i.test(field)) return false;
  return isButton || ACTION_LINE.test(field);
}

/* A year the brief gives is a date, never a count of the word after it:
   "3x in 2025. Strong collections" is not "2025 strong" invented. */
const LEADING_YEAR = /^((?:19|20)\d\d)\b/;

function sourcedYear(made: string, ledger: FactLedger): boolean {
  const year = LEADING_YEAR.exec(made)?.[1];
  return year !== undefined && ledger.text.includes(year);
}
