/**
 * Copy read as tokens: the one reading every literal check uses, the brief
 * fact verifier (`factStated`), the fact writer's footer repeat check
 * (`redundantFooterItems`) and the renderer's (`footerLinesFor`).
 *
 * Rounds 7 to 10 inferred what a number meant from the nearest word, and
 * listed the punctuation that ended a clause. Every unlisted separator ("·",
 * "/", "…", a line break) and every unlisted noun let a number borrow a
 * word from another clause, so a fact was reported delivered that the
 * design never printed (Oluwaseyi's ruling, 2026-10-28). Here only spaces
 * join tokens: every character that is not part of a word, number, clock
 * time or amount is a token of its own, so a run of tokens can only cross
 * it when the run itself contains it.
 */

export const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  million: 1000000,
  dozen: 12,
};

/* "one" is a count only before what it counts: "One seat left",
   "twenty-one guests", "one hundred". "the one", "any one", "one of",
   "one more" and "one day" count nothing. The tokenizer and
   claims.inventedFacts read it by these lists alike (round-12 code critic:
   the verifier refused "One seat left" for "1 seat" while inventedFacts
   counted "one" in "Gifts under one roof"). */
export const ONE_NOT_AFTER = [
  "the",
  "any",
  "every",
  "no",
  "each",
  "this",
  "that",
  "which",
  "someone",
  "anyone",
];
export const ONE_NOT_BEFORE = [
  "of",
  "another",
  "more",
  "by",
  "day",
  "way",
  "thing",
  "and",
  "or",
];

/** Each weekday's spellings, its full name first. */
export const WEEKDAY_NAMES = [
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
  ["sunday", "sun"],
];
const WEEKDAY_WORDS = new Set(WEEKDAY_NAMES.flat());

/** Whether `t` names a weekday, in any of its spellings. */
export function isWeekdayName(t: CopyToken | undefined): boolean {
  return t?.kind === "word" && WEEKDAY_WORDS.has(t.key.slice(2));
}

export type CopyTokenKind = "word" | "number" | "clock" | "money" | "mark";

/** A number written in words, where it stands in the text. */
export interface NumberWord {
  value: number;
  text: string;
  start: number;
  end: number;
}

export interface CopyToken {
  kind: CopyTokenKind;
  /** What the token is compared by: "w:ages", "n:8", "c:1140" (minutes
   *  past midnight), "m:ngn|4500", or the mark itself. */
  key: string;
  /** The copy's own spelling. */
  text: string;
  /** A number written as an ordinal ("5th"). */
  ordinal?: boolean;
  /** A number's value, a clock's minutes or an amount's value. */
  value?: number;
  /** A mark that ends a clause: every mark but "+", "%" and a "-" or "/"
   *  between two numbers, times or amounts ("5-12", "24/7"). */
  breaks?: boolean;
}

/* An amount with its currency: "₦4,500", "N4500", "NGN 4,500", "4,500
   naira", "$20", "GH₵50", "GHS 50", "KSh 300", "R250", "R 250", "ZAR 250",
   "₦2.5m". Round-7 code critic: only ₦, $, £ and € were read, so a Ghana
   price was "stated" by any count, and "$20" by "₦20". */
const AMOUNT = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const SCALE = "(?:\\s?(k|m|million|bn)\\b)?";
export const MONEY = new RegExp(
  `(?<![\\p{L}\\d])(₦|GH₵|GH¢|₵|US\\$|\\$|£|€|(?:NGN|USD|GBP|EUR|GHS|KES|KSh\\.?|ZAR)(?=\\s?\\d)|N(?=\\d)|R(?=\\s?\\d))\\s?(${AMOUNT})${SCALE}|(${AMOUNT})\\s?(naira|ngn|cedis?|ghs|shillings?|kes|rand|zar|dollars?|usd)\\b`,
  "giu",
);

const CURRENCY_BEFORE: [RegExp, string][] = [
  [/^(?:₦|N|NGN)$/i, "ngn"],
  [/^(?:\$|USD|US\$)$/i, "usd"],
  [/^(?:£|GBP)$/i, "gbp"],
  [/^(?:€|EUR)$/i, "eur"],
  [/^(?:GH₵|GH¢|GHS|₵)$/i, "ghs"],
  [/^(?:KSh|KES|Ksh\.?)$/i, "kes"],
  [/^(?:R|ZAR)$/i, "zar"],
];
const CURRENCY_AFTER: [RegExp, string][] = [
  [/^(?:naira|ngn)$/i, "ngn"],
  [/^(?:cedis?|ghs)$/i, "ghs"],
  [/^(?:shillings?|kes)$/i, "kes"],
  [/^(?:rand|zar)$/i, "zar"],
  [/^(?:dollars?|usd)$/i, "usd"],
];
const SCALES: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
};

