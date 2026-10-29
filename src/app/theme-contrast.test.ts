// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TICKET_STATUS_TONE } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { TOAST_TEXT_TOKENS } from "@/components/ui/sonner";
import { contrastRatio } from "@/lib/design/palette";
import { EMAIL_BRAND } from "@/lib/email-templates";
import {
  contrast,
  over,
  parseColor,
  type Rgba,
  withAlpha,
} from "@/lib/theme/color";
import {
  FILL_TOKENS,
  groundTokens,
  readAppThemes,
  readLandingThemes,
} from "@/lib/theme/primary-policy";
import {
  colorIn,
  declarations,
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
 * measured the day it appears. Translucent tints are composited over each of
 * them before they are measured, the same way.
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
function paintOver(tokens: Tokens, tint: string, ground: string): string {
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
    contrastRatio(solid(tokens, fg), paintOver(tokens, tint, ground)).toFixed(
      2,
    ),
  );
}

const globals = readFileSync(path.join(APP, "globals.css"), "utf8");
const APP_THEMES = readAppThemes();

const TEXT_TOKENS = ["--foreground", "--text-secondary", "--text-muted"];
const grounds = groundTokens;

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

/* The primary fills predate the -fill-foreground naming and carry
   --primary-foreground (globals.css). Any other family names its own. */
const FILL_FOREGROUND: Record<string, string> = {
  "--primary-fill": "--primary-foreground",
};

/** Each solid --X-fill and --X-fill-<state> with the label colour painted on
 *  it. Found by name, so a new state is measured. */
