import { scanCss } from "./scan-css";
import { contextFor, type ScanPolicy } from "./scan-model";
import { scanTs } from "./scan-tsx";

export { splitVariants } from "./scan-classes";
export type { ScanPolicy } from "./scan-model";

/**
 * Static scan for the brand blue used where it cannot carry text.
 *
 * The rule is an allowlist, not a list of known mistakes. A colour belongs to
 * the brand family when it is the brand hue at a mid lightness (color.ts),
 * whether it is written as a token, a Tailwind name, a hex, an rgb() or a
 * gradient stop. Behind a label, a family colour is allowed only when it is
 * one of the fill tokens, and then the label is measured against it. As text,
 * a family colour is allowed only when it is one of the text tokens. A family
 * tint (under half alpha) is measured: every label colour over the tint over
 * every surface it can sit on. Anything that resolves is measured; anything
 * that does not is rejected rather than assumed.
 *
 * Source is read per JSX element (and everything inside it), per string
 * literal, and per CSS rule plus every rule nested under its selector. Class
 * pieces in different branches of the same conditional are never paired, so
 * `active ? "bg-primary-fill text-white" : "bg-tint text-primary-text"` is two
 * states, not one.
 */
export function scanPrimaryUsage(
  fileName: string,
  source: string,
  policy: ScanPolicy,
): string[] {
  const ctx = contextFor(policy, fileName);
  const problems = fileName.endsWith(".css")
    ? scanCss(ctx, fileName, source)
    : scanTs(ctx, fileName, source);
  return [...new Set(problems)];
}
