import { formatRules } from "@/lib/design/formats";
import { isFragment } from "@/lib/jobs/directions/brief-facts";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import { COPY_LIMITS, COPY_TARGETS } from "@/lib/jobs/directions/schema";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { textsOverlap } from "./arc";
import type { FrameBeat, PlannedSequence, SequenceKind } from "./contract";
import { withoutStatement } from "./cuts";
import {
  type FaultRules,
  type Flag,
  flaggedFaults,
  headlineGrammar,
  headlinePrices,
  pointRepeats,
  restatesHeadline,
  stillSays,
  subheadlineGrammar,
} from "./faults";
import { echoesHeadline, namesFree, previewedFrames } from "./hook";
import { inventedOn } from "./ledger";
import { ownerPointKept } from "./outline-arc";
import { textStatesPrice } from "./points";
import { withoutFactWords } from "./repeats";
import { factsUncovered, validateSequence } from "./validate";

/**
 * What must not ship, settled in code after the fix calls: a statement no
 * source gives, a carousel's price in a headline before the action, a
 * headline making another frame's point, a subheadline that is not a
 * sentence, a middle frame with a headline alone, a hook whose subheadline
 * says its headline again, and a hook that does not name the offering.
 * The planner runs a fix call on what is left after the gate and the gate
 * again after it, so a fault code cannot settle here gets a rewrite. Unlike a fix, a change here is not weighed against
 * the set's other faults: the fault it removes is one a reader may not be
 * shown. Code only removes words or puts the frame's own claim (its
 * source's words) in their place; the one exception is the offering's
 * name, written on the hook when no version named it.
 */

export interface GateRules extends FaultRules {
  /** Each frame's claim from the arc ("" for none). */
  claims: readonly string[];
  /** The audit's unsourced statements, by frame. */
  unsourced: readonly Flag[];
  /** Unused points of the pool, best first, in their source's words: what
   *  a frame whose headline is another frame's point takes instead. */
  spares?: readonly string[];
}

export interface GateResult {
  plan: PlannedSequence;
  applied: string[];
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const capitalised = (text: string) =>
  text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;

/** `text` as one sentence: a capital first and a full stop last. */
export function asSentence(text: string): string {
  const flat = capitalised(text.trim().replace(/\s+/g, " "));
  if (!flat) return "";
  return /[.!?]$/.test(flat) ? flat : `${flat}.`;
}

function fitsHeadline(text: string, kind: SequenceKind): boolean {
  return (
    text.length > 0 &&
    text.length <= COPY_LIMITS.headline &&
    wordCount(text) <= formatRules(kind).headlineWords + 2 &&
    !isFragment(text)
  );
}

function fitsSubheadline(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= COPY_LIMITS.subheadline &&
    wordCount(text) <= COPY_TARGETS.subheadline.words + 2 &&
    !isFragment(text) &&
    subheadlineGrammar(text) === null
  );
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=\S)/;

/* Where a claim of two parts divides: "steeped for 18 hours, then served
   over ice" is a headline and the sentence under it. */
const CLAIM_JOIN = /,\s+|;\s+|\s+[—–]\s+|\s+(?:and|so|then|while|which)\s+/g;
/* Each half must say something of its own to stand as a line. */
const HALF_WORDS = 2;

/** A claim of two parts as a headline and a subheadline, at the first
 *  join both halves stand on, or null. */
export function claimHalves(claim: string): [string, string] | null {
  const flatClaim = claim.trim().replace(/\s+/g, " ").replace(/[.]$/, "");
  for (const join of flatClaim.matchAll(CLAIM_JOIN)) {
    const at = join.index ?? 0;
    const head = flatClaim.slice(0, at).trim();
    const rest = flatClaim
      .slice(at + join[0].length)
      .trim()
      .replace(/^then\s+/i, "");
    /* "Each teen shapes" is not a headline: a half cut at a joining word
       must carry its object as well as its verb. */
    const headWords = /^[,;]/.test(join[0]) ? HALF_WORDS : HALF_WORDS + 1;
    if (
      contentStems(head).size >= headWords &&
      contentStems(rest).size >= HALF_WORDS
    ) {
      return [capitalised(head), asSentence(rest)];
    }
  }
  return null;
}