export interface Amount {
  currency: string;
  value: number;
}

/** The currency and value of one MONEY match. */
export function amountOf(m: RegExpMatchArray): Amount | null {
  const raw = m[2] ?? m[5];
  if (raw === undefined) return null;
  let value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (m[4]) value *= SCALES[m[4].toLowerCase()] ?? 1;
  const sign = (m[1] ?? m[7] ?? "").trim();
  const table = m[1] ? CURRENCY_BEFORE : CURRENCY_AFTER;
  const currency = table.find(([re]) => re.test(sign))?.[1] ?? "?";
  return { currency, value: Math.round(value * 100) / 100 };
}

/* "7pm", "7 pm", "6.30pm", "07:00", "noon". "6.30pm" is half past six,
   not 30pm, and "07:00" with no am or pm is a 24-hour clock. */
const CLOCK =
  /(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?![\p{L}])|([01]?\d|2[0-3]):([0-5]\d)(?![\d:])|(noon|midday|midnight)(?![\p{L}])/iuy;
const NUMBER =
  /(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?(?:(st|nd|rd|th)(?![\p{L}]))?/uy;
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/uy;
/* Only the spaces a renderer draws join tokens. A line break is a break
   like any other mark (round-10 code critic, S6: "Fun for all ages\n8+
   flavours" in one field), and so are \v, \f, U+FEFF and U+1680, which
   JS counts as \s but no design draws as a space (round-11, U8 to U14). */
const SPACE = /[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]+/uy;
const DASHES = /[-‐‑‒–—―−]/u;

function clockMinutes(m: RegExpExecArray): number {
  if (m[6]) return m[6].toLowerCase() === "midnight" ? 0 : 720;
  if (m[4]) return Number(m[4]) * 60 + Number(m[5]);
  const pm = m[3].toLowerCase().startsWith("p");
  return ((Number(m[1]) % 12) + (pm ? 12 : 0)) * 60 + Number(m[2] ?? 0);
}

function at(re: RegExp, text: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(text);
}

interface Placed {
  token: CopyToken;
  start: number;
  end: number;
}

/** `text` as tokens, in order. */
export function tokensOf(text: string): CopyToken[] {
  return markBreaks(readTokens(text).map((p) => p.token));
}

/** Every number written in words in `text` ("one", "twenty-five", "five
 *  hundred"), read whole as tokensOf reads it, with where it stands. */
export function numberWordsOf(text: string): NumberWord[] {
  return readTokens(text)
    .filter(({ token }) => isNumberWord(token))
    .map(({ token, start, end }) => ({
      value: token.value ?? 0,
      text: token.text,
      start,
      end,
    }));
}

function readTokens(text: string): Placed[] {
  const placed: Placed[] = [];
  const source = (text ?? "").normalize("NFC");
  const amounts = new Map<number, { end: number; amount: Amount }>();
  for (const m of source.matchAll(MONEY)) {
    const amount = amountOf(m);
    if (amount && m.index !== undefined) {
      amounts.set(m.index, { end: m.index + m[0].length, amount });
    }
  }
  let i = 0;
  while (i < source.length) {
    const space = at(SPACE, source, i);
    if (space) {
      i += space[0].length;
      continue;
    }
    const money = amounts.get(i);
    if (money) {
      placed.push({
        token: {
          kind: "money",
          key: `m:${money.amount.currency}|${money.amount.value}`,
          text: source.slice(i, money.end).trim(),
          value: money.amount.value,
        },
        start: i,
        end: money.end,
      });
      i = money.end;
      continue;
    }
    const clock = /[\dnm]/i.test(source[i]) ? at(CLOCK, source, i) : null;
    if (clock && (i === 0 || !/[\p{L}\d]/u.test(source[i - 1]))) {
      const minutes = clockMinutes(clock);
      placed.push({
        token: {
          kind: "clock",
          key: `c:${minutes}`,
          text: clock[0],
          value: minutes,
        },
        start: i,
        end: i + clock[0].length,
      });
      i += clock[0].length;
      continue;
    }
    const number = at(NUMBER, source, i);
    if (number) {
      const value = Number.parseFloat(
        `${number[1].replace(/,/g, "")}${number[2] ? `.${number[2]}` : ""}`,
      );
      placed.push({
        token: {
          kind: "number",
          key: `n:${value}`,
          text: number[0],
          value,
          ordinal: Boolean(number[3]),
        },
        start: i,
        end: i + number[0].length,
      });
      i += number[0].length;
      continue;
    }
    const word = at(WORD, source, i);
    if (word) {
      const lower = word[0].toLowerCase().replace(/’/g, "'");
      const counted = NUMBER_WORDS[lower];
      placed.push({
        token:
          counted === undefined
            ? { kind: "word", key: `w:${lower}`, text: word[0] }
            : {
                kind: "number",
                key: `n:${counted}`,
                text: word[0],
                value: counted,
              },
        start: i,
        end: i + word[0].length,
      });
      i += word[0].length;
      continue;
    }
    const char = String.fromCodePoint(source.codePointAt(i) as number);
    const end = i + char.length;
    if (char === "&") {
      placed.push({
        token: { kind: "word", key: "w:and", text: char },
        start: i,
        end,
      });
    } else {
      const mark = DASHES.test(char) ? "-" : char === "’" ? "'" : char;
      placed.push({
        token: { kind: "mark", key: mark, text: char },
        start: i,
        end,
      });
    }
    i += char.length;
  }
  return withNumberWordsFolded(withOneRead(placed));
}

const isWordKey = (p: Placed | undefined, ...words: string[]) =>
  p?.token.kind === "word" && words.includes(p.token.key.slice(2));

/* "one" as a number where it counts (ONE_NOT_AFTER, ONE_NOT_BEFORE), and
   always as the units of "twenty-one". */
function withOneRead(placed: Placed[]): Placed[] {
  return placed.map((p, i) => {
    if (p.token.key !== "w:one") return p;
    const before = placed[i - 1];
    const tens =
      isTens(before?.token) ||
      (before?.token.key === "-" && isTens(placed[i - 2]?.token));
    const next = placed[i + 1];
    const countsNext =
      (next?.token.kind === "word" &&
        next.token.text.length >= 3 &&
        !isWordKey(next, ...ONE_NOT_BEFORE)) ||
      multiplierOf(next?.token) !== undefined;
    if (!tens && (!countsNext || isWordKey(before, ...ONE_NOT_AFTER))) {
      return p;
    }
    return {
      ...p,
      token: { kind: "number", key: "n:1", text: p.token.text, value: 1 },
    };
  });
}

const MULTIPLIERS: Record<string, number> = {
  hundred: 100,
  dozen: 12,
  thousand: 1000,
  million: 1000000,
};
const multiplierOf = (t: CopyToken | undefined) =>
  t?.kind === "number" ? MULTIPLIERS[t.text.toLowerCase()] : undefined;
const isNumberWord = (t: CopyToken | undefined) =>
  t?.kind === "number" && /^\p{L}/u.test(t.text);
const isTens = (t: CopyToken | undefined) =>
  isNumberWord(t) && (t?.value ?? 0) >= 20 && (t?.value ?? 0) % 10 === 0;
const isUnit = (t: CopyToken | undefined) =>
  isNumberWord(t) && (t?.value ?? 0) < 10;

/* A number written in words is one value, read whole: "five hundred
   seats" is 500 seats, "two dozen" 24, "twenty-five" 25, "2 million"
   2,000,000. Read word by word, "five hundred seats" held the run "hundred
   seats", which stated "100 seats" (round-11 code critic, W5 to W10). A
   multiplier with no number before it is one of it ("a dozen"). */
function withNumberWordsFolded(placed: Placed[]): Placed[] {
  const tokens = placed.map((p) => p.token);
  const out: Placed[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const first = tokens[i];
    if (first.kind !== "number" || first.ordinal) {
      out.push(placed[i]);
      continue;
    }
    let total = 0;
    let current = multiplierOf(first) ?? first.value ?? 0;
    let last = first;
    let end = i;
    for (;;) {
      const next = tokens[end + 1];
      const mult = multiplierOf(next);
      if (mult && next && !next.ordinal) {
        if (mult >= 1000) {
          total += (current || 1) * mult;
          current = 0;
        } else {
          current = (current || 1) * mult;
        }
        last = next;
        end += 1;
        continue;
      }
      /* "twenty-five", "twenty five", "five hundred fifty", "five hundred
         and fifty" */
      const afterJoin = tokens[end + 2];
      const joined =
        (next?.key === "-" && isTens(last) && isUnit(afterJoin)) ||
        (next?.key === "w:and" &&
          multiplierOf(last) !== undefined &&
          isNumberWord(afterJoin) &&
          multiplierOf(afterJoin) === undefined);
      if (joined && afterJoin && !afterJoin.ordinal) {
        current += afterJoin.value ?? 0;
        last = afterJoin;
        end += 2;
        continue;
      }
      const follows =
        isNumberWord(next) &&
        !next?.ordinal &&
        multiplierOf(next) === undefined &&
        ((isTens(last) && isUnit(next)) || multiplierOf(last) !== undefined);
      if (follows && next) {
        current += next.value ?? 0;
        last = next;
        end += 1;
        continue;
      }
      break;
    }
    if (end === i) {
      out.push(placed[i]);
      continue;
    }
    const value = total + current;
    out.push({
      token: {
        kind: "number",
        key: `n:${value}`,
        text: tokens
          .slice(i, end + 1)
          .map((t) => t.text)
          .join(" ")
          .replace(/ - /g, "-"),
        value,
      },
      start: placed[i].start,
      end: placed[end].end,
    });
    i = end;
  }
  return out;
}

/** A number, a clock time or an amount. */
export const isNumeric = (t: CopyToken | undefined) =>
  t?.kind === "number" || t?.kind === "clock" || t?.kind === "money";

/** Whether `t` joins the numbers on either side into one: the "-" of
 *  "5-12" and "₦4,500-₦6,000", the "/" of "24/7" and "1/20". */
export const joinsNumbers = (t: CopyToken | undefined) =>
  t?.kind === "mark" && !t.breaks && (t.key === "-" || t.key === "/");

function markBreaks(tokens: CopyToken[]): CopyToken[] {
  return tokens.map((t, i) => {
    if (t.kind !== "mark") return t;
    const inside =
      (t.key === "-" || t.key === "/") &&
      isNumeric(tokens[i - 1]) &&
      isNumeric(tokens[i + 1]);
    return { ...t, breaks: !(t.key === "+" || t.key === "%" || inside) };
  });
}

/** Whether `t` is a mark that ends a clause; a missing token (either end of
 *  the field) ends one too. */
export function endsClause(t: CopyToken | undefined): boolean {
  return t === undefined || t.breaks === true;
}

/** The clauses of `tokens`, split at every breaking mark. */
export function clausesOf(tokens: readonly CopyToken[]): CopyToken[][] {
  const clauses: CopyToken[][] = [[]];
  for (const t of tokens) {
    if (t.breaks) clauses.push([]);
    else clauses[clauses.length - 1].push(t);
  }
  return clauses.filter((c) => c.length > 0);
}

/** Every index of `haystack` where `needle` starts as a contiguous run,
 *  each token, marks included, compared by its key. No two marks compare
 *  equal: "Ages: 8+" is not "ages · 8+" (round-11 code critic, J13). */
export function runsOf(
  haystack: readonly CopyToken[],
  needle: readonly CopyToken[],
): number[] {
  const found: number[] = [];
  if (needle.length === 0) return found;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((t, j) => haystack[i + j].key === t.key)) {
      found.push(i);
    }
  }
  return found;
}

