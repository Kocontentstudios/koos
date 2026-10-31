import ts from "typescript";
import { boxesFromClasses, type Piece, splitVariants } from "./scan-classes";
import {
  ALWAYS_LABELLED,
  type Box,
  boxFromDecls,
  type Context,
  checkGrounds,
  checkTextColors,
  declsOf,
  emptyBox,
  FADE_IN_CLASSES,
  FADE_ON_FILL,
  FILL_IN_CLASSES,
  type FillComponent,
  fades,
  IMAGE_OF_TEXT,
  isLoadingPaint,
  LOADING_PAINT,
  maxAlpha,
  type Paint,
  paintFrom,
  SVG_TEXT_IN_DATA_URI,
} from "./scan-model";

/** Every literal string under a node, tagged with the conditional branch it
 * sits in, so pieces from opposite branches are never paired. */
export function stringPieces(
  node: ts.Node,
  cond: ts.Node | null = null,
): Piece[] {
  const pieces: Piece[] = [];
  const visit = (n: ts.Node, c: ts.Node | null) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      pieces.push({ text: n.text, cond: c });
      return;
    }
    if (ts.isTemplateExpression(n)) {
      pieces.push({ text: n.head.text, cond: c });
      for (const span of n.templateSpans) {
        visit(span.expression, c);
        pieces.push({ text: span.literal.text, cond: c });
      }
      return;
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.condition, c);
      visit(n.whenTrue, n.whenTrue);
      visit(n.whenFalse, n.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(n.operatorToken.kind)
    ) {
      visit(n.left, c);
      visit(n.right, n.right);
      return;
    }
    ts.forEachChild(n, (child) => visit(child, c));
  };
  visit(node, cond);
  return pieces;
}

