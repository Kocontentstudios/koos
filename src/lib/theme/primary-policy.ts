import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parseColor, type Rgba } from "./color";
import type { ScanPolicy } from "./primary-usage";
import { fadingClassesIn } from "./scan-css";
import { FILL_IN_CLASSES, type FillComponent } from "./scan-model";
import {
  declarations,
  extendThemes,
  readThemes,
  resolveValue,
  THEME_NAMES,
  type ThemeName,
  type Themes,
  type Tokens,
} from "./tokens";

/**
 * The app's colour contract as the theme gates read it: the token sets from
 * globals.css and landing.css, the surfaces text is laid on, and which tokens
 * may carry or be a label. theme-contrast.test.ts measures the tokens;
 * primary-usage.ts keeps src from reaching around them.
 */

const appFile = (name: string) => path.join(process.cwd(), "src", "app", name);

export const FILL_TOKENS = [
  "--primary-fill",
  "--primary-fill-hover",
  "--primary-fill-active",
] as const;

/* --status-progress-fg is brand-hued text on its own tint (In Progress,
   Published, SourcePill); it is measured with the text tokens. */
export const TEXT_TOKENS = [
  "--primary-text",
  "--primary-text-hover",
  "--status-progress-fg",
] as const;

/** Every token a block of text or a control can be painted onto. --accent is
 * the highlighted-menu-item fill, so text sits on it too. */
export const GROUND =
  /^--(background|surface(-[\w-]+)?|card|popover|muted|accent)$/;

export function groundTokens(tokens: Tokens): string[] {
  return [...tokens.keys()].filter((name) => GROUND.test(name)).sort();
}

export function readAppThemes(): Themes {
  const css = readFileSync(appFile("globals.css"), "utf8");
  return readThemes(css, ":root", ':root[data-theme="light"]');
}

export function readLandingThemes(): Themes {
  const css = readFileSync(appFile("landing.css"), "utf8");
  return readThemes(
    css,
    ".landing-page",
    ':root[data-theme="light"] .landing-page',
  );
}

function groundColors(themes: Themes): Record<ThemeName, Rgba[]> {
  return Object.fromEntries(
    THEME_NAMES.map((t) => [
      t,
      groundTokens(themes[t])
        .map((name) =>
          parseColor(resolveValue(themes[t], `var(${name})`) ?? ""),
        )
        .filter((c): c is Rgba => c !== null && c.a === 1),
    ]),
  ) as Record<ThemeName, Rgba[]>;
}

const SRC = path.join(process.cwd(), "src");

/**
 * The shared Button paints --primary-fill from its cva, so `className` on a
 * <Button> never shows the fill to a class scan. Which variants paint it, and
 * which one is the default, are read from button.tsx itself, so a variant
 * that starts painting the fill is covered the day it is written.
 */
export function buttonFill(
  source = readFileSync(
    path.join(SRC, "components", "ui", "button.tsx"),
    "utf8",
  ),
): FillComponent {
  const file = ts.createSourceFile(
    "button.tsx",
    source,
    ts.ScriptTarget.Latest,
  );
  const fillVariants: string[] = [];
  let defaultVariant = "";
  const objectAt = (obj: ts.ObjectLiteralExpression, key: string) => {
    const prop = obj.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(file) === key,
    );
    return prop && ts.isObjectLiteralExpression(prop.initializer)
      ? prop.initializer
      : null;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "cva" &&
      node.arguments[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const config = node.arguments[1];
      const variants = objectAt(config, "variants");
      const variant = variants && objectAt(variants, "variant");
      for (const prop of variant?.properties ?? []) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isStringLiteralLike(prop.initializer) &&
          FILL_IN_CLASSES.test(prop.initializer.text)
        ) {
          fillVariants.push(prop.name.getText(file).replace(/["']/g, ""));
        }
      }
      const defaults = objectAt(config, "defaultVariants");
      const chosen = defaults?.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(file) === "variant",
      );
      if (chosen && ts.isStringLiteralLike(chosen.initializer)) {
        defaultVariant = chosen.initializer.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { variantProp: "variant", fillVariants, defaultVariant };
}

/** Every class name a stylesheet in src fades. */
export function srcFadingClasses(): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(SRC, { recursive: true })) {
    const rel = String(entry);
    if (!rel.endsWith(".css")) continue;
    for (const name of fadingClassesIn(
      readFileSync(path.join(SRC, rel), "utf8"),
    )) {
      found.add(name);
    }
  }
  return found;
}

export function appScanPolicy(): ScanPolicy {
  const css = readFileSync(appFile("globals.css"), "utf8");
  const tailwind = declarations(css, "@theme inline");
  const themes = extendThemes(readAppThemes(), {
    dark: tailwind,
    light: tailwind,
  });
  const landing = extendThemes(themes, readLandingThemes());
  const button = buttonFill();
  return {
    themes,
    themesFor: (fileName) =>
      fileName.endsWith("landing.css") ? landing : undefined,
    fillTokens: FILL_TOKENS,
    textTokens: TEXT_TOKENS,
    grounds: groundColors(themes),
    retiredTokens: /--primary-(?:hover|active)\b/,
    /* The two fills that failed under white before the split. Written without
       the # so this file does not trip its own scan. */
    retiredValues: ["0f7eb8", "0a6d9e"].map((hex) => `#${hex}`),
    fillComponents: { Button: button, buttonVariants: button },
    fadingClasses: srcFadingClasses(),
  };
}
