import {
  type Box,
  boxFromDecls,
  type Context,
  checkGrounds,
  checkTextColors,
  declsOf,
  FADE_ON_FILL,
  fades,
  fadesFill,
  IMAGE_OF_TEXT,
  isFamily,
  LOADING_PAINT,
  maxAlpha,
  PAINT_DECL,
  type Paint,
  type PerTheme,
  SELECTOR_LOADING,
  SVG_TEXT_IN_DATA_URI,
} from "./scan-model";
import { stripCssComments, THEME_NAMES, type ThemeName } from "./tokens";

export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The compounds of a selector, in order: `.a > .b:hover span` gives
 * [".a", ".b:hover", "span"]. */
export function compounds(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (current) out.push(current);
      current = "";
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

export const simpleSelectors = (compound: string): string[] =>
  compound
    .replace(/::?[\w-]+(?:\([^)]*\))?/g, "")
    .match(/[.#][\w-]+|^[a-z][\w-]*|\[[^\]]*\]/gi) ?? [];

/** The selector without its theme prefix, so a light override and the rule
 * it overrides compare equal. */
export const baseSelector = (selector: string) =>
  selector.replace(/:root\[data-theme=["']?\w+["']?\]\s*/g, "").trim();

export const PSEUDO_ELEMENT =
  /::?(?:before|after|placeholder|selection|marker|backdrop|file-selector-button)\b/;

export const pseudoClasses = (compound: string): string[] =>
  (compound.match(/:(?!:)(?!is\(|where\(|not\(|root)[\w-]+/g) ?? []).sort();

/** Whether elements matched by `inner` are, or sit inside, elements matched by
 * `outer`: every compound of `outer` appears in `inner`, in order. A rule on a
 * pseudo-element paints that pseudo-element's own box, so nothing sits in it. */
export function relation(
  inner: string,
  outer: string,
): "self" | "inside" | null {
  const want = compounds(baseSelector(outer));
  const have = compounds(baseSelector(inner));
  if (want.length === 0) return null;
  if (PSEUDO_ELEMENT.test(want.at(-1) ?? "")) return null;
  let i = 0;
  let lastAt = -1;
  for (let j = 0; j < have.length && i < want.length; j++) {
    const need = simpleSelectors(want[i]);
    const got = simpleSelectors(have[j]);
    if (need.length > 0 && need.every((n) => got.includes(n))) {
      i++;
      lastAt = j;
    }
  }
  if (i < want.length) return null;
  return lastAt === have.length - 1 ? "self" : "inside";
}

export function themesOfSelector(selector: string): readonly ThemeName[] {
  if (/\[data-theme=["']?light/.test(selector)) return ["light"];
  if (/\[data-theme=["']?dark|(?:^|\s)\.dark\b/.test(selector)) {
    return ["dark"];
  }
  return THEME_NAMES;
}

/** Class names whose rule fades the element (opacity, a filter, a blend
 * mode). Markup that puts one on a labelled fill, or on anything wrapping one,
 * fades the fill as surely as `opacity-60` would. */
export function fadingClassesIn(source: string): Set<string> {
  const found = new Set<string>();
  const css = stripCssComments(source);
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prelude = match[1].trim();
    if (
      !prelude ||
      prelude.startsWith("@") ||
      /^\d|^(?:from|to)$/.test(prelude)
    )
      continue;
    if (!fades(declsOf(match[2]))) continue;
    for (const selector of splitTopLevel(prelude, ",")) {
      const subject = compounds(selector).at(-1) ?? "";
      for (const [, name] of subject.matchAll(/\.((?:\\.|[\w-])+)/g)) {
        found.add(name.replace(/\\(.)/g, "$1"));
      }
    }
  }
  return found;
}

export interface CssRule {
  selector: string;
  at: number;
  themes: readonly ThemeName[];
  box: Box;
}

export function scanCss(
  ctx: Context,
  fileName: string,
  source: string,
): string[] {
  const problems: string[] = [];
  const css = stripCssComments(source);
  const lineOf = (pos: number) => css.slice(0, pos).split("\n").length;

  css.split("\n").forEach((line, i) => {
    const hit = ctx.policy.retiredTokens.exec(line);
    if (hit) problems.push(`${fileName}:${i + 1} retired token ${hit[0]}`);
    for (const value of ctx.policy.retiredValues) {
      if (new RegExp(`${value}(?![0-9a-f])`, "i").test(line)) {
        problems.push(`${fileName}:${i + 1} retired brand value ${value}`);
      }
    }
  });

  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prelude = match[1].trim();
    if (
      !prelude ||
      prelude.startsWith("@") ||
      /^\d|^(?:from|to)$/.test(prelude)
    )
      continue;
    const at = (match.index ?? 0) + match[0].indexOf("{");
    if (fadesFill(declsOf(match[2]))) {
      problems.push(`${fileName}:${lineOf(at)} ${FADE_ON_FILL}`);
    }
    if (
      SELECTOR_LOADING.test(prelude) &&
      declsOf(match[2]).some(([prop]) => PAINT_DECL.test(prop))
    ) {
      problems.push(`${fileName}:${lineOf(at)} ${LOADING_PAINT}`);
    }
    if (SVG_TEXT_IN_DATA_URI.test(match[2])) {
      problems.push(`${fileName}:${lineOf(at)} ${IMAGE_OF_TEXT}`);
    }
    for (const selector of splitTopLevel(prelude, ",")) {
      const themes = themesOfSelector(selector);
      rules.push({
        selector,
        at,
        themes,
        box: boxFromDecls(ctx, declsOf(match[2]), themes),
      });
    }
  }

  const reportAt = (at: number, why: string) =>
    problems.push(`${fileName}:${lineOf(at)} ${why}`);

  /* A light-theme rule overrides the unprefixed rule with the same selector
     in light mode: the base rule's colour and ground then apply in dark only,
     and a gradient keeps the text clip the base rule set. */
  const sameTarget = (a: CssRule, b: CssRule) =>
    relation(a.selector, b.selector) === "self" &&
    pseudoClasses(a.selector).join() === pseudoClasses(b.selector).join();
  const overridden = (rule: CssRule, part: "texts" | "grounds") =>
    rule.themes.length > 1 &&
    rules.some(
      (r) =>
        r !== rule &&
        r.themes.length === 1 &&
        sameTarget(r, rule) &&
        (part === "texts"
          ? r.box.texts.length > 0
          : r.box.grounds.length > 0 || r.box.stops.length > 0),
    );
  for (const rule of rules) {
    rule.box.clipText ||= rules.some(
      (r) => r.box.clipText && sameTarget(rule, r),
    );
  }

  for (const rule of rules) {
    const svgText = /(?:^|[\s>+~])(?:text|tspan|textPath)\b/.test(
      rule.selector,
    );
    for (const why of checkTextColors(ctx, rule.box, svgText)) {
      reportAt(rule.at, why);
    }
  }

  for (const ground of rules) {
    const hasFamily =
      ground.box.grounds.some(isFamily) || ground.box.stops.some(isFamily);
    if (!hasFamily || ground.box.clipText) continue;
    const groundThemes = overridden(ground, "grounds")
      ? ground.themes.filter((t) => t === "dark")
      : ground.themes;
    for (const text of rules) {
      const labelled =
        text.box.texts.length > 0 ||
        (text.box.content && PSEUDO_ELEMENT.test(text.selector));
      if (!labelled) continue;
      const rel =
        text === ground ? "self" : relation(text.selector, ground.selector);
      if (!rel) continue;
      /* On the same element, a ground rule for a state (:hover) that sets its
         own colour wins over the resting colour in that state. */
      if (
        text !== ground &&
        rel === "self" &&
        ground.box.texts.length > 0 &&
        pseudoClasses(ground.selector).some(
          (c) => !pseudoClasses(text.selector).includes(c),
        )
      ) {
        continue;
      }
      const textThemes = overridden(text, "texts")
        ? text.themes.filter((t) => t === "dark")
        : text.themes;
      const themes = groundThemes.filter((t) => textThemes.includes(t));
      if (themes.length === 0) continue;
      const ownGround = text === ground ? undefined : text.box.grounds[0];
      if (ownGround && maxAlpha(ownGround) >= 1) continue;
      const overlay: PerTheme = {};
      for (const t of themes) overlay[t] = ownGround?.colors[t] ?? null;
      const restrict = (p: Paint): Paint => ({
        ...p,
        colors: Object.fromEntries(
          themes.map((t) => [t, p.colors[t] ?? null]),
        ) as PerTheme,
      });
      const box: Box = {
        ...ground.box,
        grounds: ground.box.grounds.map(restrict),
        stops: ground.box.stops.map(restrict),
      };
      const where =
        text === ground ? "" : ` (${text.selector} on ${ground.selector})`;
      for (const why of checkGrounds(
        ctx,
        box,
        true,
        text.box.texts.map(restrict),
        ownGround ? overlay : undefined,
      )) {
        reportAt(text.at, `${why}${where}`);
      }
    }
  }
  return problems;
}