/** `tokens` without the breaking marks at either end: "PRE-ORDER NOW!" is
 *  the button "Pre-order now". A trailing "+" or "%" stays ("8+" is an age
 *  and up), and so does a leading "@", "#" or "+" ("@cake.ng" is a handle,
 *  not the website "Cake.ng"). */
export function withoutEdgeMarks(tokens: readonly CopyToken[]): CopyToken[] {
  const loose = (t: CopyToken) => t.kind === "mark" && t.breaks === true;
  let start = 0;
  let end = tokens.length;
  while (
    start < end &&
    loose(tokens[start]) &&
    !/^[@#]$/.test(tokens[start].key)
  )
    start += 1;
  while (end > start && loose(tokens[end - 1])) end -= 1;
  return tokens.slice(start, end);
}

/* Where a sentence ends, for counting a subheadline's sentences (a merge
   that reads as a list): a full stop, "!" or "?", a middle dot, a spaced
   dash or a semicolon. Commas are inside a sentence. */
const SENTENCE_END = /[.!?](?:\s+|$)|\s+·\s+|\s+[—–]\s+|;\s*/;

/** The sentences of `text`, empty ones left out. */
export function sentencesOf(text: string): string[] {
  return text.split(SENTENCE_END).filter((part) => part.trim());
}
