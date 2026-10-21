import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/palette";
import { normalizeHex } from "@/lib/validation/hex";

/**
 * The colour tokens are the contract (UI Spec §9.2, §12), so their contrast is
 * measured here from the stylesheet itself rather than trusted to a review.
 *
 * Before this gate a cold critic measured every Button focus ring at 1.15:1
 * (light) and 1.20:1 (dark), and --text-muted at 3.40:1 on a light dialog and
 * 4.35:1 on a dark popover. Each number came from a token, so each regression
 * is caught here, in milliseconds, without a browser.
 *
 * Grounds are discovered by name, not listed, so a surface token added later is
 * measured the day it appears. Translucent tints are composited over each of
 * them before they are measured, the same way.
 */

const APP = path.join(process.cwd(), "src", "app");
const SRC = path.join(process.cwd(), "src");

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3;

type Tokens = Map<string, string>;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Custom properties declared directly in the one rule whose selector is
 * exactly `selector`. Throws rather than returning an empty map, so a renamed
 * selector fails loudly instead of measuring nothing. */
function declarations(css: string, selector: string): Tokens {
  const source = stripComments(css);
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
function theme(css: string, base: string, light: string) {
  const dark = declarations(css, base);
  return {
    dark,
    light: new Map([...dark, ...declarations(css, light)]) as Tokens,
  };
}

function resolve(tokens: Tokens, name: string, seen: string[] = []): string {
  if (seen.includes(name)) {
    throw new Error(`cycle: ${[...seen, name].join(" -> ")}`);
  }
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? resolve(tokens, alias[1], [...seen, name]) : value;
}

/** A solid hex or a thrown error. palette.contrastRatio silently maps anything
 * it cannot parse to near-black, which would pass every check on a light
 * ground; a translucent token has to be composited before it can be measured. */
function solid(tokens: Tokens, name: string): string {
  const value = resolve(tokens, name);
  const hex = value.startsWith("#") ? normalizeHex(value) : null;
  if (!hex) {
    throw new Error(`${name} resolves to "${value}", not a solid hex colour`);
  }
  return hex;
}

function ratio(tokens: Tokens, fg: string, bg: string): number {
  return Number(contrastRatio(solid(tokens, fg), solid(tokens, bg)).toFixed(2));
}

const RGBA =
  /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0?\.\d+|0|1)\s*\)$/;

function rgba(value: string): [number, number, number, number] | null {
  const match = RGBA.exec(value);
  return match ? [+match[1], +match[2], +match[3], +match[4]] : null;
}

/* Font tokens alias next/font variables declared outside globals.css, so only
   names that resolve here can be colours at all. */
function translucent(tokens: Tokens): string[] {
  return [...tokens.keys()]
    .filter((name) => {
      try {
        return rgba(resolve(tokens, name)) !== null;
      } catch {
        return false;
      }
    })
    .sort();
}

/** The solid colour a translucent token paints over `ground`, rounded per
 *  channel as the browser's 8-bit compositor rounds it. A solid token paints
 *  itself, so a tint that a theme makes solid is measured as it is. */
