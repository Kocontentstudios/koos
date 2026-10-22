import type ts from "typescript";
import {
  contrast,
  gradientSamples,
  isBrandFamily,
  over,
  type Rgba,
  withAlpha,
} from "./color";
import { colorIn, THEME_NAMES, type ThemeName, type Themes } from "./tokens";

/* The vocabulary of the primary-usage scan: what a paint and a box are, how a
   colour is classed (brand family, fill, tint, listed token), and the checks
   every reader (class lists, CSS, inline styles) feeds into. */

export interface ScanPolicy {
  themes: Themes;
  /** A stylesheet that layers its own tokens over the app's (landing.css). */
  themesFor?: (fileName: string) => Themes | undefined;
  fillTokens: readonly string[];
  textTokens: readonly string[];
  /** Every surface a tint can be laid on, per theme. */
  grounds: Record<ThemeName, Rgba[]>;
  retiredTokens: RegExp;
  retiredValues: readonly string[];
}

export const TEXT_AA = 4.5;
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
/* At or above this alpha a family colour is a fill, below it a tint. */
export const FILL_ALPHA = 0.5;

export type PerTheme = Partial<Record<ThemeName, Rgba | null>>;

export interface Paint {
  source: string;
  literal: boolean;
  colors: PerTheme;
  cond: ts.Node | null;
  /** Tailwind state variants (hover, disabled, group-hover, ...). */
  variants: string[];
}

export interface Box {
  grounds: Paint[];
  stops: Paint[];
  texts: Paint[];
  fills: Paint[];
  clipText: boolean;
  content: boolean;
}

/** A gradient stop whose colour the scan cannot know (a Tailwind palette
 * name, a token from elsewhere). Beside a brand stop it fails closed. */
export const unmeasured = (
  source: string,
  cond: ts.Node | null,
  variants: string[],
): Paint => ({
  source,
  literal: false,
  colors: { dark: null, light: null },
  cond,
  variants,
});

export const emptyBox = (): Box => ({
  grounds: [],
  stops: [],
  texts: [],
  fills: [],
  clipText: false,
  content: false,
});

/* Pseudo-elements paint their own box. Each still carries text when it has
   any: a selection highlights text, a file button and a placeholder are text,
   and before/after are text once they have content. */
export const PSEUDO =
  /^(?:before|after|placeholder|file|selection|marker|backdrop|first-letter|first-line)$/;
export const ALWAYS_LABELLED = new Set(["selection", "file", "placeholder"]);

export interface Context {
  themes: Themes;
  policy: ScanPolicy;
  fillColors: Record<ThemeName, Rgba[]>;
  textColors: Record<ThemeName, Rgba[]>;
}

export const fmt = (n: number) => n.toFixed(2);
export const sameRgb = (a: Rgba, b: Rgba) =>
  Math.round(a.r) === Math.round(b.r) &&
  Math.round(a.g) === Math.round(b.g) &&
  Math.round(a.b) === Math.round(b.b);

export function paintFrom(
  ctx: Context,
  value: string,
  alpha: number,
  source: string,
  cond: ts.Node | null,
  only?: readonly ThemeName[],
  variants: string[] = [],
): Paint | null {
  const colors: PerTheme = {};
  let any = false;
  for (const theme of only ?? THEME_NAMES) {
    const c = colorIn(ctx.themes[theme], value);
    colors[theme] = c ? withAlpha(c, alpha) : null;
    if (c) any = true;
  }
  if (!any && !value.includes("var(")) return null;
  return { source, literal: !value.includes("var("), colors, cond, variants };
}

export const themesOf = (p: Paint) =>
  (Object.keys(p.colors) as ThemeName[]).filter((t) => p.colors[t]);

export function isFamily(p: Paint): boolean {
  return themesOf(p).some((t) =>
    isBrandFamily({ ...(p.colors[t] as Rgba), a: 1 }),
  );
}

export function maxAlpha(p: Paint): number {
  return Math.max(...themesOf(p).map((t) => (p.colors[t] as Rgba).a), 0);
}

/** Whether a paint is one of the listed tokens in every theme it applies to.
 * A literal counts when it equals the token's value in each of those themes
 * (global-error.tsx cannot load a stylesheet); once the token moves, the
 * literal no longer matches and fails. */
export function isListed(p: Paint, listed: Record<ThemeName, Rgba[]>): boolean {
  const themes = Object.keys(p.colors) as ThemeName[];
  return themes.every((t) => {
    const c = p.colors[t];
    return c && c.a === 1 && listed[t].some((l) => sameRgb(l, c));
  });
}

export const COLOR_IN_VALUE =
  /var\(\s*--[\w-]+\s*(?:,[^()]*(?:\([^()]*\))?[^()]*)?\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi;

export function declsOf(body: string): [string, string][] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return [
        d.slice(0, i).trim().toLowerCase(),
        d
          .slice(i + 1)
          .replace(/!important/, "")
          .trim(),
      ] as [string, string];
    })
    .filter(([prop]) => prop.length > 0);
}

