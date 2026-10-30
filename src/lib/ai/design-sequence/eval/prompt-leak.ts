import {
  SEQUENCE_EVAL_CASES,
  SEQUENCE_HELD_OUT_CASES,
  type SequenceEvalCase,
} from "./cases";

/* Round-3 critic, finding 2: the prompt's example hooks were the eval's
   own fixtures, and the model copied them word for word, so the hook
   score measured recall of the prompt. No fixture phrase, tuning or held
   out, may reach the prompt file or any prompt it builds. */

/* Words a fixture shares with any brief of its kind; a prompt about
   carousels has to be able to say "class" or "coffee". Everything else a
   fixture names is distinctive. */
const GENERIC = new Set([
  "about",
  "baking",
  "class",
  "coffee",
  "deck",
  "design",
  "launch",
  "partner",
  "presentation",
  "round",
  "store",
  "with",
  "your",
  "fund",
  "offer",
  "laundry",
  "pickup",
  "teeth",
  "whitening",
  "restock",
  "sauce",
  "pepper",
  "house",
  "kitchen",
  "studio",
  "smile",
  "rooms",
  "lagos",
]);

/* Joining words a figure's match can run into ("4 to 8", "0142 to"),
   which name no unit. */
const NOT_A_UNIT = new Set(["to", "we", "for", "with", "and", "contact"]);

const normal = (text: string) =>
  text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** The phrases that would give a fixture away. */
export function fixturePhrases(c: SequenceEvalCase): string[] {
  const named = [c.offering, c.request.title, c.brand.name];
  const facts = c.facts.map((f) => f.text);
  /* A figure with its unit ("18 hours", "12 places") is what a hook
     lifted from a fixture repeats even when no label does. */
  const figures = [
    ...c.request.briefText.matchAll(/([₦$]?\d[\d,.]*)\s*([a-z-]+)/gi),
  ]
    .filter((m) => !NOT_A_UNIT.has(m[2].toLowerCase()))
    .map((m) => m[0]);
  const words = named
    .flatMap((n) => n.split(/[^\p{L}\p{N}&.]+/u))
    .filter((w) => w.length >= 5 && !GENERIC.has(w.toLowerCase()));
  return [
    ...new Set([...named, ...facts, ...figures, ...words].map(normal)),
  ].filter((p) => p.length >= 4);
}

const ALL_CASES = [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES];

export function fixtureLeaks(text: string): string[] {
  const haystack = normal(text);
  return ALL_CASES.flatMap((c) =>
    fixturePhrases(c)
      .filter((p) =>
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
          "u",
        ).test(haystack),
      )
      .map((p) => `${c.id}: "${p}"`),
  );
}