export function styleObjectDecls(
  expression: ts.Expression,
): [string, string][] {
  if (!ts.isObjectLiteralExpression(expression)) return [];
  const decls: [string, string][] = [];
  for (const prop of expression.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name.getText().replace(/["']/g, "");
    const value = stringPieces(prop.initializer)
      .map((p) => p.text)
      .join(" ");
    if (!value) continue;
    decls.push([name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value]);
  }
  return decls;
}

export type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

export const isJsx = (n: ts.Node): n is JsxNode =>
  ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);

export function tagOf(node: JsxNode): string {
  return (
    ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  ).getText();
}

export function attributesOf(node: JsxNode): ts.JsxAttributes {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
}

export function elementBoxes(ctx: Context, node: JsxNode): Map<string, Box> {
  let classPieces: Piece[] = [];
  let styleDecls: [string, string][] = [];
  const attrFills: Paint[] = [];
  for (const attr of attributesOf(node).properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
    const name = attr.name.getText();
    if (name === "className" || name === "class") {
      classPieces = stringPieces(attr.initializer);
    } else if (
      name === "style" &&
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression
    ) {
      styleDecls = styleObjectDecls(attr.initializer.expression);
    } else if (name === "fill") {
      for (const piece of stringPieces(attr.initializer)) {
        const paint = paintFrom(
          ctx,
          piece.text,
          1,
          `fill="${piece.text}"`,
          piece.cond,
        );
        if (paint) attrFills.push(paint);
      }
    }
  }
  const boxes = boxesFromClasses(ctx, classPieces);
  const own = boxes.get("") ?? emptyBox();
  const fromStyle = boxFromDecls(ctx, styleDecls);
  own.grounds.push(...fromStyle.grounds);
  own.stops.push(...fromStyle.stops);
  own.texts.push(...fromStyle.texts);
  own.fills.push(...fromStyle.fills, ...attrFills);
  own.clipText ||= fromStyle.clipText;
  boxes.set("", own);
  return boxes;
}

export function jsxChildren(node: JsxNode): ts.Node[] {
  return ts.isJsxElement(node) ? [...node.children] : [];
}

export const SVG_TEXT = /^(?:text|tspan|textPath)$/;

export function containsSvgText(node: JsxNode): boolean {
  if (SVG_TEXT.test(tagOf(node))) return true;
  return jsxChildren(node).some((c) => isJsx(c) && containsSvgText(c));
}

/** Whether anything readable renders inside: literal text, an interpolated
 * value, or a descendant element that has either. */
export function carriesLabel(node: JsxNode): boolean {
  return jsxChildren(node).some((child) => {
    if (ts.isJsxText(child)) return child.text.trim() !== "";
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    if (isJsx(child)) return carriesLabel(child) || SVG_TEXT.test(tagOf(child));
    if (ts.isJsxFragment(child)) {
      return child.children.some(
        (c) => !ts.isJsxText(c) || c.text.trim() !== "",
      );
    }
    return false;
  });
}

/** Text colours set inside an element, down to any descendant that paints a
 * ground of its own (its labels sit on that, not on this). */
export function descendantTexts(ctx: Context, node: JsxNode): Paint[] {
  const out: Paint[] = [];
  for (const child of jsxChildren(node)) {
    if (!isJsx(child)) continue;
    const own = elementBoxes(ctx, child).get("") ?? emptyBox();
    const opaqueGround = [...own.grounds, ...own.stops].some(
      (g) => maxAlpha(g) >= 1,
    );
    if (opaqueGround) continue;
    /* group-hover on a child answers to this element's hover. */
    out.push(
      ...[...own.texts, ...descendantTexts(ctx, child)].map((p) => ({
        ...p,
        variants: p.variants.map((v) => v.replace(/^group-/, "")),
      })),
    );
  }
  return out;
}

function attribute(node: JsxNode, ...names: string[]) {
  for (const attr of attributesOf(node).properties) {
    if (ts.isJsxAttribute(attr) && names.includes(attr.name.getText())) {
      return attr;
    }
  }
  return null;
}

function classText(node: JsxNode): string {
  const attr = attribute(node, "className", "class");
  if (!attr?.initializer) return "";
  return stringPieces(attr.initializer)
    .map((p) => p.text)
    .join(" ");
}

/** The values an expression can take when every one is a literal (a string,
 * a number, or a conditional between them); null when any is not. */
function literalValues(e: ts.Expression): string[] | null {
  if (ts.isParenthesizedExpression(e)) return literalValues(e.expression);
  if (ts.isNumericLiteral(e)) return [e.text];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return [e.text];
  }
  if (ts.isConditionalExpression(e)) {
    const a = literalValues(e.whenTrue);
    const b = literalValues(e.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

/** Whether a component or class helper that paints a fill (the shared
 * Button, buttonVariants) is set to a fill variant. A variant that is not a
 * literal may be one, so it counts. */
function picksFillVariant(
  component: FillComponent,
  value: ts.Expression | undefined,
): boolean {
  const values =
    value === undefined ? [component.defaultVariant] : literalValues(value);
  return (
    values === null || values.some((v) => component.fillVariants.includes(v))
  );
}

function jsxValue(attr: ts.JsxAttribute | null): ts.Expression | undefined {
  if (!attr?.initializer) return undefined;
  if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression;
  return attr.initializer as ts.Expression;
}

function paintsFillItself(ctx: Context, node: JsxNode): boolean {
  if (FILL_IN_CLASSES.test(classText(node))) return true;
  const components = ctx.policy.fillComponents ?? {};
  const own = components[tagOf(node)];
  if (
    own &&
    picksFillVariant(own, jsxValue(attribute(node, own.variantProp)))
  ) {
    return true;
  }
  const classes = jsxValue(attribute(node, "className", "class"));
  let viaHelper = false;
  const visit = (n: ts.Node) => {
    if (viaHelper) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const helper = components[n.expression.text];
      if (helper) {
        const options = n.arguments[0];
        const variant =
          options && ts.isObjectLiteralExpression(options)
            ? options.properties.find(
                (p): p is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(p) &&
                  p.name.getText() === helper.variantProp,
              )?.initializer
            : undefined;
        if (picksFillVariant(helper, variant)) viaHelper = true;
      }
    }
    ts.forEachChild(n, visit);
  };
  if (classes) visit(classes);
  return viaHelper;
}

function paintsFill(ctx: Context, node: JsxNode): boolean {
  return (
    paintsFillItself(ctx, node) ||
    jsxChildren(node).some((c) => isJsx(c) && paintsFill(ctx, c))
  );
}

/* An opacity, filter or blend mode in a style object. A value that is not a
   literal is unknown, and counts: an animated opacity on a labelled fill is
   still a fade. A conditional between literals is read per branch. */
function styleFades(node: JsxNode): boolean {
  const style = jsxValue(attribute(node, "style"));
  if (!style || !ts.isObjectLiteralExpression(style)) return false;
  const FADE_PROPS = new Set(["opacity", "filter", "mixBlendMode"]);
  for (const prop of style.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name.getText().replace(/["']/g, "");
    if (!FADE_PROPS.has(name)) continue;
    const values = literalValues(prop.initializer);
    if (values === null) return true;
    const css = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    if (fades(values.map((v) => [css, v]))) return true;
  }
  return false;
}

function fadesElement(ctx: Context, node: JsxNode): boolean {
  const classes = classText(node);
  if (FADE_IN_CLASSES.test(classes)) return true;
  const fading = ctx.policy.fadingClasses;
  if (fading?.size) {
    for (const token of classes.split(/\s+/)) {
      const name = token.split(":").at(-1)?.replace(/^!/, "") ?? "";
      if (fading.has(name)) return true;
    }
  }
  return styleFades(node);
}

export const INLINE_STYLE = /style\s*=\s*\\?(["'])([\s\S]*?)\\?\1/g;

export function scanTs(
  ctx: Context,
  fileName: string,
  source: string,
): string[] {
  const problems: string[] = [];
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const report = (node: ts.Node, why: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    problems.push(`${fileName}:${line + 1} ${why}`);
  };

  const visit = (node: ts.Node) => {
    if (isJsx(node)) {
      if (
        fadesElement(ctx, node) &&
        carriesLabel(node) &&
        paintsFill(ctx, node)
      ) {
        report(node, FADE_ON_FILL);
      }
      const boxes = elementBoxes(ctx, node);
      const svgText = containsSvgText(node);
      for (const [key, box] of boxes) {
        const texts =
          key === ""
            ? [...box.texts, ...descendantTexts(ctx, node)]
            : box.texts.length > 0
              ? box.texts
              : (boxes.get("")?.texts ?? []);
        /* An icon-only button still has a label colour: the icon is drawn in
           it, and an icon needs the same ground the text would. */
        const labelled =
          key === ""
            ? carriesLabel(node) || texts.length > 0
            : ALWAYS_LABELLED.has(key) || box.content;
        for (const why of [
          ...checkTextColors(ctx, box, key === "" && svgText),
          ...checkGrounds(ctx, box, labelled, texts),
        ]) {
          report(node, why);
        }
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
      for (const value of ctx.policy.retiredValues) {
        if (new RegExp(`${value}(?![0-9a-f])`, "i").test(text)) {
          report(node, `retired brand value ${value}`);
        }
      }
      const hit = ctx.policy.retiredTokens.exec(text);
      if (hit) report(node, `retired token ${hit[0]}`);
      if (SVG_TEXT_IN_DATA_URI.test(text)) report(node, IMAGE_OF_TEXT);
      for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const { variants, utility } = splitVariants(token);
        if (isLoadingPaint(variants, utility)) {
          report(node, `${LOADING_PAINT} (${token})`);
        }
      }

      const boxes = boxesFromClasses(ctx, [{ text, cond: null }]);
      for (const [key, box] of boxes) {
        const labelled =
          box.texts.length > 0 ||
          box.content ||
          (key !== "" && ALWAYS_LABELLED.has(key));
        const texts =
          box.texts.length > 0 ? box.texts : (boxes.get("")?.texts ?? []);
        for (const why of [
          ...checkTextColors(ctx, box, false),
          ...checkGrounds(ctx, box, labelled, texts),
        ]) {
          report(node, why);
        }
      }
      for (const [, , body] of text.matchAll(INLINE_STYLE)) {
        const box = boxFromDecls(ctx, declsOf(body));
        for (const why of [
          ...checkTextColors(ctx, box, false),
          ...checkGrounds(ctx, box, true, box.texts),
        ]) {
          report(node, `inline CSS: ${why}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}
