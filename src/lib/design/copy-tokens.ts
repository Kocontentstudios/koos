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

export type CopyTokenKind = "word" | "number" | "clock" | "money" | "mark";

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
   *  between two numbers ("5-12", "24/7"). */
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
/* Spaces join tokens; a line break is a break like any other mark (round-10
   code critic, S6: "Fun for all ages\n8+ flavours" in one field). */
const SPACE = /[^\S\n\r\u2028\u2029]+/uy;
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

/** `text` as tokens, in order. */
export function tokensOf(text: string): CopyToken[] {
  const source = (text ?? "").normalize("NFC");
  const amounts = new Map<number, { end: number; amount: Amount }>();
  for (const m of source.matchAll(MONEY)) {
    const amount = amountOf(m);
    if (amount && m.index !== undefined) {
      amounts.set(m.index, { end: m.index + m[0].length, amount });
    }
  }
  const tokens: CopyToken[] = [];
  let i = 0;
  while (i < source.length) {
    const space = at(SPACE, source, i);
    if (space) {
      i += space[0].length;
      continue;
    }
    const money = amounts.get(i);
    if (money) {
      tokens.push({
        kind: "money",
        key: `m:${money.amount.currency}|${money.amount.value}`,
        text: source.slice(i, money.end).trim(),
        value: money.amount.value,
      });
      i = money.end;
      continue;
    }
    const clock = /[\dnm]/i.test(source[i]) ? at(CLOCK, source, i) : null;
    if (clock && (i === 0 || !/[\p{L}\d]/u.test(source[i - 1]))) {
      const minutes = clockMinutes(clock);
      tokens.push({
        kind: "clock",
        key: `c:${minutes}`,
        text: clock[0],
        value: minutes,
      });
      i += clock[0].length;
      continue;
    }
    const number = at(NUMBER, source, i);
    if (number) {
      const value = Number.parseFloat(
        `${number[1].replace(/,/g, "")}${number[2] ? `.${number[2]}` : ""}`,
      );
      tokens.push({
        kind: "number",
        key: `n:${value}`,
        text: number[0],
        value,
        ordinal: Boolean(number[3]),
      });
      i += number[0].length;
      continue;
    }
    const word = at(WORD, source, i);
    if (word) {
      const lower = word[0].toLowerCase().replace(/’/g, "'");
      const counted = NUMBER_WORDS[lower];
      tokens.push(
        counted === undefined
          ? { kind: "word", key: `w:${lower}`, text: word[0] }
          : {
              kind: "number",
              key: `n:${counted}`,
              text: word[0],
              value: counted,
            },
      );
      i += word[0].length;
      continue;
    }
    const char = String.fromCodePoint(source.codePointAt(i) as number);
    if (char === "&") {
      tokens.push({ kind: "word", key: "w:and", text: char });
    } else {
      const mark = DASHES.test(char) ? "-" : char === "’" ? "'" : char;
      tokens.push({ kind: "mark", key: mark, text: char });
    }
    i += char.length;
  }
  return markBreaks(tokens);
}

const isNumeric = (t: CopyToken | undefined) =>
  t?.kind === "number" || t?.kind === "clock";

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

export interface RunOptions {
  /** Every breaking mark compares equal to every other: "Saturday · 7pm"
   *  says what "Saturday, 7pm" says. For repeat checks only; a fact's
   *  forms name their own marks. */
  breaksAlike?: boolean;
}

function same(a: CopyToken, b: CopyToken, options: RunOptions): boolean {
  if (options.breaksAlike && a.breaks && b.breaks) return true;
  return a.key === b.key;
}

/** Every index of `haystack` where `needle` starts as a contiguous run. */
export function runsOf(
  haystack: readonly CopyToken[],
  needle: readonly CopyToken[],
  options: RunOptions = {},
): number[] {
  const found: number[] = [];
  if (needle.length === 0) return found;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((t, j) => same(haystack[i + j], t, options))) {
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