const says = (field: string, text: string) =>
  stillSays({ headline: field, subheadline: "", footerLines: [] }, text);

/** The statements on a frame that no source gives: the ledger's and the
 *  audit's, while the frame still says them. */
export function unsourcedOn(
  beat: FrameBeat,
  frame: number,
  rules: Pick<GateRules, "ledger" | "unsourced">,
): string[] {
  const audited = rules.unsourced.flatMap((flag) =>
    flag.kind === "unsourced" &&
    flag.frame === frame &&
    stillSays(beat, flag.text)
      ? [flag.text]
      : [],
  );
  return [...new Set([...inventedOn(beat, rules.ledger), ...audited])];
}

class Gate {
  frames: FrameBeat[];
  applied: string[] = [];
  readonly free: ReadonlySet<string>;
  /** Each frame's claim, a frame given a spare point taking it. */
  claims: string[];
  spares: string[];

  constructor(
    readonly plan: PlannedSequence,
    readonly rules: GateRules,
  ) {
    this.frames = [...plan.frames];
    this.free = namesFree(rules.brandName, rules.offering);
    this.claims = [...rules.claims];
    this.spares = [...(rules.spares ?? [])];
  }

  /** Whether `frames` keeps what only the copy can carry: every name the
   *  hook must give, and every brief fact code cannot draw onto a footer
   *  afterwards (withFactsDrawn). */
  keepsCoverage(frames: readonly FrameBeat[]): boolean {
    const names = [this.rules.offering, ...this.rules.names].filter(
      (n): n is string => Boolean(n),
    );
    const named = (beats: readonly FrameBeat[]) =>
      names.filter((n) => beats[0] && copyNamesOffering(beats[0], n)).length;
    const undrawable = (beats: readonly FrameBeat[]) =>
      factsUncovered(beats, this.rules.facts).filter(
        (f) => f.kind === "product" || f.text.length > COPY_LIMITS.footerLine,
      ).length;
    return (
      named(frames) >= named(this.frames) &&
      undrawable(frames) <= undrawable(this.frames)
    );
  }

  set(frame: number, change: Partial<FrameBeat>, what: string): boolean {
    const next = this.frames.map((b, i) =>
      i === frame ? { ...b, ...change } : b,
    );
    if (!this.keepsCoverage(next)) return false;
    this.frames = next;
    this.applied.push(`frame ${frame + 1}: ${what}`);
    return true;
  }

  /** The frame's claim as a line no other frame's copy says, or null. */
  claimAs(frame: number, field: "headline" | "subheadline"): string | null {
    const claim = (this.claims[frame] ?? "").trim();
    const beat = this.frames[frame];
    if (!claim || !beat) return null;
    const line =
      field === "headline" ? claim.replace(/[.]$/, "") : asSentence(claim);
    const fits =
      field === "headline"
        ? fitsHeadline(line, this.plan.kind)
        : fitsSubheadline(line) &&
          !textsOverlap(line, beat.headline, this.free);
    if (!fits) return null;
    const alone = {
      ...beat,
      headline: field === "headline" ? line : "",
      subheadline: field === "subheadline" ? line : "",
      cta: "",
      footerLines: [],
    };
    if (unsourcedOn(alone, frame, this.rules).length > 0) return null;
    const elsewhere = this.frames.some(
      (other, i) =>
        i !== frame &&
        textsOverlap(line, `${other.headline} ${other.subheadline}`, this.free),
    );
    return elsewhere ? null : line;
  }

