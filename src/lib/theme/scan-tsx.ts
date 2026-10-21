import ts from "typescript";
import { boxesFromClasses, type Piece } from "./scan-classes";
import {
  ALWAYS_LABELLED,
  type Box,
  boxFromDecls,
  type Context,
  checkGrounds,
  checkTextColors,
  declsOf,
  emptyBox,
  maxAlpha,
  type Paint,
  paintFrom,
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
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const report = (node: ts.Node, why: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    problems.push(`${fileName}:${line + 1} ${why}`);
  };

  const visit = (node: ts.Node) => {
    if (isJsx(node)) {
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
