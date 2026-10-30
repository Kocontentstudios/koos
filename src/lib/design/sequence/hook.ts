import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";

/**
 * Hooks that give no reason to swipe, in the shapes the eval's judge marked
 * down every time: an announcement ("Cold brew is here", "Hand-dyed indigo
 * adire is here", "Cold Brew, Finally at Kiln"), the offering's name standing as the whole headline
 * ("Teen sourdough baking class"), and a subheadline that says the headline
 * again ("Invoice in naira or dollars in seconds" over "send an invoice in
 * naira or dollars in under a minute").
 *
 * A proxy, not a judgement of the hook: a headline can avoid all three and
 * still be flat, which the judge measures. What this catches it catches
 * for free, so the planner asks for a new hook before anything is drawn.
 * Not a contract rule: a flat hook is drawable.
 */

const ANNOUNCEMENT =
  /\b(?:is|are|'s)\s+(?:here|back|live|now available|available now)\b[.!]?\s*$|^\s*(?:introducing|meet|presenting|announcing|new|now)\b|\b(?:arrived|arrives|landed|lands|dropped)\b|\bjust\s+in\b|\bnew\s+(?:in|arrival|arrivals|stock)\b|\bnow\s+(?:available|open|in stock)\b|\b(?:out now|in stores?|back in stock)\b|\bfinally\b/i;

/* What a strong hook does instead, in the words that moved the judge in the
   blind read of both variants ("Still invoicing on paper?", "Steeped 18
   hours, poured cold", "Can your teen bake real sourdough?"). */
export const HOOK_CRAFT =
  "make the headline the reason to swipe (a question the customer is already asking, the brief's boldest specific, or a before-and-after) and put the name in the subheadline";

/* Content words a headline and its subheadline may share before the second
   line reads as the first said again; the brand's name is free. */
const ECHO_WORDS = 3;

function echoedWords(hook: FrameBeat, brandName: string): string[] {
  const free = contentStems(brandName);
  const headline = contentStems(hook.headline, free);
  return [...contentStems(hook.subheadline, free)].filter((s) =>
    headline.has(s),
  );
}

/* Content words the hook may share with a later frame before it reads as
   spending that frame's point before the swipe. Tighter than two body
   frames are held to (repeats.ts), as variant A's craft check found: eval
   round 2, "Straight from Abeokuta" on the hook and "directly from
   Abeokuta" on frame 2, "naira or dollars" on both of the SaaS set's first
   two frames, each marked down by the judge as one point made twice. */
const HOOK_PREVIEW_WORDS = 2;

/** Later frames whose point the hook already spends, by the content words
 *  they share beyond the brand's and the offering's names. */
export function hookPreviews(
  frames: readonly FrameBeat[],
  offering: string | null,
  brandName = "",
): string[] {
  const [hook, ...later] = frames;
  if (!hook) return [];
  const free = namesFree(brandName, offering);
  const hookWords = contentStems(`${hook.headline} ${hook.subheadline}`, free);
  const faults: string[] = [];
  later.forEach((beat, i) => {
    /* The later frame restating the hook's headline is that frame's
       headline-repeat (validateSequence), not the hook's fault. */
    if (isNearDuplicateHeadline(hook.headline, beat.headline, free)) return;
    const shared = [
      ...contentStems(`${beat.headline} ${beat.subheadline}`, free),
    ].filter((s) => hookWords.has(s));
    if (shared.length >= HOOK_PREVIEW_WORDS) {
      faults.push(
        `the hook already says what frame ${i + 2} ("${beat.headline}") is for; leave that point to it and give the hook its own reason to swipe`,
      );
    }
  });
  return faults;
}

/* An offering read as a name ("cold brew", "Ledgerly") may be said on any
   frame; one read as a description ("Send an invoice in naira or dollars
   in under a minute") is made of points, and a frame that says them again
   repeats them (round 2: "naira or dollars" on two SaaS frames went
   uncounted while the whole description was free). */
const NAME_STEMS = 3;

/** Stems any frame may say without repeating a point: the brand's name and
 *  the offering's, when the offering reads as a name. */
export function namesFree(
  brandName: string,
  offering: string | null,
): Set<string> {
  const offered = contentStems(offering ?? "");
  return new Set([
    ...contentStems(brandName),
    ...(offered.size <= NAME_STEMS ? offered : []),
  ]);
}

/** The names in `names` the hook leaves out, beyond the offering (which
 *  is validateSequence's offering-unnamed). */
export function unnamedOnHook(
  hook: FrameBeat,
  offering: string | null,
  names: readonly string[],
): string[] {
  return names.filter(
    (name) => name !== offering && !copyNamesOffering(hook, name),
  );
}

/** `names`: what else the hook must name beyond the offering (the brand,
 *  when the brief makes it the subject: hookNames in the prompt). The
 *  offering itself is validateSequence's offering-unnamed. */
export function hookFaults(
  hook: FrameBeat,
  offering: string | null,
  names: readonly string[] = [],
  brandName = "",
  facts: readonly BriefFact[] = [],
): string[] {
  const faults = unnamedOnHook(hook, offering, names).map(
    (name) =>
      `the hook does not name "${name}"; put it in the subheadline in these words`,
  );
  const named = contentStems(offering ?? "");
  /* The name and where to find it is still a label: round 3's cafe hook
     "Cold brew at our Yaba bar" scored 2, "purely locational
     housekeeping". */
  const labelWords = new Set([
    ...named,
    ...contentStems(brandName),
    ...facts
      .filter((f) => f.kind === "place")
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
  const said = contentStems(hook.headline);
  const nameAlone =
    named.size > 0 &&
    [...said].some((s) => named.has(s)) &&
    [...said].every((s) => labelWords.has(s));
  if (ANNOUNCEMENT.test(hook.headline)) {
    faults.push(
      `the hook's headline "${hook.headline}" announces the offering, which gives no reason to swipe; ${HOOK_CRAFT}`,
    );
  } else if (nameAlone) {
    faults.push(
      `the hook's headline "${hook.headline}" is only the name of what is offered; ${HOOK_CRAFT}`,
    );
  }
  /* Round 2's judge, on "Hand-dyed indigo adire — just arrived at Adire
     House" under a question: "a flat retail cliché that undercuts the
     intrigue". The second line spends the pull the first one made. */
  if (ANNOUNCEMENT.test(hook.subheadline)) {
    faults.push(
      `the hook's subheadline "${hook.subheadline}" announces the offering; name it with the one specific from the brief that makes the headline's pull concrete`,
    );
  }
  if (echoedWords(hook, brandName).length >= ECHO_WORDS) {
    faults.push(
      `the hook's subheadline "${hook.subheadline}" says what its headline says; the subheadline names the offering and adds what the headline does not`,
    );
  }
  return faults;
}