  /** The frame's claim in two halves, as its headline and subheadline,
   *  when both stand, neither says the other, and no other frame says
   *  either. */
  claimInHalves(frame: number): Partial<FrameBeat> | null {
    const halves = claimHalves(this.claims[frame] ?? "");
    const beat = this.frames[frame];
    if (!halves || !beat) return null;
    const [headline, subheadline] = halves;
    if (
      !fitsHeadline(headline, this.plan.kind) ||
      headlineGrammar(headline) !== null ||
      !fitsSubheadline(subheadline) ||
      textsOverlap(headline, subheadline, this.free)
    ) {
      return null;
    }
    const next = { ...beat, headline, subheadline };
    if (restatesHeadline(next)) return null;
    const alone = { ...next, cta: "", footerLines: [] };
    if (unsourcedOn(alone, frame, this.rules).length > 0) return null;
    const elsewhere = this.frames.some(
      (other, i) =>
        i !== frame &&
        [headline, subheadline].some((line) =>
          textsOverlap(
            line,
            `${other.headline} ${other.subheadline}`,
            this.free,
          ),
        ),
    );
    return elsewhere ? null : { headline, subheadline };
  }

  withoutUnsourced() {
    this.frames.forEach((_, frame) => {
      for (let pass = 0; pass < 4; pass += 1) {
        const beat = this.frames[frame];
        const [statement] = unsourcedOn(beat, frame, this.rules);
        if (!statement) return;
        const cut = withoutStatement(beat, statement);
        if (cut) {
          if (this.set(frame, cut, `cut "${statement}"`)) continue;
          return;
        }
        /* One word ("two") is too little to lose a sentence over, as the
           rest is the brief's more often than not: only the frame's own
           claim takes its place. */
        const oneWord = wordCount(statement) < 2;
        if (says(beat.subheadline, statement)) {
          const own = this.claimAs(frame, "subheadline");
          if (oneWord && !own) return;
          /* A hook's lone sentence often carries its names: in its place
             go the names alone, never an empty line. */
          const claim =
            own ??
            (frame === 0 ? this.namesLine({ ...beat, subheadline: "" }) : null);
          const done = this.set(
            frame,
            { subheadline: claim ?? "" },
            claim
              ? `subheadline with "${statement}" set to its claim`
              : `subheadline with "${statement}" left out`,
          );
          if (done) continue;
          return;
        }
        if (says(beat.headline, statement)) {
          const claim = this.claimAs(frame, "headline");
          if (!claim) return;
          const done = this.set(
            frame,
            { headline: claim },
            `headline with "${statement}" set to its claim`,
          );
          if (done) continue;
          return;
        }
        return;
      }
    });
  }

  withoutHeadlinePrices() {
    const { facts } = this.rules;
    for (const fault of headlinePrices(
      this.frames,
      facts,
      this.plan.kind,
      this.rules.atAction,
    )) {
      const beat = this.frames[fault.frame];
      const price = facts.find(
        (f) => f.kind === "price" && fault.detail.includes(`"${f.text}"`),
      );
      if (!beat || !price || !textStatesPrice(price, beat.headline)) continue;
      const cut = withoutFactWords(beat.headline, price);
      if (cut && fitsHeadline(cut, this.plan.kind)) {
        this.set(
          fault.frame,
          { headline: capitalised(cut) },
          "price cut from the headline",
        );
        continue;
      }
      const claim = this.claimAs(fault.frame, "headline");
      if (claim && !textStatesPrice(price, claim)) {
        this.set(
          fault.frame,
          { headline: claim },
          "priced headline set to its claim",
        );
      }
    }
  }

  /** Middle frames whose headline makes another frame's point, by words
   *  or by the audit's reading. */
  twins(): number[] {
    const { facts } = this.rules;
    const plan = { ...this.plan, frames: this.frames };
    const repeated = [
      ...pointRepeats(this.frames, facts, this.free).map((f) => f.frame),
      ...validateSequence(plan, this.rules).flatMap((p) =>
        p.rule === "headline-repeat" && p.frame !== null ? [p.frame] : [],
      ),
      ...flaggedFaults(
        this.frames,
        (this.rules.flagged ?? []).filter((f) => f.kind === "repeat"),
      ).map((f) => f.frame),
    ];
    return [...new Set(repeated)].filter(
      (i) => this.frames[i]?.role === "body",
    );
  }