function fills(tokens: Tokens): [string, string][] {
  return [...tokens.keys()]
    .flatMap((name) => {
      const match = /^(--[\w-]+-fill)(-(?!foreground$)[\w]+)?$/.exec(name);
      return match
        ? [
            [name, FILL_FOREGROUND[match[1]] ?? `${match[1]}-foreground`] as [
              string,
              string,
            ],
          ]
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

  it("composites a tint over a ground the way the browser does", () => {
    /* 15% #138bc8 over white: 255 - 0.15 * (255 - c), rounded per channel. */
    expect(
      paintOver(APP_THEMES.light, "--status-progress-bg", "--surface-2"),
    ).toBe("#DCEEF7");
    /* 6% white over #001f3d. */
    expect(paintOver(APP_THEMES.dark, "--hover", "--surface-2")).toBe(
      "#0F2C49",
    );
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
      expect(fills(tokens)).toEqual([
        ["--destructive-fill", "--destructive-fill-foreground"],
        ["--destructive-fill-hover", "--destructive-fill-foreground"],
        ["--primary-fill", "--primary-foreground"],
        ["--primary-fill-active", "--primary-foreground"],
        ["--primary-fill-hover", "--primary-foreground"],
      ]);
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

  /* The rendered lane found both on /team: light --secondary-foreground was
     the page colour on the secondary badge (1.82:1), and the Remove Member
     button put white on --status-error-fg (3.05:1 dark). */
  it.each([
    ["--secondary-foreground", "--secondary"],
    ["--primary-foreground", "--destructive-fill"],
    ["--primary-foreground", "--destructive-fill-hover"],
  ])(`%s on %s clears ${TEXT_AA}:1`, (fg, bg) => {
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

  /* The active progress step's number and label. --primary as that text was
     3.78:1 on white and 4.40:1 on the dark dialog. */
  it.each(grounds(tokens))(`progress text on %s clears ${TEXT_AA}:1`, (bg) => {
    expect(ratio(tokens, "--status-progress-fg", bg)).toBeGreaterThanOrEqual(
      TEXT_AA,
    );
  });

  /* --status-error-fg is the one error text token (UI Spec §9.2): pills,
     inline field errors, upload rejections. --error is its old name and must
     not drift back to a second value; #d47575 was 3.18:1 on a light card. */
  it.each(grounds(tokens))(
    `inline error text on %s clears ${TEXT_AA}:1`,
    (bg) => {
      expect(ratio(tokens, "--status-error-fg", bg)).toBeGreaterThanOrEqual(
        TEXT_AA,
      );
    },
  );

  it("names one error text colour, whatever it is called", () => {
    expect(solid(tokens, "--error")).toBe(solid(tokens, "--status-error-fg"));
  });

  /* A destructive button is a solid fill under its label. Dark white on
     --status-error-fg as a fill was 3.05:1, so fills have their own tokens
     and every state of each is measured with its own foreground. */
  it.each(fills(tokens))(
    `%s under %s clears ${TEXT_AA}:1`,
    (fill, foreground) => {
      expect(ratio(tokens, foreground, fill)).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

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

  it("keeps --primary as the focus ring, which only needs 3:1", () => {
    expect(resolve(tokens, "--ring")).toBe(resolve(tokens, "--primary"));
  });

  it("has retired the fill tokens that failed under a white label", () => {
    expect(tokens.has("--primary-hover")).toBe(false);
    expect(tokens.has("--primary-active")).toBe(false);
  });
});

/* A status pill is its fg on a translucent tint of the status hue, and a pill
   can sit on any surface, so each pair is measured over every one. Light
   ready, pending and error measured 3.68, 3.95 and 4.45:1 on the page before
   2026-10-22, while the globals comment called the tints "legible as-is". */
const STATUSES = ["draft", "progress", "ready", "pending", "error"] as const;

function paint(tokens: Tokens, value: string): Rgba {
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(
    value,
  );
  const color = mix
    ? withAlpha(paint(tokens, mix[1]), Number(mix[2]) / 100)
    : colorIn(tokens, value);
  if (!color) throw new Error(`cannot measure "${value}"`);
  return color;
}

/** fg over bg over the surface, at 8-bit precision as the browser paints. */
function onSurface(tokens: Tokens, fg: string, bg: string, surface: string) {
  const quantize = (c: Rgba) => parseColor(toHexColor(c)) as Rgba;
  const ground = quantize(
    over(paint(tokens, bg), paint(tokens, `var(${surface})`)),
  );
  return contrast(quantize(over(paint(tokens, fg), ground)), ground);
}

function toHexColor(c: Rgba): string {
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

describe.each([
  ["dark", APP_THEMES.dark],
  ["light", APP_THEMES.light],
] as const)("status pills, %s theme", (_name, tokens) => {
  const pills = STATUSES.flatMap((status) =>
    grounds(tokens).map((surface) => [status, surface] as const),
  );
  it.each(pills)(
    `--status-%s-fg on its tint over %s clears ${TEXT_AA}:1`,
    (status, surface) => {
      expect(
        onSurface(
          tokens,
          `var(--status-${status}-fg)`,
          `var(--status-${status}-bg)`,
          surface,
        ),
      ).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

  /* Status fgs are also bare text: inline errors, the pending note. */
  it.each(pills)(
    `--status-%s-fg as text on %s clears ${TEXT_AA}:1`,
    (status, surface) => {
      expect(
        onSurface(tokens, `var(--status-${status}-fg)`, "transparent", surface),
      ).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

  /* The semantic hues paint text directly (text-success, the Pro Tip heading,
     the landing form notices); light #97c459 on white was 2.03:1. */
  const semantic = ["success", "warning", "error"].flatMap((hue) =>
    grounds(tokens).map((surface) => [hue, surface] as const),
  );
  it.each(semantic)(
    `--%s as text on %s clears ${TEXT_AA}:1`,
    (hue, surface) => {
      expect(
        onSurface(tokens, `var(--${hue})`, "transparent", surface),
      ).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

  const tickets = Object.entries(TICKET_STATUS_TONE).flatMap(([status, tone]) =>
    grounds(tokens).map((surface) => [status, surface, tone] as const),
  );
  it.each(tickets)(
    `the %s ticket badge over %s clears ${TEXT_AA}:1`,
    (_status, surface, tone) => {
      expect(
        onSurface(tokens, tone.fg, tone.bg, surface),
      ).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );
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

  /* The UI Spec names one Text Muted per theme; a landing copy that drifts
     from the app's is a third value nobody decided on. */
  it.each([
    ["dark", LANDING.dark, APP_THEMES.dark],
    ["light", LANDING.light, APP_THEMES.light],
  ] as const)("uses the app's --text-muted in %s", (_name, landing, app) => {
    expect(solid(landing, "--text-muted")).toBe(solid(app, "--text-muted"));
  });
});

function sourceLines(): { at: string; line: string }[] {
  const lines: { at: string; line: string }[] = [];
  for (const entry of readdirSync(SRC, { recursive: true })) {
    const rel = String(entry);
    if (!/\.(tsx?|css)$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
    readFileSync(path.join(SRC, rel), "utf8")
      .split("\n")
      .forEach((line, i) => {
        lines.push({ at: `src/${rel}:${i + 1}`, line });
      });
  }
  return lines;
}

describe("destructive fills", () => {
  /* Text tokens are tuned as text on the surfaces, not as fills under white:
     the workspace and member delete buttons painted white on
     --status-error-fg and fell to 3.05:1 in dark. */
  const TEXT_TOKEN_FILL =
    /bg-(?:\[var\(--(?:status-[a-z]+-fg|error)\)\]|status-[a-z]+-fg\b|error\b)/;
  const LIGHT_LABEL =
    /text-(?:white\b|\[#fff(?:fff)?\]|primary-foreground\b|destructive-fill-foreground\b)/;

  it("never paints a label on a text token used as a fill", () => {
    const offenders = sourceLines()
      .filter(
        ({ line }) => TEXT_TOKEN_FILL.test(line) && LIGHT_LABEL.test(line),
      )
      .map(({ at, line }) => `${at} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  /* There is no --color-destructive, so text-destructive and
     bg-destructive/10 paint nothing: a destructive badge or menu item looked
     like any other. Error text is --status-error-fg on --status-error-bg. */
  it("paints no text or fill with the undefined destructive colour", () => {
    const offenders = sourceLines()
      .filter(({ line }) =>
        /(?:^|[\s:"'])(?:text|bg)-destructive(?:\/\d+)?(?=[\s"'])/.test(line),
      )
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });

  it("has no white-on-error foreground token left to reach for", () => {
    const offenders = sourceLines()
      .filter(({ line }) => /error-foreground/.test(line))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });

  it("is what the destructive Button variant paints", () => {
    const button = readFileSync(
      path.join(SRC, "components", "ui", "button.tsx"),
      "utf8",
    );
    expect(button).toMatch(
      /destructive:\s*"bg-destructive-fill text-destructive-fill-foreground hover:bg-destructive-fill-hover/,
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
    const offenders = sourceLines().flatMap(({ at, line }) =>
      WEAK_FOCUS.flatMap((pattern) => {
        const hit = pattern.exec(line);
        return hit ? [`${at} ${hit[0]}`] : [];
      }),
    );
    expect(offenders).toEqual([]);
  });
});

/* The flow's own messages ("Sent to the design team as DT-1042", "The JPG
   couldn't be made") are rich toasts. Sonner's light palette measured 4.26:1
   (success), 4.35:1 (error, info) and 3.07:1 (warning). The tints are read
   from the installed sonner, so an upgrade that moves them is re-measured. */
describe("rich toasts", () => {
  const sonnerCss = readFileSync(
    path.join(process.cwd(), "node_modules/sonner/dist/styles.css"),
    "utf8",
  );

  function hslToHex(value: string): string {
    const match = /^hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)$/.exec(
      value,
    );
    if (!match) throw new Error(`"${value}" is not an hsl() colour`);
    const [h, s, l] = [+match[1], +match[2] / 100, +match[3] / 100];
    const a = s * Math.min(l, 1 - l);
    const channel = (n: number) => {
      const k = (n + h / 30) % 12;
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  }

  describe.each([
    ["light", APP_THEMES.light],
    ["dark", APP_THEMES.dark],
  ] as const)("%s theme", (name, tokens) => {
    const sonner = declarations(
      sonnerCss,
      `[data-sonner-toaster][data-sonner-theme='${name}']`,
    );
    it.each(Object.entries(TOAST_TEXT_TOKENS))(
      `%s text (%s) clears ${TEXT_AA}:1 on its tint`,
      (type, token) => {
        const tint = hslToHex(resolve(sonner, `--${type}-bg`));
        expect(
          Number(contrastRatio(solid(tokens, token), tint).toFixed(2)),
        ).toBeGreaterThanOrEqual(TEXT_AA);
      },
    );
  });
});
