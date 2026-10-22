import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Functions crossing the React Server Component boundary.
 *
 * A Server Component serialises every prop it hands to a Client Component or
 * a DOM element, and a function cannot be serialised: Next throws "Event
 * handlers cannot be passed to Client Component props" and the route renders
 * its error boundary. jsdom tests render everything on the client, so they
 * never see it; round 3's Button crashed /brand that way with a green suite.
 *
 * This finds the modules Next renders on the server (every route file without
 * "use client", and everything they import until an import reaches a
 * "use client" module) and, in each, every JSX prop or child whose value is a
 * function created in that module. Server actions ("use server") are allowed;
 * a prop the component received and passes on is the caller's to answer for.
 */

const ROUTE_FILES = new Set([
  "page",
  "layout",
  "template",
  "default",
  "not-found",
  "global-not-found",
  "loading",
  "forbidden",
  "unauthorized",
]);
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

export function hasDirective(
  statements: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
  directive: "use client" | "use server",
): boolean {
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === directive) return true;
  }
  return false;
}

function parse(file: string, source = readFileSync(file, "utf8")) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function resolveImport(
  from: string,
  specifier: string,
  srcRoot: string,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(from), specifier);
  } else return null;
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Route files that render on the server, i.e. that carry no "use client". */
export function serverEntries(srcRoot: string): string[] {
  return walk(path.join(srcRoot, "app")).filter((file) => {
    const match = /\/([\w-]+)\.tsx$/.exec(file);
    if (!match || !ROUTE_FILES.has(match[1])) return false;
    return !hasDirective(parse(file).statements, "use client");
  });
}

/** Every module rendered on the server: the entries and what they import,
 * stopping at "use client" modules, which are where the boundary sits. */
export function serverModules(srcRoot: string): string[] {
  const seen = new Set<string>();
  const queue = serverEntries(srcRoot);
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file) || /\.test\.tsx?$/.test(file)) continue;
    const sf = parse(file);
    if (hasDirective(sf.statements, "use client")) continue;
    seen.add(file);
    for (const statement of sf.statements) {
      const specifier =
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      if (
        !specifier ||
        (ts.isImportDeclaration(statement) &&
          statement.importClause?.isTypeOnly)
      ) {
        continue;
      }
      const target = resolveImport(file, specifier, srcRoot);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

const isServerAction = (fn: FunctionNode) =>
  !!fn.body &&
  ts.isBlock(fn.body) &&
  hasDirective(fn.body.statements, "use server");

/** The declaration `name` refers to at `from`, scope by scope outwards. */
function lookup(name: string, from: ts.Node): ts.Node | null {
  const bindsName = (binding: ts.BindingName): boolean =>
    ts.isIdentifier(binding)
      ? binding.text === name
      : binding.elements.some(
          (element) =>
            !ts.isOmittedExpression(element) && bindsName(element.name),
        );
  for (let scope: ts.Node | undefined = from; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (bindsName(parameter.name)) return parameter;
      }
    }
    const statements =
      ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : null;
    for (const statement of statements ?? []) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === name
      ) {
        return statement;
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (bindsName(declaration.name)) return declaration;
        }
      }
    }
  }
  return null;
}

/** The function a prop value evaluates to, when it is one made in this
 * module and not a server action. */
function createdFunction(expression: ts.Expression): FunctionNode | null {
  let e: ts.Expression = expression;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression;
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    return isServerAction(e) ? null : e;
  }
  if (ts.isConditionalExpression(e)) {
    return createdFunction(e.whenTrue) ?? createdFunction(e.whenFalse);
  }
  if (
    ts.isBinaryExpression(e) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(e.operatorToken.kind)
  ) {
    return createdFunction(e.left) ?? createdFunction(e.right);
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === "bind"
  ) {
    return createdFunction(e.expression.expression);
  }
  if (ts.isIdentifier(e)) {
    const declaration = lookup(e.text, e);
    if (!declaration) return null;
    if (ts.isFunctionDeclaration(declaration)) {
      return isServerAction(declaration) ? null : declaration;
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return ts.isIdentifier(declaration.name)
        ? createdFunction(declaration.initializer)
        : null;
    }
  }
  return null;
}

export interface Crossing {
  file: string;
  line: number;
  element: string;
  prop: string;
}

const tagName = (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string => node.tagName.getText();

export function functionPropsCrossing(
  file: string,
  source?: string,
): Crossing[] {
  const sf = parse(file, source);
  if (hasDirective(sf.statements, "use client")) return [];
  const found: Crossing[] = [];
  const report = (node: ts.Node, element: string, prop: string) => {
    found.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      element,
      prop,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : undefined;
      if (value && createdFunction(value)) {
        report(node, tagName(node.parent.parent), node.name.getText());
      }
    }
    if (
      ts.isJsxExpression(node) &&
      ts.isJsxElement(node.parent) &&
      node.expression &&
      createdFunction(node.expression)
    ) {
      report(node, tagName(node.parent.openingElement), "children");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