export function boxFromDecls(
  ctx: Context,
  decls: [string, string][],
  only?: readonly ThemeName[],
): Box {
  const box = emptyBox();
  for (const [prop, value] of decls) {
    const colors = () =>
      [...value.matchAll(COLOR_IN_VALUE)]
        .map((m) => paintFrom(ctx, m[0], 1, `${prop}: ${value}`, null, only))
        .filter((p): p is Paint => p !== null);
    if (/^background(?:-color|-image)?$/.test(prop)) {
      if (/gradient\(/.test(value)) box.stops.push(...colors());
      else box.grounds.push(...colors().slice(0, 1));
    } else if (prop === "color" || prop === "-webkit-text-fill-color") {
      if (!/^(?:transparent|inherit|currentcolor)$/i.test(value)) {
        box.texts.push(...colors().slice(0, 1));
      }
    } else if (prop === "fill") {
      box.fills.push(...colors().slice(0, 1));
    } else if (/^(?:-webkit-)?background-clip$/.test(prop)) {
      if (value === "text") box.clipText = true;
    } else if (prop === "content") {
      box.content = !/^(?:none|normal|""|'')$/.test(value);
    }
  }
  return box;
}

export const coOccur = (a: Paint, b: Paint) =>
  a.cond === null || b.cond === null || a.cond === b.cond;

/** Whether text `t` is drawn on ground `g` in some state. In the state where
 * both apply, the utility with the most specific variants wins, as Tailwind's
 * variant order makes it: `disabled:text-x` sits on `disabled:bg-y`, never on
 * the resting fill it overrides. A tie goes to the paint styled for the same
 * state as the other side. */
export function inEffect(t: Paint, g: Paint, texts: Paint[], grounds: Paint[]) {
  if (!coOccur(t, g)) return false;
  const state = new Set([...t.variants, ...g.variants]);
  const winners = (list: Paint[], other: Paint) => {
    const live = list.filter((p) => p.variants.every((v) => state.has(v)));
    const top = Math.max(...live.map((p) => p.variants.length));
    const best = live.filter((p) => p.variants.length === top);
    const matched = best.filter((p) =>
      p.variants.some((v) => other.variants.includes(v)),
    );
    return matched.length > 0 ? matched : best;
  };
  return (
    winners(
      grounds.filter((x) => coOccur(x, t)),
      t,
    ).includes(g) &&
    winners(
      texts.filter((x) => coOccur(x, g)),
      g,
    ).includes(t)
  );
}

/** The brand blue as a text colour: only the text tokens may be. */
export function checkTextColors(
  ctx: Context,
  box: Box,
  svgText: boolean,
): string[] {
  const asText = [
    ...box.texts,
    ...(svgText ? box.fills : []),
    ...(box.clipText ? box.stops : []),
  ];
  const problems: string[] = [];
  for (const p of asText) {
    if (!isFamily(p)) continue;
    if (isListed(p, ctx.textColors)) continue;
    problems.push(
      p.literal
        ? `brand blue written as a literal text colour (${p.source}); use text-primary-text`
        : `${p.source} paints brand blue as text; only ${ctx.policy.textTokens.join(", ")} may`,
    );
  }
  return problems;
}

export function worstOver(
  ctx: Context,
  text: Paint,
  ground: Paint,
  theme: ThemeName,
  overlay?: Rgba,
): number | null {
  const fg = text.colors[theme];
  const bg = ground.colors[theme];
  if (!fg || !bg) return null;
  const bases = bg.a < 1 ? ctx.policy.grounds[theme] : [WHITE];
  let worst = Number.POSITIVE_INFINITY;
  for (const base of bases) {
    let under = bg.a < 1 ? over(bg, base) : bg;
    if (overlay) under = over(overlay, under);
    const shown = fg.a < 1 ? over(fg, under) : fg;
    worst = Math.min(worst, contrast(shown, under));
  }
  return worst;
}

export function checkGrounds(
  ctx: Context,
  box: Box,
  labelled: boolean,
  texts: Paint[],
  overlay?: PerTheme,
): string[] {
  if (!labelled) return [];
  const problems: string[] = [];
  const familyGrounds = box.grounds.filter(isFamily);
  for (const g of familyGrounds) {
    const tint = maxAlpha(g) < FILL_ALPHA;
    if (!tint && !isListed(g, ctx.fillColors)) {
      problems.push(
        g.literal
          ? `label on an inline brand-blue fill (${g.source}); use bg-primary-fill`
          : `label on ${g.source}; only ${ctx.policy.fillTokens.join(", ")} may carry one`,
      );
      continue;
    }
    for (const t of texts.filter((t) => inEffect(t, g, texts, box.grounds))) {
      for (const theme of themesOf(g)) {
        const r = worstOver(ctx, t, g, theme, overlay?.[theme] ?? undefined);
        if (r !== null && r < TEXT_AA) {
          problems.push(
            `${t.source} on ${g.source} is ${fmt(r)}:1 in ${theme}, under ${TEXT_AA}:1`,
          );
        }
      }
    }
  }
  problems.push(...checkGradient(ctx, box, texts, overlay));
  return problems;
}

export function checkGradient(
  ctx: Context,
  box: Box,
  texts: Paint[],
  overlay?: PerTheme,
): string[] {
  if (box.clipText) return [];
  const familyStops = box.stops.filter(isFamily);
  if (familyStops.length === 0) return [];
  const problems: string[] = [];
  const fills = familyStops.filter((s) => maxAlpha(s) >= FILL_ALPHA);
  if (fills.length === 0) {
    for (const s of familyStops) {
      for (const t of texts) {
        for (const theme of themesOf(s)) {
          const r = worstOver(ctx, t, s, theme);
          if (r !== null && r < TEXT_AA) {
            problems.push(
              `${t.source} on the ${s.source} tint is ${fmt(r)}:1 in ${theme}`,
            );
          }
        }
      }
    }
    return problems;
  }
  for (const s of fills) {
    if (!isListed(s, ctx.fillColors)) {
      problems.push(
        `gradient stop ${s.source} under a label; only ${ctx.policy.fillTokens.join(", ")} may carry one`,
      );
    }
  }
  const labelColors = texts.length > 0 ? texts : null;
  for (const theme of THEME_NAMES) {
    const stops = box.stops.map((s) => s.colors[theme]);
    if (stops.every((s) => s === undefined)) continue;
    if (stops.some((s) => !s)) {
      problems.push(
        `gradient beside a brand stop has a stop that cannot be measured in ${theme} (${box.stops.map((s) => s.source).join(", ")})`,
      );
      continue;
    }
    let samples = gradientSamples(stops as Rgba[]).map((c) =>
      c.a < 1 ? over(c, ctx.policy.grounds[theme][0]) : c,
    );
    const lay = overlay?.[theme];
    if (lay) samples = samples.map((c) => over(lay, c));
    const fgs = labelColors
      ? labelColors.map((t) => t.colors[theme]).filter((c): c is Rgba => !!c)
      : [WHITE];
    for (const fg of fgs) {
      const worst = Math.min(...samples.map((c) => contrast(fg, c)));
      if (worst < TEXT_AA) {
        problems.push(
          `label on gradient ${box.stops.map((s) => s.source).join(" -> ")} falls to ${fmt(worst)}:1 in ${theme}`,
        );
      }
    }
  }
  return problems;
}

export function contextFor(policy: ScanPolicy, fileName: string): Context {
  const themes = policy.themesFor?.(fileName) ?? policy.themes;
  const listed = (names: readonly string[]) =>
    Object.fromEntries(
      THEME_NAMES.map((t) => [
        t,
        names
          .map((n) => colorIn(themes[t], `var(${n})`))
          .filter((c): c is Rgba => c !== null),
      ]),
    ) as Record<ThemeName, Rgba[]>;
  return {
    themes,
    policy,
    fillColors: listed(policy.fillTokens),
    textColors: listed(policy.textTokens),
  };
}

/* Opacity or a filter on a labelled fill, or on anything wrapping one, repaints
   the fill lighter under its label: `hover:opacity-90` on the link around the
   auth KO mark put white at 4.26:1. The fill tokens are measured only as
   written, so a fade over one is rejected rather than measured. */
export const FILL_IN_CLASSES =
  /(?:^|[\s:!])(?:bg|from|via|to)-primary-fill\b|var\(--primary-fill/;
export const FADE_IN_CLASSES =
  /(?:^|[\s:!])(?:opacity-(?!(?:0|100)(?:\s|$))[\w.[]|brightness-|contrast-|saturate-|mix-blend-(?!normal\b)|\[(?:opacity|filter|mix-blend-mode):)/;
export const FADE_ON_FILL =
  "opacity or a filter over a labelled --primary-fill: change the fill token (--primary-fill-hover) instead";

export function fadesFill(decls: [string, string][]): boolean {
  const paintsFill = decls.some(
    ([prop, value]) =>
      prop.startsWith("background") && /var\(--primary-fill/.test(value),
  );
  if (!paintsFill) return false;
  return decls.some(([prop, value]) => {
    if (prop === "opacity") {
      const n = value.endsWith("%")
        ? Number.parseFloat(value) / 100
        : Number(value);
      return n > 0 && n < 1;
    }
    if (prop === "filter") return value !== "none";
    if (prop === "mix-blend-mode") return value !== "normal";
    return false;
  });
}