  /** Whether `change` leaves fewer frames making another's point; kept
   *  only then. */
  private untwins(frame: number, change: Partial<FrameBeat>, what: string) {
    const before = this.twins().length;
    const previous = this.frames;
    const applied = this.applied.length;
    if (!this.set(frame, change, what)) return false;
    if (this.twins().length < before) return true;
    this.frames = previous;
    this.applied.length = applied;
    return false;
  }

  /** A spare point as a headline no other frame's copy says, or null. */
  private spareHeadline(frame: number): string | null {
    for (const spare of this.spares) {
      const line = spare.trim().replace(/[.]$/, "");
      if (!fitsHeadline(line, this.plan.kind)) continue;
      const alone = {
        ...this.frames[frame],
        headline: line,
        subheadline: "",
        footerLines: [],
      };
      if (unsourcedOn(alone, frame, this.rules).length > 0) continue;
      const elsewhere = this.frames.some(
        (other, i) =>
          i !== frame &&
          textsOverlap(
            line,
            `${other.headline} ${other.subheadline}`,
            this.free,
          ),
      );
      if (!elsewhere) return capitalised(line);
    }
    return null;
  }

  /** Each middle frame whose headline makes another frame's point given
   *  its own claim as its headline, else a spare point in its place (its
   *  old subheadline going with the point it made). */
  withoutTwins() {
    for (const frame of this.twins()) {
      const beat = this.frames[frame];
      const claim = this.claimAs(frame, "headline");
      if (
        claim &&
        claim !== beat.headline &&
        this.untwins(
          frame,
          { headline: claim },
          "repeated headline set to its claim",
        )
      ) {
        continue;
      }
      const spare = this.spareHeadline(frame);
      if (!spare) continue;
      const taken = this.untwins(
        frame,
        { headline: spare, subheadline: "" },
        "repeated headline given a spare point",
      );
      if (taken) {
        const source = this.spares.find(
          (p) => capitalised(p.trim().replace(/[.]$/, "")) === spare,
        );
        this.claims[frame] = source ?? spare;
        this.spares = this.spares.filter((p) => p !== source);
      }
    }
  }

  /** A headline that does not stand on its own set to the frame's claim,
   *  else at least started with a capital. */
  withWholeHeadlines() {
    this.frames.forEach((beat, frame) => {
      if (beat.role === "cta" || headlineGrammar(beat.headline) === null)
        return;
      const claim = this.claimAs(frame, "headline");
      if (claim && headlineGrammar(claim) === null) {
        this.set(
          frame,
          { headline: claim },
          "fragment headline set to its claim",
        );
        return;
      }
      const capped = capitalised(beat.headline.trim());
      if (capped !== beat.headline) {
        this.set(
          frame,
          { headline: capped },
          "headline started with a capital",
        );
      }
    });
  }

  withWholeSubheadlines() {
    this.frames.forEach((beat, frame) => {
      if (subheadlineGrammar(beat.subheadline) === null) return;
      const claim = this.claimAs(frame, "subheadline");
      this.set(
        frame,
        { subheadline: claim ?? "" },
        claim
          ? "broken subheadline set to its claim"
          : "broken subheadline left out",
      );
    });
  }

  withSubheadlinesUnderBareHeadlines() {
    this.frames.forEach((beat, frame) => {
      if (beat.role !== "body" || beat.subheadline.trim()) return;
      const claim = this.claimAs(frame, "subheadline");
      if (claim) {
        this.set(frame, { subheadline: claim }, "subheadline set to its claim");
        return;
      }
      const halves = this.claimInHalves(frame);
      if (halves) {
        this.set(frame, halves, "bare headline given its claim in two lines");
      }
    });
  }

