import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The brand blue --primary (#138bc8) fails as a fill behind a white label
 * (3.78:1) and as text on the app's surfaces (down to 3.34:1). The fix is a
 * token split: --primary-fill* under labels, --primary-text* for the blue as
 * text, --primary only for rings, borders, dots and bars. theme-contrast.test.ts
 * measures the new tokens; this file makes the old pairings unwritable.
 *
 * It reads source, not rendered pages, so it scopes a check to what can be
 * known statically: one JSX element and everything inside it, one string
 * literal, or one CSS rule. A label anywhere inside a primary-filled element is
 * text on that fill, whether the class sits on the element or a child.
 */

const SRC = path.join(process.cwd(), "src");

/** Splits `group-hover:bg-primary` into its variants and its utility. A colon
 * inside an arbitrary-value bracket is part of a selector, not a separator. */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) {
      variants.push(token.slice(start, i));
      start = i + 1;
    }
  }
  return { variants, utility: token.slice(start) };
}

/* A pseudo-element paints its own box (the sidebar's active bar is a
   before:bg-primary), so it never sits behind the element's label. */
const OWN_BOX = /^(?:before|after|placeholder|marker|file|selection|backdrop)$/;

/* bg-primary/15 is a tint that brand-blue text sits on and is measured as such
   in theme-contrast.test.ts; from half opacity up it reads as the fill. */
