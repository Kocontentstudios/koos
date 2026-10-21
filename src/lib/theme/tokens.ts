import { parseColor, type Rgba } from "./color";

/**
 * Reads custom properties out of a stylesheet the way the browser would for
 * <html>: a base block, a light-theme block layered on top, and var() chains
 * resolved against the merged set. Test infrastructure only.
 */

export type Tokens = Map<string, string>;
export interface Themes {
  dark: Tokens;
  light: Tokens;
}
export const THEME_NAMES = ["dark", "light"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

/** Custom properties declared directly in the one rule whose selector is
 * exactly `selector`. Throws rather than returning an empty map, so a renamed
 * selector fails loudly instead of measuring nothing. */
export function declarations(css: string, selector: string): Tokens {
  const source = stripCssComments(css);
  const opener = new RegExp(
    `(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
    "g",
  );
  const matches = [...source.matchAll(opener)];
  if (matches.length !== 1) {
    throw new Error(`expected one "${selector}" rule, found ${matches.length}`);
  }
  const bodyStart = (matches[0].index ?? 0) + matches[0][0].length;
  const body = source.slice(bodyStart, source.indexOf("}", bodyStart));
  if (body.includes("{")) {
    throw new Error(
      `"${selector}" has a nested rule; the parser cannot see it`,
    );
  }
  const tokens: Tokens = new Map();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }
  if (tokens.size === 0) throw new Error(`"${selector}" declares no tokens`);
  return tokens;
}

/** Both declarations sit on <html>, so a var() resolves against the merged
 * set: a light override of --surface-1 also changes --card: var(--surface-1). */
export function readThemes(css: string, base: string, light: string): Themes {
  const dark = declarations(css, base);
  return {
    dark,
    light: new Map([...dark, ...declarations(css, light)]),
  };
}

/** Layers extra declarations (Tailwind's @theme map, a scoped page's own
 * tokens) over both themes. */
export function extendThemes(themes: Themes, extra: Partial<Themes>): Themes {
  return {
    dark: new Map([...themes.dark, ...(extra.dark ?? [])]),
    light: new Map([...themes.light, ...(extra.light ?? [])]),
  };
}

export function resolveToken(
  tokens: Tokens,
  name: string,
  seen: string[] = [],
): string {
  if (seen.includes(name)) {
    throw new Error(`cycle: ${[...seen, name].join(" -> ")}`);
  }
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? resolveToken(tokens, alias[1], [...seen, name]) : value;
}

/** Every var() in a value replaced by what it resolves to, fallbacks used when
 * the token is missing; null when a token is missing with no fallback. */
export function resolveValue(tokens: Tokens, value: string): string | null {
  let out = value;
  for (let depth = 0; depth < 20; depth++) {
    const hit =
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/.exec(out);
    if (!hit) return out;
    const name = hit[1];
    const replacement = tokens.has(name)
      ? (tokens.get(name) as string)
      : hit[2]?.trim();
    if (replacement === undefined) return null;
    out =
      out.slice(0, hit.index) +
      replacement +
      out.slice(hit.index + hit[0].length);
  }
  return null;
}

export function colorIn(tokens: Tokens, value: string): Rgba | null {
  const resolved = resolveValue(tokens, value);
  return resolved === null ? null : parseColor(resolved);
}