function paint(tokens: Tokens, tint: string, ground: string): string {
  const overlay = rgba(resolve(tokens, tint));
  if (!overlay) return solid(tokens, tint);
  const base = solid(tokens, ground);
  const [r, g, b, a] = overlay;
  const mixed = [r, g, b].map((channel, i) => {
    const under = Number.parseInt(base.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(channel * a + under * (1 - a))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${mixed.join("")}`.toUpperCase();
}

function ratioOver(
  tokens: Tokens,
  fg: string,
  tint: string,
  ground: string,
): number {
  return Number(
    contrastRatio(solid(tokens, fg), paint(tokens, tint, ground)).toFixed(2),
  );
}

const globals = readFileSync(path.join(APP, "globals.css"), "utf8");
const APP_THEMES = theme(globals, ":root", ':root[data-theme="light"]');

/** Every token a block of text or a control can be painted onto. --accent is
 * the highlighted-menu-item fill, so text sits on it too. */
const GROUND = /^--(background|surface(-[\w-]+)?|card|popover|muted|accent)$/;
const TEXT_TOKENS = ["--foreground", "--text-secondary", "--text-muted"];

function grounds(tokens: Tokens): string[] {
  return [...tokens.keys()].filter((name) => GROUND.test(name)).sort();
}

/* Every translucent token is sorted into exactly one of these, so an rgba
   token added later fails the classification test until someone decides
   whether text can sit on it. */
const NEVER_UNDER_TEXT =
  /^--(border(-[\w-]+)?|divider|input|outline(-variant)?|nav-border|sidebar-border|backdrop|skeleton)$/;
/** The sidebar is navy in both themes and only ever carries --nav-text. */
const SIDEBAR_TINT = /^--nav-(hover|card)$/;
/** Fills that text sits on: hovered and drag-active cards, selected rows,
 *  status pills. Measured over every ground, since each can be either. */
const TEXT_TINT = /^--(hover|accent-glow|status-[\w]+-bg)$/;

function textTints(tokens: Tokens): string[] {
  return translucent(tokens).filter((name) => TEXT_TINT.test(name));
}

/** Each --status-X-fg with its own --status-X-bg. */
function statusPairs(tokens: Tokens): [string, string][] {
  return [...tokens.keys()]
    .flatMap((name) => {
      const match = /^--status-([\w]+)-fg$/.exec(name);
      return match
        ? [[name, `--status-${match[1]}-bg`] as [string, string]]
        : [];
    })
    .sort();
}

/** Every ground where `fg` on `tint` falls short, as readable lines. */
function shortfalls(tokens: Tokens, fg: string, tint: string): string[] {
  return grounds(tokens).flatMap((ground) => {
    const measured = ratioOver(tokens, fg, tint, ground);
    return measured < TEXT_AA
      ? [`${fg} on ${tint} over ${ground} = ${measured}:1`]
      : [];
  });
}

describe("contrastRatio (WCAG 2.x relative luminance)", () => {
  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#ffffff", 1],
    // WebAIM's reference: the lightest grey that still looks fine and fails AA.
    ["#777777", "#ffffff", 4.48],
    ["#767676", "#ffffff", 4.54],
    // The open brand item named in UI Spec §12.1: white on the primary fill.
    ["#ffffff", "#138bc8", 3.78],
  ])("%s on %s is %d:1", (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#58687b", "#e2e8f0")).toBe(
      contrastRatio("#e2e8f0", "#58687b"),
    );
  });
});

describe("the token parser", () => {
  it("finds the surfaces a UI is built on, in both themes", () => {
    for (const tokens of [APP_THEMES.dark, APP_THEMES.light]) {
      expect(grounds(tokens)).toEqual(
        expect.arrayContaining([
          "--background",
          "--surface-1",
          "--surface-2",
          "--card",
          "--popover",
          "--muted",
        ]),
      );
    }
  });

  it("applies light overrides through aliases", () => {
    expect(solid(APP_THEMES.dark, "--popover")).toBe("#001F3D");
    expect(solid(APP_THEMES.light, "--popover")).toBe("#FFFFFF");
  });

  it("refuses a translucent token instead of guessing", () => {
    expect(() => solid(APP_THEMES.dark, "--accent-glow")).toThrow(
      /not a solid/,
    );
  });

  it("composites a tint over a ground the way the browser does", () => {
    /* 15% #138bc8 over white: 255 - 0.15 * (255 - c), rounded per channel. */
    expect(paint(APP_THEMES.light, "--status-progress-bg", "--surface-2")).toBe(
      "#DCEEF7",
    );
    /* 6% white over #001f3d. */
    expect(paint(APP_THEMES.dark, "--hover", "--surface-2")).toBe("#0F2C49");
  });

  it("finds the tints text sits on, in both themes", () => {
    for (const tokens of [APP_THEMES.dark, APP_THEMES.light]) {
      expect(textTints(tokens)).toEqual(
        expect.arrayContaining([
          "--hover",
          "--accent-glow",
          "--status-progress-bg",
          "--status-error-bg",
        ]),
      );
      expect(statusPairs(tokens)).toHaveLength(5);
    }
  });
});

describe.each([
  ["dark", APP_THEMES.dark],
  ["light", APP_THEMES.light],
] as const)("globals.css translucent tints, %s theme", (_name, tokens) => {
  it("sorts every translucent token into exactly one role", () => {
    const unclassified = translucent(tokens).filter(
      (name) =>
        [NEVER_UNDER_TEXT, SIDEBAR_TINT, TEXT_TINT].filter((role) =>
          role.test(name),
        ).length !== 1,
    );
    expect(unclassified).toEqual([]);
  });

  /* A tint lightens or darkens whatever is under it, so text that clears
     4.5:1 on the surface can fail on the hovered card. The round-2 critic
     measured dark --text-muted at 4.30:1 on --hover and 4.15:1 on
     --accent-glow, both over the dialog surface. */
  const textOnTints = TEXT_TOKENS.flatMap((fg) =>
    textTints(tokens).map((tint) => [fg, tint] as const),
  );
  it.each(textOnTints)(
    `%s on %s clears ${TEXT_AA}:1 over every ground`,
    (fg, tint) => {
      expect(shortfalls(tokens, fg, tint)).toEqual([]);
    },
  );

  /* Light --status-progress-fg on its own pill was 3.89:1 on a white dialog;
     every pair is measured the same way so no other pill repeats it. */
  it.each(statusPairs(tokens))(
    `%s on %s clears ${TEXT_AA}:1 over every ground`,
    (fg, bg) => {
      expect(shortfalls(tokens, fg, bg)).toEqual([]);
    },
  );

  it.each(translucent(tokens).filter((name) => SIDEBAR_TINT.test(name)))(
    `sidebar text on %s clears ${TEXT_AA}:1 over the sidebar`,
    (tint) => {
      for (const fg of ["--nav-text", "--nav-text-active"]) {
        expect(
          ratioOver(tokens, fg, tint, "--sidebar-background"),
        ).toBeGreaterThanOrEqual(TEXT_AA);
      }
    },
  );
});

describe.each([
  ["dark", APP_THEMES.dark],
  ["light", APP_THEMES.light],
] as const)("globals.css, %s theme", (_name, tokens) => {
  const pairs = TEXT_TOKENS.flatMap((fg) =>
    grounds(tokens).map((bg) => [fg, bg] as const),
  );

  it.each(pairs)(`%s on %s clears ${TEXT_AA}:1`, (fg, bg) => {
    expect(ratio(tokens, fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  /* WCAG 1.4.11: the focus indicator against whatever it is drawn over. The
     outline sits 2px outside the control, so that is the ground, never the
     control's own fill. */
  it.each(grounds(tokens))(
    `the --ring focus indicator on %s clears ${NON_TEXT_AA}:1`,
    (bg) => {
      expect(ratio(tokens, "--ring", bg)).toBeGreaterThanOrEqual(NON_TEXT_AA);
    },
  );

  it(`the sidebar's focus ring clears ${NON_TEXT_AA}:1 on the sidebar`, () => {
    expect(
      ratio(tokens, "--sidebar-ring", "--sidebar-background"),
    ).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });

  /* Muted has to stay the quietest tier, or the fix has flattened the
     hierarchy rather than repaired it. */
  it("keeps muted quieter than secondary, and secondary quieter than primary text", () => {
    const on = (fg: string) => ratio(tokens, fg, "--surface-2");
    expect(on("--text-muted")).toBeLessThan(on("--text-secondary"));
    expect(on("--text-secondary")).toBeLessThan(on("--foreground"));
  });
});

