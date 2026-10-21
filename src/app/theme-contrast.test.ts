import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/palette";
import { EMAIL_BRAND } from "@/lib/email-templates";
import {
  FILL_TOKENS,
  groundTokens,
  readAppThemes,
  readLandingThemes,
} from "@/lib/theme/primary-policy";
import {
  resolveToken as resolve,
  stripCssComments as stripComments,
  type Tokens,
} from "@/lib/theme/tokens";
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
 * measured the day it appears.
 */

const APP = path.join(process.cwd(), "src", "app");
const SRC = path.join(process.cwd(), "src");

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3;

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

const globals = readFileSync(path.join(APP, "globals.css"), "utf8");
const APP_THEMES = readAppThemes();

const TEXT_TOKENS = ["--foreground", "--text-secondary", "--text-muted"];
const grounds = groundTokens;

describe("contrastRatio (WCAG 2.x relative luminance)", () => {
  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#ffffff", 1],
    // WebAIM's reference: the lightest grey that still looks fine and fails AA.
    ["#777777", "#ffffff", 4.48],
    ["#767676", "#ffffff", 4.54],
    // Why --primary is never a fill behind a label (UI Spec §12.1).
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

/* --primary (#138bc8) is the brand blue, and it cannot carry text either way
   round: white on it is 3.78:1, and as text it is 4.02:1 on the deepest dark
   surface and 3.34:1 on the light page. So a label on a primary fill uses
   --primary-fill*, and the blue as text uses --primary-text*. These pin both
   splits; primary-token-usage.test.ts keeps src from reaching around them. */
const FILLS = FILL_TOKENS;
const PRIMARY_TEXT = ["--primary-text", "--primary-text-hover"] as const;

/* A brand tint (icon tile, chip, selected row, hover wash) can be laid on any
   surface, so it is measured over every one. Round 1 measured only Base and
   Surface 1-2 and claimed the rest: a 20% tint over
   --surface-container-highest put --primary-text at 4.28:1 dark, 4.25:1 light. */
const BRAND_RGB = [19, 139, 200] as const;

/** Every alpha a brand tint is painted at, read from src so a stronger tint
 * added later is measured the day it lands: bg-[rgba(19,139,200,a)],
 * bg-primary/NN and the --accent-glow token. */
function brandTintAlphas(tokens: Tokens): number[] {
  const alphas = new Set<number>();
  for (const entry of readdirSync(SRC, { recursive: true })) {
    const rel = String(entry);
    if (!/\.tsx?$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const source = readFileSync(path.join(SRC, rel), "utf8");
    for (const [, a] of source.matchAll(
      /bg-\[rgba\(19,\s*139,\s*200,\s*([\d.]+)\)\]/g,
    )) {
      alphas.add(Number(a));
    }
    for (const [, pct] of source.matchAll(/bg-primary\/(\d+)/g)) {
      alphas.add(Number(pct) / 100);
    }
  }
  const glow = /^rgba\(19,\s*139,\s*200,\s*([\d.]+)\)$/.exec(
    resolve(tokens, "--accent-glow"),
  );
  if (!glow) throw new Error("--accent-glow is no longer a brand tint");
  alphas.add(Number(glow[1]));
  return [...alphas].sort((a, b) => a - b);
}

function composite(alpha: number, ground: string): string {
  const base = ground
    .slice(1)
    .match(/../g)
    ?.map((c) => parseInt(c, 16));
  if (!base) throw new Error(`cannot composite onto ${ground}`);
  return `#${BRAND_RGB.map((c, i) =>
    Math.round(c * alpha + base[i] * (1 - alpha))
      .toString(16)
      .padStart(2, "0"),
  ).join("")}`;
}

describe.each([
  ["dark", APP_THEMES.dark],
  ["light", APP_THEMES.light],
] as const)("the primary token split, %s theme", (_name, tokens) => {
  it.each(FILLS)(`--primary-foreground on %s clears ${TEXT_AA}:1`, (fill) => {
    expect(ratio(tokens, "--primary-foreground", fill)).toBeGreaterThanOrEqual(
      TEXT_AA,
    );
  });

  it("darkens the fill from rest to hover to pressed", () => {
    const [rest, hover, active] = FILLS.map((fill) =>
      ratio(tokens, "--primary-foreground", fill),
    );
    expect(rest).toBeLessThan(hover);
    expect(hover).toBeLessThan(active);
  });

  it("aims the resting fill near 5:1, not just over the line", () => {
    expect(
      ratio(tokens, "--primary-foreground", "--primary-fill"),
    ).toBeGreaterThanOrEqual(5);
  });

  it(`the sidebar's primary pair clears ${TEXT_AA}:1`, () => {
    expect(
      ratio(tokens, "--sidebar-primary-foreground", "--sidebar-primary"),
    ).toBeGreaterThanOrEqual(TEXT_AA);
  });

  /* Disabled labels are exempt from AA (WCAG 1.4.3), but the light theme had
     --text-muted on the dark navy disabled fill at 2.11:1. */
  it(`the disabled label stays legible, at least ${NON_TEXT_AA}:1`, () => {
    expect(
      ratio(tokens, "--primary-disabled-foreground", "--primary-disabled"),
    ).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });

  const textPairs = PRIMARY_TEXT.flatMap((fg) =>
    grounds(tokens).map((bg) => [fg, bg] as const),
  );
  it.each(textPairs)(`%s on %s clears ${TEXT_AA}:1`, (fg, bg) => {
    expect(ratio(tokens, fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  const alphas = brandTintAlphas(tokens);
  const tintPairs = PRIMARY_TEXT.flatMap((fg) =>
    grounds(tokens).flatMap((bg) =>
      alphas.map((alpha) => [fg, alpha, bg] as const),
    ),
  );
  it.each(tintPairs)(
    `%s on a %d brand tint over %s clears ${TEXT_AA}:1`,
    (fg, alpha, bg) => {
      const ground = composite(alpha, solid(tokens, bg));
      expect(contrastRatio(solid(tokens, fg), ground)).toBeGreaterThanOrEqual(
        TEXT_AA,
      );
    },
  );

  /* In Progress, Published, SourcePill and the calendar's design badges all
     draw --status-progress-fg on --status-progress-bg. Light #1f7ab5 measured
     3.91:1 on a white card and 3.22:1 over --surface-container-highest. */
  it.each(grounds(tokens))(
    `--status-progress-fg on its tint over %s clears ${TEXT_AA}:1`,
    (bg) => {
      const tint = /^rgba\(19,\s*139,\s*200,\s*([\d.]+)\)$/.exec(
        resolve(tokens, "--status-progress-bg"),
      );
      if (!tint)
        throw new Error("--status-progress-bg is no longer a brand tint");
      const ground = composite(Number(tint[1]), solid(tokens, bg));
      expect(
        contrastRatio(solid(tokens, "--status-progress-fg"), ground),
      ).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

  it("keeps --primary as the focus ring, which only needs 3:1", () => {
    expect(resolve(tokens, "--ring")).toBe(resolve(tokens, "--primary"));
  });

  it("has retired the fill tokens that failed under a white label", () => {
    expect(tokens.has("--primary-hover")).toBe(false);
    expect(tokens.has("--primary-active")).toBe(false);
  });
});

describe("transactional email inlines the light primary tokens", () => {
  it("uses --primary-text for links and --primary-fill for buttons", () => {
    expect(normalizeHex(EMAIL_BRAND.link)).toBe(
      solid(APP_THEMES.light, "--primary-text"),
    );
    expect(normalizeHex(EMAIL_BRAND.buttonFill)).toBe(
      solid(APP_THEMES.light, "--primary-fill"),
    );
  });
});

describe("landing.css keeps the app's text and primary contracts", () => {
  const LANDING = readLandingThemes();
  const LANDING_GROUNDS = ["--base", "--surface-1", "--surface-2"];

  describe.each([
    ["dark", LANDING.dark, APP_THEMES.dark],
    ["light", LANDING.light, APP_THEMES.light],
  ] as const)("%s", (_name, tokens, app) => {
    it.each(LANDING_GROUNDS)(`--text-muted on %s clears ${TEXT_AA}:1`, (bg) => {
      expect(ratio(tokens, "--text-muted", bg)).toBeGreaterThanOrEqual(TEXT_AA);
    });

    it.each(LANDING_GROUNDS)(
      `--primary-text on %s clears ${TEXT_AA}:1`,
      (bg) => {
        expect(ratio(tokens, "--primary-text", bg)).toBeGreaterThanOrEqual(
          TEXT_AA,
        );
      },
    );

    it.each([...FILLS, "--primary-foreground", ...PRIMARY_TEXT, "--primary"])(
      "%s matches globals.css",
      (name) => {
        expect(solid(tokens, name)).toBe(solid(app, name));
      },
    );
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