  /** A middle frame whose subheadline says its headline again given its
   *  claim under the headline, else its claim in two lines, else only
   *  the subheadline's sentences that say something more. */
  withoutRestatedSubheadlines() {
    this.frames.forEach((beat, frame) => {
      if (!restatesHeadline(beat)) return;
      const claim = this.claimAs(frame, "subheadline");
      if (claim && !restatesHeadline({ ...beat, subheadline: claim })) {
        this.set(
          frame,
          { subheadline: claim },
          "restated subheadline set to its claim",
        );
        return;
      }
      const halves = this.claimInHalves(frame);
      if (halves) {
        this.set(frame, halves, "restated subheadline: claim in two lines");
        return;
      }
      const sentences = beat.subheadline.split(SENTENCE_BREAK);
      const kept = sentences.filter(
        (s) => !restatesHeadline({ ...beat, subheadline: s }),
      );
      if (kept.length > 0 && kept.length < sentences.length) {
        this.set(
          frame,
          { subheadline: asSentence(kept.join(" ")) },
          "restating sentence cut from the subheadline",
        );
      }
    });
  }

  /** A frame that lost the owner's point given it back: in two lines,
   *  else under its headline, else as its headline (O5). */
  withOwnerPoints() {
    const owned = this.rules.owned ?? [];
    this.frames.forEach((beat, frame) => {
      const point = owned[frame]?.trim();
      if (!point || ownerPointKept(beat, point, this.free)) return;
      const halves = this.claimInHalves(frame);
      if (halves && ownerPointKept({ ...beat, ...halves }, point, this.free)) {
        this.set(frame, halves, "owner's point given back in two lines");
        return;
      }
      const sub = asSentence(point);
      if (
        fitsSubheadline(sub) &&
        !textsOverlap(sub, beat.headline, this.free)
      ) {
        this.set(
          frame,
          { subheadline: sub },
          "owner's point given back under the headline",
        );
        return;
      }
      const headline = this.claimAs(frame, "headline");
      if (headline) {
        this.set(
          frame,
          { headline },
          "owner's point given back as the headline",
        );
      }
    });
  }

  /** The hook's subheadline without its sentences that spend a later
   *  frame's point, while one of its own is left. */
  withoutHookPreviews() {
    const hook = this.frames[0];
    if (!hook) return;
    const later = previewedFrames(
      this.frames,
      this.rules.offering,
      this.rules.brandName,
    );
    if (later.length === 0) return;
    const theirs = new Set(
      later.flatMap((i) => [
        ...contentStems(
          `${this.frames[i].headline} ${this.frames[i].subheadline}`,
          this.free,
        ),
      ]),
    );
    const sentences = hook.subheadline.split(SENTENCE_BREAK);
    const kept = sentences.filter(
      (s) =>
        [...contentStems(s, this.free)].filter((w) => theirs.has(w)).length < 2,
    );
    if (kept.length === 0 || kept.length === sentences.length) return;
    this.set(
      0,
      { subheadline: asSentence(kept.join(" ")) },
      "hook sentence spending a later point cut",
    );
  }

  /** A carousel hook's subheadline without its sentences that give a
   *  price the action frame states: the reader meets the price beside
   *  how to pay it, never before the reason to want it. */
  withoutHookPrices() {
    const hook = this.frames[0];
    if (!hook?.subheadline || this.plan.kind !== "carousel") return;
    const prices = this.rules.facts.filter((f) => f.kind === "price");
    const priced = (text: string) =>
      prices.some((p) => textStatesPrice(p, text));
    if (!priced(hook.subheadline)) return;
    const kept = hook.subheadline
      .split(SENTENCE_BREAK)
      .filter((s) => !priced(s));
    const subheadline =
      kept.length > 0
        ? asSentence(kept.join(" "))
        : (this.namesLine({ ...hook, subheadline: "" }) ?? "");
    this.set(0, { subheadline }, "price cut from the hook's subheadline");
  }