describe("landing.css keeps the same muted contract", () => {
  const landing = readFileSync(path.join(APP, "landing.css"), "utf8");
  const LANDING = theme(
    landing,
    ".landing-page",
    ':root[data-theme="light"] .landing-page',
  );
  const LANDING_GROUNDS = ["--base", "--surface-1", "--surface-2"];

  describe.each([
    ["dark", LANDING.dark],
    ["light", LANDING.light],
  ] as const)("%s", (_name, tokens) => {
    it.each(LANDING_GROUNDS)(`--text-muted on %s clears ${TEXT_AA}:1`, (bg) => {
      expect(ratio(tokens, "--text-muted", bg)).toBeGreaterThanOrEqual(TEXT_AA);
    });
  });

  /* The UI Spec names one Text Muted per theme; a landing copy that drifts
     from the app's is a third value nobody decided on. */
  it.each([
    ["dark", LANDING.dark, APP_THEMES.dark],
    ["light", LANDING.light, APP_THEMES.light],
  ] as const)("uses the app's --text-muted in %s", (_name, landing, app) => {
    expect(solid(landing, "--text-muted")).toBe(solid(app, "--text-muted"));
  });
});

describe("the focus indicator", () => {
  it("is a solid 2px --ring outline, outward and inset", () => {
    const css = stripComments(globals);
    expect(css).toMatch(
      /@utility focus-outline \{\s*outline: 2px solid var\(--ring\);\s*outline-offset: 2px;\s*\}/,
    );
    expect(css).toMatch(
      /@utility focus-outline-inset \{\s*outline: 2px solid var\(--ring\);\s*outline-offset: -2px;\s*\}/,
    );
  });

  it("is what a bare input, textarea or select shows", () => {
    expect(stripComments(globals)).toMatch(
      /input:focus-visible,\s*textarea:focus-visible,\s*select:focus-visible \{\s*outline: 2px solid var\(--ring\);/,
    );
  });

  /* Each pattern produced an invisible focus state somewhere in the app:
     - --accent-glow, or any rgba ring, is a 12-15% tint at 1.15-1.20:1;
     - any ring at partial alpha (ring-ring/50 was ~1.7:1);
     - a focus border utility never paints at all, because globals.css sets
       `* { border-color }` outside any layer and that beats @layer utilities.
     Use focus-visible:focus-outline (or -inset) instead. */
  const WEAK_FOCUS = [
    /focus(?:-visible|-within)?:ring-\[(?:var\(--accent-glow\)|rgba)/,
    /focus(?:-visible|-within)?:ring-[\w-]+\/\d+/,
    /focus(?:-visible|-within)?:border-[^\s"'`]+/,
  ];

  it("has no weak focus style left anywhere in src", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true })) {
      const rel = String(entry);
      if (!/\.(tsx?|css)$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
      const lines = readFileSync(path.join(SRC, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const pattern of WEAK_FOCUS) {
          const hit = pattern.exec(line);
          if (hit) offenders.push(`src/${rel}:${i + 1} ${hit[0]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