const OLD_FILL_CLASS =
  /^bg-(?:primary(?:\/(?:[5-9]\d|100))?|\[var\(--primary\)\]|\[#138bc8\])$/i;
const LIGHT_TEXT_CLASS =
  /^text-(?:white|primary-foreground|\[#fff(?:fff)?\]|\[var\(--primary-foreground\)\])$/i;
const PRIMARY_AS_TEXT_CLASS =
  /^text-(?:primary(?:\/\d+)?|\[var\(--primary\)\]|\[#138bc8\])$/i;

const OLD_FILL_DECL =
  /(?<![\w-])background(?:-color)?\s*:\s*(?:var\(--primary\)|#138bc8)\s*(?:[;!"']|$)/im;
const LIGHT_COLOR_DECL =
  /(?<![\w-])color\s*:\s*(?:#fff(?:fff)?|white|var\(--primary-foreground\))\s*(?:[;!"']|$)/im;
const PRIMARY_COLOR_DECL =
  /(?<![\w-])color\s*:\s*(?:var\(--primary\)|#138bc8)\s*(?:[;!"']|$)/im;

/* Retired with the split: both measured under 4.5:1 behind white, and their
   only other use was as link-hover text, which --primary-text-hover took. */
const RETIRED_TOKEN = /--primary-(?:hover|active)\b/;

function utilities(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(splitVariants)
    .filter(({ variants }) => !variants.some((v) => OWN_BOX.test(v)))
    .map(({ utility }) => utility);
}

const hasOldFillClass = (text: string) =>
  utilities(text).some((u) => OLD_FILL_CLASS.test(u));
const hasLightTextClass = (text: string) =>
  utilities(text).some((u) => LIGHT_TEXT_CLASS.test(u));
const hasPrimaryTextClass = (text: string) =>
  utilities(text).some((u) => PRIMARY_AS_TEXT_CLASS.test(u));

/** Every literal string piece under a node: class strings inside cn(),
 * ternaries and template literals all count. */
function stringPieces(node: ts.Node): string[] {
  const pieces: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      pieces.push(n.text);
    } else if (ts.isTemplateExpression(n)) {
      pieces.push(n.head.text);
      for (const span of n.templateSpans) {
        visit(span.expression);
        pieces.push(span.literal.text);
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return pieces;
}

/** A JSX `style={{ ... }}` object, rendered as CSS so one set of declaration
 * patterns serves stylesheets, inline HTML and React styles. */
function styleObjectAsCss(expression: ts.Expression): string {
  if (!ts.isObjectLiteralExpression(expression)) return "";
  const decls: string[] = [];
  for (const prop of expression.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name.getText().replace(/["']/g, "");
    const value = stringPieces(prop.initializer).join(" ");
    if (!value) continue;
    decls.push(
      `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`,
    );
  }
  return decls.join("\n");
}

interface ElementPaint {
  classes: string;
  css: string;
}

function attributesOf(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): ts.JsxAttributes {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
}

function paintOf(node: ts.JsxElement | ts.JsxSelfClosingElement): ElementPaint {
  let classes = "";
  let css = "";
  for (const attr of attributesOf(node).properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
    const name = attr.name.getText();
    if (name === "className") {
      classes = stringPieces(attr.initializer).join(" ");
    } else if (
      name === "style" &&
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression
    ) {
      css = styleObjectAsCss(attr.initializer.expression);
    }
  }
  return { classes, css };
}

const paintsOldFill = (p: ElementPaint) =>
  hasOldFillClass(p.classes) || OLD_FILL_DECL.test(p.css);
const paintsLightText = (p: ElementPaint) =>
  hasLightTextClass(p.classes) || LIGHT_COLOR_DECL.test(p.css);

/** Whether anything readable renders inside: literal text, an interpolated
 * value, or a descendant that paints a light label colour. */
function carriesLabel(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (paintsLightText(paintOf(node))) return true;
  if (!ts.isJsxElement(node)) return false;
  return node.children.some((child) => {
    if (ts.isJsxText(child)) return child.text.trim() !== "";
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      return carriesLabel(child);
    }
    if (ts.isJsxFragment(child)) {
      return child.children.some(
        (c) => !ts.isJsxText(c) || c.text.trim() !== "",
      );
    }
    return false;
  });
}

function findPrimaryMisuse(fileName: string, source: string): string[] {
  const problems: string[] = [];
  const lineOf = (pos: number) => source.slice(0, pos).split("\n").length;
  const report = (pos: number, why: string) =>
    problems.push(`${fileName}:${lineOf(pos)} ${why}`);

  source.split("\n").forEach((line, i) => {
    const hit = RETIRED_TOKEN.exec(line);
    if (hit) problems.push(`${fileName}:${i + 1} retired token ${hit[0]}`);
  });

  if (fileName.endsWith(".css")) {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, (c) =>
      c.replace(/[^\n]/g, " "),
    );
    for (const rule of css.matchAll(/[^{}]*\{([^{}]*)\}/g)) {
      const body = rule[1];
      const at = rule.index ?? 0;
      if (OLD_FILL_DECL.test(body) && LIGHT_COLOR_DECL.test(body)) {
        report(at + rule[0].indexOf("{"), "light label on --primary fill");
      }
      if (PRIMARY_COLOR_DECL.test(body)) {
        report(at + rule[0].indexOf("{"), "--primary as text colour");
      }
    }
    return problems;
  }

  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (paintsOldFill(paintOf(node)) && carriesLabel(node)) {
        report(node.getStart(file), "label inside a --primary filled element");
      }
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.text;
      if (hasOldFillClass(text) && hasLightTextClass(text)) {
        report(
          node.getStart(file),
          "light label on bg-primary in one class list",
        );
      }
      if (hasPrimaryTextClass(text)) {
        report(node.getStart(file), "text-primary; use text-primary-text");
      }
      if (OLD_FILL_DECL.test(text) && LIGHT_COLOR_DECL.test(text)) {
        report(
          node.getStart(file),
          "light label on #138bc8 / --primary in inline CSS",
        );
      }
      if (PRIMARY_COLOR_DECL.test(text)) {
        report(node.getStart(file), "--primary as text colour in inline CSS");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  /* A style object is not a string literal, so its declarations are checked
     here, per element, as rendered CSS. */
  const visitStyles = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const { css } = paintOf(node);
      if (PRIMARY_COLOR_DECL.test(css)) {
        report(
          node.getStart(file),
          "--primary as text colour in a style object",
        );
      }
    }
    ts.forEachChild(node, visitStyles);
  };
  visitStyles(file);

  return [...new Set(problems)];
}

describe("findPrimaryMisuse catches each way the old pairing was written", () => {
  it.each([
    [
      "a button class list",
      `<button className="bg-primary text-white">Go</button>`,
    ],
    [
      "the cva default variant",
      `const v = { default: "bg-primary text-primary-foreground" };`,
    ],
    [
      "a hover-only fill",
      `<span className="group-hover:bg-primary group-hover:text-primary-foreground"><Arrow /></span>`,
    ],
    [
      "a brand mark whose text is a child",
      `<div className="bg-primary"><span className="text-white">KO</span></div>`,
    ],
    [
      "a brand mark with bare text",
      `<div className="size-7 bg-primary">KO</div>`,
    ],
    [
      "a conditional fill with the label colour in another piece",
      `<div className={\`size-7 \${isUser ? "bg-surface-2" : "bg-primary"} text-white\`}>{label}</div>`,
    ],
    [
      "an icon button",
      `<button className="bg-primary"><Send className="text-white" /></button>`,
    ],
    [
      "an arbitrary-value fill",
      `<b className="bg-[var(--primary)] text-[var(--primary-foreground)]">1</b>`,
    ],
    [
      "an inline style",
      `<button style={{ background: "#138bc8", color: "#ffffff" }}>Try again</button>`,
    ],
    [
      "an email button",
      'const html = `<a style="display:inline-block;background:#138bc8;color:#ffffff">Verify</a>`;',
    ],
    ["an email link", 'const html = `<a style="color:#138bc8">Open</a>`;'],
    [
      "primary as text",
      `<a className="text-primary hover:underline">Forgot?</a>`,
    ],
    [
      "primary as text behind a variant",
      `<a className="hover:text-primary">Edit</a>`,
    ],
    [
      "a style-object text colour",
      `<span style={{ color: "var(--primary)" }}>Live</span>`,
    ],
    [
      "a retired hover token",
      `<button className="hover:bg-[var(--primary-hover)]" />`,
    ],
    [
      "the old badge's 80% hover fill",
      `const v = "text-primary-foreground [a]:hover:bg-primary/80";`,
    ],
  ])("%s", (_label, snippet) => {
    expect(findPrimaryMisuse("fixture.tsx", snippet)).not.toEqual([]);
  });

  it.each([
    [".x { background: var(--primary); color: white; }"],
    [".x:hover { background: var(--primary-hover); }"],
    [".x { color: var(--primary); }"],
  ])("CSS: %s", (css) => {
    expect(findPrimaryMisuse("fixture.css", css)).not.toEqual([]);
  });

  it.each([
    [
      "the new fill",
      `<button className="bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover active:bg-primary-fill-active">Go</button>`,
    ],
    [
      "the new text token",
      `<a className="text-primary-text hover:text-primary-text-hover">Forgot?</a>`,
    ],
    ["a dot", `<span className="size-1.5 rounded-full bg-primary" />`],
    [
      "a progress bar",
      `<div className="h-1 bg-primary" style={{ width: "40%" }} />`,
    ],
    [
      "a tint behind brand-blue text",
      `<span className="bg-primary/15 text-primary-text">3</span>`,
    ],
    [
      "a ring and a border",
      `<div className="ring-2 ring-primary border-primary">x</div>`,
    ],
    [
      "the foreground token on its own",
      `<span className="text-primary-foreground" />`,
    ],
    [
      "a theme-light variant with a colon inside brackets",
      `<i className="[:root[data-theme=light]_&]:text-primary-text" />`,
    ],
    [
      "a pseudo-element indicator bar",
      `<a className="text-white before:absolute before:bg-primary">Calendar</a>`,
    ],
  ])("leaves %s alone", (_label, snippet) => {
    expect(findPrimaryMisuse("fixture.tsx", snippet)).toEqual([]);
  });

  it("leaves CSS borders and outlines on --primary alone", () => {
    expect(
      findPrimaryMisuse(
        "fixture.css",
        ".x { border: 1px solid var(--primary); border-color: var(--primary); outline: 2px solid var(--primary); }",
      ),
    ).toEqual([]);
  });
});

describe("src pairs no label with the old primary fill", () => {
  it("has no misuse of --primary anywhere", () => {
    const problems: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true })) {
      const rel = String(entry);
      if (!/\.(tsx?|css)$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
      const source = readFileSync(path.join(SRC, rel), "utf8");
      problems.push(...findPrimaryMisuse(`src/${rel}`, source));
    }
    expect(problems).toEqual([]);
  });
});