  /** The hook's subheadline without its sentences that say the headline
   *  again; with none left, the names the hook must still give, else
   *  nothing: an empty second line reads better than an echo. */
  withoutHookEcho() {
    const hook = this.frames[0];
    const { brandName: brand, offering } = this.rules;
    if (!hook?.subheadline || !echoesHeadline(hook, brand, offering)) return;
    const kept = hook.subheadline
      .split(SENTENCE_BREAK)
      .filter(
        (s) => !echoesHeadline({ ...hook, subheadline: s }, brand, offering),
      );
    const subheadline =
      kept.length > 0
        ? asSentence(kept.join(" "))
        : (this.namesLine({ ...hook, subheadline: "" }) ?? "");
    if (subheadline === hook.subheadline) return;
    this.set(0, { subheadline }, "hook subheadline echoing its headline cut");
  }

  /** A sentence of the names the hook must give and `hook` leaves out
   *  ("Sourdough from Bread Lane."), or null when it gives them all. */
  namesLine(hook: FrameBeat): string | null {
    const { offering, names, brandName, facts } = this.rules;
    /* What the brief offers, read as a product fact, is the hook's to
       name whichever phrase the read took as the offering. */
    const unstated = factsUncovered([hook], facts)
      .filter((f) => f.kind === "product")
      .map((f) => f.text);
    const wanted = [offering, ...names, ...unstated].filter(
      (n, i, all): n is string =>
        Boolean(n?.trim()) &&
        all.indexOf(n) === i &&
        !copyNamesOffering(hook, n ?? ""),
    );
    if (wanted.length === 0) return null;
    const brand = brandName.trim();
    const sayBrand =
      brand &&
      !wanted.some((n) => n.toLowerCase().includes(brand.toLowerCase())) &&
      !copyNamesOffering(hook, brand);
    const [lead, ...rest] = wanted.map((n) => n.trim());
    return asSentence(
      [capitalised(lead), ...rest].join(" from ") +
        (sayBrand ? ` at ${brand}` : ""),
    );
  }

  /** The hook with every name it must give (the offering, and the brand
   *  when the brief makes it the subject) that no version gave, written
   *  as a sentence opening its subheadline. */
  withNamesOnHook() {
    const hook = this.frames[0];
    const named = hook ? this.namesLine(hook) : null;
    if (!hook || !named) return;
    const joined = hook.subheadline ? `${named} ${hook.subheadline}` : named;
    const subheadline =
      joined.length <= COPY_LIMITS.subheadline ? joined : named;
    if (subheadline.length > COPY_LIMITS.subheadline) return;
    this.frames = this.frames.map((b, i) =>
      i === 0 ? { ...b, subheadline } : b,
    );
    this.applied.push("frame 1: the hook's names written on it");
  }
}

/** The plan with every fault that must not ship settled (see the module
 *  comment), in an order where no step undoes an earlier one's work. */
export function shipGate(plan: PlannedSequence, rules: GateRules): GateResult {
  const gate = new Gate(plan, rules);
  gate.withoutUnsourced();
  gate.withoutHeadlinePrices();
  gate.withoutHookPrices();
  gate.withoutTwins();
  gate.withoutHookPreviews();
  gate.withoutHookEcho();
  gate.withWholeHeadlines();
  gate.withWholeSubheadlines();
  gate.withOwnerPoints();
  gate.withoutRestatedSubheadlines();
  gate.withSubheadlinesUnderBareHeadlines();
  gate.withNamesOnHook();
  gate.withoutUnsourced();
  return { plan: { ...plan, frames: gate.frames }, applied: gate.applied };
}

/** Every unsourced statement still on the set, by zero-based frame. */
export function unsourcedOnSet(
  frames: readonly FrameBeat[],
  rules: Pick<GateRules, "ledger" | "unsourced">,
): { frame: number; text: string }[] {
  return frames.flatMap((beat, frame) =>
    unsourcedOn(beat, frame, rules).map((text) => ({ frame, text })),
  );
}
