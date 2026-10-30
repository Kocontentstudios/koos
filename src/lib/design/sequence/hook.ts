import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";

/**
 * Hooks that give no reason to swipe, in the two shapes the eval's judge
 * marked down every time (rounds 1 to 3: "Cold brew is here", "Hand-dyed
 * indigo adire is here", "Teen sourdough baking class" alone): an
 * announcement, and the offering's name standing as the whole headline.
 *
 * A proxy, not a judgement of the hook: a headline can avoid both and
 * still be flat, which the judge measures. What this catches it catches
 * for free, so the repair pass can ask for it before anything is drawn.
 * Not a contract rule: a flat hook is drawable.
 */

const ANNOUNCEMENT =
  /\b(?:is|are|'s)\s+(?:here|back|live|now available|available now)\b[.!]?\s*$|^\s*(?:introducing|meet|presenting|announcing)\b|\b(?:has|have|'s|'ve|just)\s+(?:arrived|landed|dropped)\b|\bjust\s+in\b|\bnew\s+(?:in|arrival|arrivals|stock)\b|\bnow\s+(?:available|open|in stock)\b/i;

/** `names`: what else the hook must name beyond the offering (the brand,
 *  when the brief makes it the subject: hookNames in the prompt). The
 *  offering itself is validateSequence's offering-unnamed. */
export function hookFaults(
  hook: FrameBeat,
  offering: string | null,
  names: readonly string[] = [],
): string[] {
  const faults: string[] = [];
  for (const name of names) {
    if (name !== offering && !copyNamesOffering(hook, name)) {
      faults.push(`the hook does not name "${name}"`);
    }
  }
  if (ANNOUNCEMENT.test(hook.headline)) {
    faults.push(
      `the hook's headline "${hook.headline}" announces the offering instead of giving a reason to swipe`,
    );
  }
  const named = contentStems(offering ?? "");
  const said = contentStems(hook.headline);
  const nameAlone =
    named.size > 0 && said.size > 0 && [...said].every((s) => named.has(s));
  if (nameAlone) {
    faults.push(
      `the hook's headline "${hook.headline}" is only the offering's name; it gives no reason to swipe`,
    );
  }
  return faults;
}
