/**
 * Colour arithmetic for the theme gates: parse what a stylesheet or a Tailwind
 * class can write, composite translucent layers, and measure WCAG contrast.
 * Test infrastructure only; nothing in the app imports it.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

function channel(raw: string, max: number): number {
  const value = raw.trim();
  return value.endsWith("%")
    ? (Number.parseFloat(value) / 100) * max
    : Number.parseFloat(value);
}

/** A literal CSS colour, or null for anything that is not one (a var(), a
 * length, a url()). Tailwind arbitrary values write spaces as underscores. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().replace(/_/g, " ").toLowerCase();
  if (value in NAMED) return { ...NAMED[value] };
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((d) => d + d).join("");
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    const n = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
    return {
      r: n(0),
      g: n(2),
      b: n(4),
      a: digits.length === 8 ? n(6) / 255 : 1,
    };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value);
  if (fn) {
    const [rgb, alpha] = fn[1].split("/");
    const parts = rgb.split(/[\s,]+/).filter(Boolean);
    const a =
      alpha !== undefined
        ? channel(alpha, 1)
        : parts.length === 4
          ? channel(parts[3], 1)
          : 1;
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255));
    if ([r, g, b, a].some((x) => Number.isNaN(x))) return null;
    return { r, g, b, a };
  }
  const hslFn = /^hsla?\(([^)]*)\)$/.exec(value);
  if (hslFn) {
    const [hsl, alpha] = hslFn[1].split("/");
    const parts = hsl.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0]);
    const s = channel(parts[1], 1) / (parts[1].endsWith("%") ? 1 : 100);
    const l = channel(parts[2], 1) / (parts[2].endsWith("%") ? 1 : 100);
    const a =
      alpha !== undefined
        ? channel(alpha, 1)
        : parts.length === 4
          ? channel(parts[3], 1)
          : 1;
    if ([h, s, l, a].some((x) => Number.isNaN(x))) return null;
    return { ...fromHsl(h, s, l), a };
  }
  const oklch = /^oklch\(([^)]*)\)$/.exec(value);
  if (oklch) {
    const [lch, alpha] = oklch[1].split("/");
    const parts = lch.split(/\s+/).filter(Boolean);
    if (parts.length !== 3) return null;
    const L = channel(parts[0], 1);
    const C = Number.parseFloat(parts[1]);
    const H = (Number.parseFloat(parts[2]) * Math.PI) / 180;
    const a = alpha !== undefined ? channel(alpha, 1) : 1;
    if ([L, C, H, a].some((x) => Number.isNaN(x))) return null;
    return fromOklab([L, C * Math.cos(H), C * Math.sin(H)], a);
  }
  return null;
}

function fromHsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const chroma = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    255 * (l - chroma * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: color.a * alpha };
}

/** `top` laid over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: 1,
  };
}

export function toHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Rgba): number {
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  );
}

/** WCAG 2.x contrast of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(color: Rgba): { h: number; s: number; l: number } {
  const [r, g, b] = [color.r, color.g, color.b].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/* The brand blue and every shade of it a fill or a label could be built from.
   Lightness is bounded on both sides: below 0.2 the colour is a navy surface
   that white reads on easily, above 0.65 it is a pale tint that is too light
   to carry white at all and reads as a different colour. The hue band spans
   the brand (h 200) and the shades split from it (h 200-204) with room either
   side, and stops short of cyan (#06b6d4, h 189). */
const BRAND_HUE = [192, 215] as const;

export function isBrandFamily(color: Rgba): boolean {
  const { h, s, l } = hsl(color);
  return (
    h >= BRAND_HUE[0] && h <= BRAND_HUE[1] && s >= 0.4 && l >= 0.2 && l <= 0.65
  );
}

function toOklab(c: Rgba): [number, number, number] {
  const [r, g, b] = [c.r, c.g, c.b].map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number], a: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const gamma = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return {
    r: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

/** Points along every segment of a gradient, in sRGB (the CSS default) and in
 * oklab (Tailwind v4's default), so a midpoint darker or lighter than either
 * end is measured too. */
export function gradientSamples(stops: Rgba[], steps = 10): Rgba[] {
  if (stops.length < 2) return [...stops];
  const out: Rgba[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, b] = [stops[i], stops[i + 1]];
    const [la, lb] = [toOklab(a), toOklab(b)];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const lerp = (x: number, y: number) => x + (y - x) * t;
      out.push({
        r: lerp(a.r, b.r),
        g: lerp(a.g, b.g),
        b: lerp(a.b, b.b),
        a: lerp(a.a, b.a),
      });
      out.push(
        fromOklab(
          [lerp(la[0], lb[0]), lerp(la[1], lb[1]), lerp(la[2], lb[2])],
          lerp(a.a, b.a),
        ),
      );
    }
  }
  return out;
}
