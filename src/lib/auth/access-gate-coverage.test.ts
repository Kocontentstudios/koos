import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The access gate is only as strong as its least-guarded entry point. Every
 * gated guard is enforced in exactly four places (the dashboard layout,
 * requireBrand, guardWorkspaceRoute and checkBrandAccess), so a new route or
 * server action that reaches the database through some other path silently
 * lets an unpaid account spend AI credit. This walks every route handler and
 * every dashboard server action and fails until each one either calls a gated
 * guard — directly or through a helper in the same file — or is on the
 * allow-list below with the reason it does not need one.
 *
 * A redirecting guard (requireOpenWorkspace, requireBrand) counts when
 * called. A verdict guard (checkBrandAccess, guardWorkspaceRoute,
 * isActiveWorkspaceOpen) counts only when awaited and read (`.ok`,
 * `"response" in`) in an if of the same function whose branch returns, throws
 * or redirects, or handed back to a caller held to the same rule.
 *
 * Routes and actions under admin/ (or api/admin/) are staff-only instead:
 * every handler must test the caller's own `dbUser.role` (or isStaff /
 * requireRole) so that the branch a non-staff caller takes denies.
 *
 * Review must still prove what static analysis cannot: that the guard runs on
 * every branch, and before the spend. Some correct shapes are rejected on
 * purpose (it fails closed): checking a batch inside Promise.all callbacks, a
 * throwing assert-style helper, a page whose guard lives in a child
 * component. Write those as a plain guard in the handler instead.
 */

/** Route files that are deliberately ungated, keyed by path under src/app. */
const UNGATED_ROUTES: Record<string, string> = {
  "(auth)/auth/callback/route.ts":
    "OAuth sign-in callback; runs before there is a workspace",
  "api/auth/clear/route.ts": "clears a dead session cookie; no account yet",
  "api/auth/logout/route.ts": "a pending account must be able to sign out",
  "api/contact/route.ts": "public marketing contact form",
  "api/health/route.ts": "public uptime probe",
  "api/notifications/route.ts": "the caller's own inbox; no spend",
  "api/notifications/read/route.ts": "marks the caller's own inbox read",
  "api/tour/complete/route.ts": "per-user UI flag",
  "api/welcome/dismiss/route.ts": "per-user UI flag",
  "api/workspace/switch/route.ts":
    "the gate page uses it to move a pending user into an approved workspace",
};

/** Next route segment config, not handlers. */
const ROUTE_CONFIG_EXPORTS = new Set([
  "maxDuration",
  "dynamic",
  "runtime",
  "revalidate",
  "fetchCache",
  "preferredRegion",
]);

/** Server actions that are deliberately ungated, keyed "file#export". */
const UNGATED_ACTIONS: Record<string, string> = {
  "(dashboard)/settings/actions.ts#updateProfileAction":
    "account self-service; no workspace data",
  "(dashboard)/settings/actions.ts#changePasswordAction":
    "account self-service; no workspace data",
  "invite/actions.ts#acceptInviteAction":
    "joins a workspace whose admin already passed the gate to invite them",
};

const APP = path.join(process.cwd(), "src", "app");

function filesUnder(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

/* Parsed with the TypeScript compiler rather than regexes: a string such as
   "image/*" or a guard named in a comment fooled the regex version, and every
   export form has to be accounted for, not just the ones a pattern expects. */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "policed.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
  );
}

interface Unit {
  name: string;
  exported: boolean;
  /** The page or layout component Next renders. */
  isDefault: boolean;
  isAsync: boolean;
  body: ts.Node;
}

const ROUTE_FILE = /^route\.[jt]sx?$/;
const PAGE_FILE = /^page\.[jt]sx?$/;
const LAYOUT_FILE = /^layout\.[jt]sx?$/;

/** Top-level functions, plus `const x = () => …` helpers a handler may call. */
function unitsIn(file: ts.SourceFile): Unit[] {
  const units: Unit[] = [];
  // `const Page = async () => …; export default Page` names the component.
  const defaultName = file.statements
    .filter(ts.isExportAssignment)
    .map((st) => (ts.isIdentifier(st.expression) ? st.expression.text : null))
    .find(Boolean);
  for (const st of file.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) {
      const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
      units.push({
        name: st.name?.text ?? "default",
        exported: hasModifier(st, ts.SyntaxKind.ExportKeyword) && !isDefault,
        isDefault,
        isAsync: hasModifier(st, ts.SyntaxKind.AsyncKeyword),
        body: st.body,
      });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (
          ts.isIdentifier(d.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          units.push({
            name: d.name.text,
            exported: false,
            isDefault: d.name.text === defaultName,
            isAsync: hasModifier(init, ts.SyntaxKind.AsyncKeyword),
            body: init,
          });
        }
      }
    }
  }
  return units;
}

/* Two kinds of guard. A redirecting guard (requireOpenWorkspace,
   requireBrand) throws on failure, so calling it at all is enough. A verdict
   guard returns ok/denied, and only gates if that verdict is awaited and then
   tested in a condition, or handed back to a caller that tests it. */
const REDIRECT_GUARDS = new Set(["requireOpenWorkspace", "requireBrand"]);
const VERDICT_GUARDS = new Set([
  "checkBrandAccess",
  "guardWorkspaceRoute",
  "isActiveWorkspaceOpen",
]);
const SYNC_VERDICT_GUARDS = new Set(["isActiveWorkspaceOpen"]);

/* checkBrandAccess and guardWorkspaceRoute return an object, which is always
   truthy: only `.ok` or `"response" in x` actually reads the verdict. */
const OBJECT_VERDICT_GUARDS = new Set([
  "checkBrandAccess",
  "guardWorkspaceRoute",
]);

/** Calls that end the request, so an if whose branch makes one denies. */
const TERMINATORS = new Set([
  "redirect",
  "redirectToLogin",
  "notFound",
  "forbidden",
  "unauthorized",
]);

function denies(st: ts.Statement | undefined): boolean {
  if (!st) return false;
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) return true;
  if (ts.isBlock(st)) return st.statements.some(denies);
  return (
    ts.isExpressionStatement(st) &&
    ts.isCallExpression(st.expression) &&
    ts.isIdentifier(st.expression.expression) &&
    TERMINATORS.has(st.expression.expression.text)
  );
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let cur = node.parent;
  while (cur && !ts.isFunctionLike(cur)) cur = cur.parent;
  return cur;
}

const ownerOf = (unit: Unit) =>
  ts.isBlock(unit.body) ? unit.body.parent : unit.body;

type Read = "deny" | "handback" | null;

/**
 * Where a value derived from a verdict ends up: the test of an if in this
 * function whose branch returns, throws or redirects ("deny"), or a ?: that
 * this function returns ("handback"). A test that only logs, or one inside a
 * nested callback, denies nothing.
 */
function conditionRead(node: ts.Node, owner: ts.Node): Read {
  let cur = node;
  while (cur.parent) {
    const p = cur.parent;
    if (ts.isIfStatement(p) && p.expression === cur) {
      const own = enclosingFunction(p) === owner;
      return own && (denies(p.thenStatement) || denies(p.elseStatement))
        ? "deny"
        : null;
    }
    if (ts.isReturnStatement(p) && enclosingFunction(p) === owner) {
      return "handback";
    }
    if (ts.isConditionalExpression(p) && p.condition === cur) {
      let top: ts.Node = p;
      while (ts.isParenthesizedExpression(top.parent)) top = top.parent;
      const returned =
        ts.isReturnStatement(top.parent) ||
        (ts.isArrowFunction(top.parent) && top.parent.body === top);
      return returned && enclosingFunction(p) === owner ? "handback" : null;
    }
    if (
      ts.isPrefixUnaryExpression(p) ||
      ts.isBinaryExpression(p) ||
      ts.isParenthesizedExpression(p) ||
      ts.isAwaitExpression(p) ||
      (ts.isPropertyAccessExpression(p) && p.expression === cur)
    ) {
      cur = p;
      continue;
    }
    return null;
  }
  return null;
}

/** For an object verdict, the node that actually reads it (`v.ok`, `"k" in v`). */
function objectRead(node: ts.Node): ts.Node | null {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === node) {
    return p.name.text === "ok" ? p : null;
  }
  if (
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    p.right === node
  ) {
    return p;
  }
  return null;
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((e) =>
    ts.isBindingElement(e) ? boundNames(e.name) : [],
  );
}

/** The declaration whose initializer `node` feeds, e.g. `x` in `const x = a.ok`. */
function feedsDeclaration(node: ts.Node): ts.VariableDeclaration | null {
  let cur = node;
  while (cur.parent) {
    const p = cur.parent;
    if (ts.isVariableDeclaration(p) && p.initializer === cur) return p;
    if (
      ts.isPrefixUnaryExpression(p) ||
      ts.isBinaryExpression(p) ||
      ts.isParenthesizedExpression(p) ||
      (ts.isPropertyAccessExpression(p) && p.expression === cur)
    ) {
      cur = p;
      continue;
    }
    return null;
  }
  return null;
}

const strongest = (a: Read, b: Read): Read =>
  a === "deny" || b === "deny" ? "deny" : (a ?? b);

/* Follows a verdict held in `name` through short alias chains such as
   `const isMember = access.ok; if (!isMember && !isStaff) return …`. */
function readOf(
  name: string,
  owner: ts.Node,
  objectShape: boolean,
  depth = 0,
): Read {
  let result: Read = null;
  const visit = (node: ts.Node) => {
    if (result === "deny") return;
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      !ts.isBindingElement(node.parent) &&
      !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)
    ) {
      const reader = objectShape ? objectRead(node) : node;
      if (reader) {
        result = strongest(result, conditionRead(reader, owner));
        const alias = feedsDeclaration(reader);
        if (alias && depth < 3) {
          for (const n of boundNames(alias.name)) {
            result = strongest(result, readOf(n, owner, false, depth + 1));
          }
        }
      } else if (objectShape) {
        const alias = feedsDeclaration(node);
        if (alias && ts.isIdentifier(alias.name) && depth < 3) {
          result = strongest(
            result,
            readOf(alias.name.text, owner, true, depth + 1),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return result;
}

/* "handed-back-raw": the verdict object itself is returned, so the caller
   inherits the obligation to read `.ok` rather than test truthiness. */
type Use = "consumed" | "handed-back" | "handed-back-raw" | "ignored";

/** What happens to a verdict: tested here, returned to a caller, or dropped. */
function verdictUse(
  call: ts.CallExpression,
  unit: Unit,
  mustAwait: boolean,
  objectShape: boolean,
): Use {
  const owner = ownerOf(unit);
  let node: ts.Node = call;
  let awaited = false;
  while (
    ts.isAwaitExpression(node.parent) ||
    ts.isParenthesizedExpression(node.parent)
  ) {
    if (ts.isAwaitExpression(node.parent)) awaited = true;
    node = node.parent;
  }
  const parent = node.parent;
  const ownCode = enclosingFunction(node) === owner;
  if (
    ownCode &&
    (ts.isReturnStatement(parent) ||
      (ts.isArrowFunction(parent) && parent.body === node))
  ) {
    return objectShape ? "handed-back-raw" : "handed-back";
  }
  // A Promise is always truthy, so an un-awaited verdict never denies.
  if (mustAwait && !awaited) return "ignored";
  const toUse = (r: Read): Use =>
    r === "deny" ? "consumed" : r === "handback" ? "handed-back" : "ignored";
  const direct = objectShape ? objectRead(node) : node;
  if (direct) {
    const r = conditionRead(direct, owner);
    if (r) return toUse(r);
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    const destructured = !ts.isIdentifier(parent.name);
    let r: Read = null;
    for (const n of boundNames(parent.name)) {
      r = strongest(r, readOf(n, owner, objectShape && !destructured));
    }
    return toUse(r);
  }
  return "ignored";
}

type Gate = "redirect" | "verdict" | "hands-back";

/**
 * Which units are gated, and how. Local helpers propagate: calling a
 * redirect-gated helper gates the caller; a helper that hands a verdict back
 * is itself a verdict guard, so its callers must test what it returns.
 */
function classify(units: Unit[]): Map<string, Gate> {
  const gates = new Map<string, Gate>();
  const objectHelpers = new Set<string>();
  const isAsync = new Map(units.map((u) => [u.name, u.isAsync]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (gates.get(unit.name) === "redirect") continue;
      let next: Gate | undefined = gates.get(unit.name);
      const visit = (node: ts.Node) => {
        if (next === "redirect") return;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const callee = node.expression.text;
          const helper = gates.get(callee);
          if (REDIRECT_GUARDS.has(callee) || helper === "redirect") {
            // Not awaited, the redirect lands after the handler has run on.
            const awaitedCall = ts.isAwaitExpression(node.parent);
            const mustAwait =
              REDIRECT_GUARDS.has(callee) || Boolean(isAsync.get(callee));
            if (awaitedCall || !mustAwait) {
              next = "redirect";
              return;
            }
          }
          // A helper that tests a verdict and returns the outcome is itself a
          // verdict guard to its caller, which must test what comes back.
          if (
            VERDICT_GUARDS.has(callee) ||
            helper === "hands-back" ||
            helper === "verdict"
          ) {
            const mustAwait = VERDICT_GUARDS.has(callee)
              ? !SYNC_VERDICT_GUARDS.has(callee)
              : Boolean(isAsync.get(callee));
            const use = verdictUse(
              node,
              unit,
              mustAwait,
              OBJECT_VERDICT_GUARDS.has(callee) || objectHelpers.has(callee),
            );
            if (use === "consumed") next = "verdict";
            else if (use !== "ignored" && next === undefined)
              next = "hands-back";
            if (use === "handed-back-raw" && !objectHelpers.has(unit.name)) {
              objectHelpers.add(unit.name);
              grew = true;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(unit.body);
      if (next !== gates.get(unit.name) && next !== undefined) {
        gates.set(unit.name, next);
        grew = true;
      }
    }
  }
  return gates;
}

const gatesRequest = (g: Gate | undefined) =>
  g === "redirect" || g === "verdict";

/** Exported functions that never reach a gated guard, even via a local helper. */
function ungatedExports(source: string): string[] {
  const units = unitsIn(parse(source));
  const gates = classify(units);
  return units
    .filter((u) => u.exported && !gatesRequest(gates.get(u.name)))
    .map((u) => u.name);
}

/* For a page or layout the component Next renders must gate itself; a guard
   in generateMetadata or a sibling export does not protect the render. */
function defaultExportGated(source: string): boolean {
  const units = unitsIn(parse(source));
  const gates = classify(units);
  const component = units.find((u) => u.isDefault);
  return Boolean(component) && gates.get(component?.name ?? "") === "redirect";
}

/** How a branch denies: by ending the request outright, or by returning. */
function denialKind(st: ts.Statement | undefined): "ends" | "returns" | null {
  if (!st) return null;
  if (ts.isThrowStatement(st)) return "ends";
  if (ts.isReturnStatement(st)) return "returns";
  if (ts.isBlock(st)) {
    const kinds = st.statements.map(denialKind);
    return kinds.includes("ends")
      ? "ends"
      : kinds.includes("returns")
        ? "returns"
        : null;
  }
  return denies(st) ? "ends" : null;
}

/**
 * The denial a caller-role test performs, if it denies the right people.
 * `isNonStaff` says whether the expression at `node` is true for a NON-staff
 * caller (`dbUser.role !== "admin"`, `!isStaff(dbUser)`); each `!` on the way
 * up flips it. The branch that runs for non-staff must be the one that denies:
 * `if (dbUser.role === "designer") return 403` blocks designers, not clients.
 */
function staffIfKind(
  node: ts.Node,
  owner: ts.Node,
  isNonStaff: boolean,
): StaffGate | null {
  let cur = node;
  let nonStaffWhenTrue = isNonStaff;
  while (cur.parent) {
    const p = cur.parent;
    if (ts.isIfStatement(p) && p.expression === cur) {
      if (enclosingFunction(p) !== owner) return null;
      const branch = nonStaffWhenTrue ? p.thenStatement : p.elseStatement;
      const kind = denialKind(branch);
      return kind === "ends" ? "ends" : kind === "returns" ? "returns" : null;
    }
    if (
      ts.isPrefixUnaryExpression(p) &&
      p.operator === ts.SyntaxKind.ExclamationToken
    ) {
      nonStaffWhenTrue = !nonStaffWhenTrue;
      cur = p;
      continue;
    }
    if (ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p)) {
      cur = p;
      continue;
    }
    return null;
  }
  return null;
}

/* "ends": denies by throwing or redirecting, so a bare awaited call is
   enough. "returns": hands a 403 back, so a caller that is not itself the
   handler must test what it returns, exactly like a verdict guard. */
type StaffGate = "ends" | "returns";

/* A staff check counts only when it tests the CALLER (`dbUser.role`, from
   getAuthUser) in an if of this unit whose branch denies. Comparing a
   request body's or an assignee's role, or a workspace role, gates nothing. */
function staffGateOf(
  unit: Unit,
  helpers: Map<string, StaffGate>,
): StaffGate | null {
  const owner = ownerOf(unit);
  let gate: StaffGate | null = null;
  const take = (g: StaffGate | null) => {
    if (g === "ends" || (g === "returns" && gate === null)) gate = g;
  };
  const isCallerRole = (n: ts.Node) =>
    ts.isPropertyAccessExpression(n) &&
    n.name.text === "role" &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "dbUser";
  const isStaffRole = (n: ts.Node) =>
    ts.isStringLiteral(n) && (n.text === "admin" || n.text === "designer");
  const visit = (node: ts.Node) => {
    if (gate === "ends") return;
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind) &&
      ((isCallerRole(node.left) && isStaffRole(node.right)) ||
        (isCallerRole(node.right) && isStaffRole(node.left)))
    ) {
      const notEqual =
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      take(staffIfKind(node, owner, notEqual));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const awaited = ts.isAwaitExpression(node.parent);
      const helper = helpers.get(callee);
      if ((callee === "requireRole" || helper === "ends") && awaited) {
        take("ends");
      } else if (helper === "returns") {
        const use = verdictUse(node, unit, true, false);
        if (use === "consumed") take("returns");
      } else if (callee === "isStaff") {
        take(staffIfKind(node, owner, false));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(unit.body);
  return gate;
}

/** Exported handlers of a staff-only route that never check the role. */
function unstaffedExports(source: string): string[] {
  const units = unitsIn(parse(source));
  const staff = new Map<string, StaffGate>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      const g = staffGateOf(u, staff);
      if (g && staff.get(u.name) !== g && staff.get(u.name) !== "ends") {
        staff.set(u.name, g);
        grew = true;
      }
    }
  }
  return units
    .filter((u) => u.exported && !staff.has(u.name))
    .map((u) => u.name);
}

/** "use server" inside a function body: an action Next exposes on its own. */
function inlineServerActions(source: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isBlock(node) &&
      node.statements.some(
        (st) =>
          ts.isExpressionStatement(st) &&
          ts.isStringLiteral(st.expression) &&
          st.expression.text === "use server",
      )
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return count;
}

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * Exports ungatedExports cannot follow, which would otherwise pass unchecked:
 * exported variables (arrow handlers, destructured `export const { GET }`),
 * `export default`, `export *`, and export lists. In a route a list only
 * matters when it names an HTTP method, and Next's segment config constants
 * are fine; in a "use server" file every export is an action.
 */
function unparsedExports(source: string, kind: "route" | "actions"): string[] {
  const found: string[] = [];
  for (const st of parse(source).statements) {
    const text = st.getText().split("\n")[0];
    if (
      ts.isVariableStatement(st) &&
      hasModifier(st, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of st.declarationList.declarations) {
        const configConst =
          kind === "route" &&
          ts.isIdentifier(d.name) &&
          ROUTE_CONFIG_EXPORTS.has(d.name.text);
        if (!configConst) found.push(d.name.getText());
      }
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
      hasModifier(st, ts.SyntaxKind.DefaultKeyword)
    ) {
      found.push(text);
    } else if (ts.isExportAssignment(st)) {
      found.push(text);
    } else if (ts.isExportDeclaration(st)) {
      const clause = st.exportClause;
      const namesMethod =
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.some((e) => HTTP_METHODS.has(e.name.text));
      if (!clause || !ts.isNamedExports(clause)) found.push(text);
      else if (kind === "actions" || namesMethod) found.push(text);
    }
  }
  return found;
}

/* Route groups like (staff) are not part of the URL, so they cannot hide an
   admin path from this check. */
const isAdminPath = (key: string) =>
  /^(api\/)?admin\//.test(key.replace(/\([^/]+\)\//g, ""));

const rel = (from: string, file: string) =>
  path.relative(from, file).split(path.sep).join("/");

describe("access gate coverage: route handlers", () => {
  // Every route.ts under src/app, not just api/: a handler can live anywhere.
  // Next serves route.ts, .tsx, .js and .jsx alike.
  const routes = filesUnder(APP, (n) => ROUTE_FILE.test(n));

  it("finds the route handlers it is meant to police", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  for (const file of routes) {
    const key = rel(APP, file);
    const source = readFileSync(file, "utf8");

    // Admin pages sit behind requireRole in their layout, but a layout never
    // runs for a route handler, so every admin handler checks the role itself.
    if (isAdminPath(key)) {
      it(`${key} checks the staff role in every handler`, () => {
        expect(unstaffedExports(source)).toEqual([]);
        expect(unparsedExports(source, "route")).toEqual([]);
      });
      continue;
    }
    if (key in UNGATED_ROUTES) continue;

    it(`${key} gates every handler`, () => {
      expect(ungatedExports(source)).toEqual([]);
      expect(unparsedExports(source, "route")).toEqual([]);
    });
  }

  it("has no stale allow-list entries", () => {
    const keys = new Set(routes.map((f) => rel(APP, f)));
    for (const allowed of Object.keys(UNGATED_ROUTES)) {
      expect(keys.has(allowed), allowed).toBe(true);
    }
  });
});

describe("access gate coverage: server actions", () => {
  const SRC = path.join(process.cwd(), "src");
  const actionFiles = filesUnder(
    SRC,
    (n) => /\.[jt]sx?$/.test(n) && !/\.test\.[jt]sx?$/.test(n),
  )
    .filter((f) => /^\s*["']use server["']/m.test(readFileSync(f, "utf8")))
    // Sign-in, sign-up and password reset run before there is a workspace.
    .filter((f) => !rel(APP, f).startsWith("(auth)/"));

  it("finds the server action files it is meant to police", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of actionFiles) {
    const key = rel(APP, file);
    it(`${key} gates every exported action`, () => {
      const source = readFileSync(file, "utf8");
      const ungated = ungatedExports(source).filter(
        (name) => !(`${key}#${name}` in UNGATED_ACTIONS),
      );
      expect(ungated).toEqual([]);
      expect(unparsedExports(source, "actions")).toEqual([]);
      if (isAdminPath(key)) {
        expect(unstaffedExports(source)).toEqual([]);
      }
    });
  }

  it("has no stale allow-list entries", () => {
    for (const allowed of Object.keys(UNGATED_ACTIONS)) {
      const [file, name] = allowed.split("#");
      const source = readFileSync(path.join(APP, file), "utf8");
      expect(source, allowed).toMatch(
        new RegExp(`export async function ${name}\\b`),
      );
    }
  });
});

describe("access gate coverage: inline server actions", () => {
  /* An action declared inside a component is callable on its own, so a guard
     in the surrounding component does not protect it. Keep actions in
     top-level "use server" files, where the checks above see them. */
  it("no file under src declares a server action inline", () => {
    const offenders = filesUnder(path.join(process.cwd(), "src"), (n) =>
      /\.tsx?$/.test(n),
    )
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => inlineServerActions(readFileSync(f, "utf8")) > 0)
      .map((f) => rel(APP, f));
    expect(offenders).toEqual([]);
  });
});

describe("access gate coverage: pages", () => {
  /* The layout alone is not enough: Next does not re-run a layout on client
     navigation, so a workspace revoked mid-session would keep browsing. */
  const pages = filesUnder(path.join(APP, "(dashboard)"), (n) =>
    PAGE_FILE.test(n),
  );

  it("finds the dashboard pages it is meant to police", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  for (const file of pages) {
    it(`${rel(APP, file)} gates itself, not only via the layout`, () => {
      expect(defaultExportGated(readFileSync(file, "utf8"))).toBe(true);
    });
  }

  /* Every dashboard page renders inside this layout, so it is the page-level
     gate. Resolving the workspace any other way here reopens every page. */
  for (const file of filesUnder(path.join(APP, "(dashboard)"), (n) =>
    LAYOUT_FILE.test(n),
  )) {
    it(`${rel(APP, file)} resolves its workspace through the gate`, () => {
      expect(defaultExportGated(readFileSync(file, "utf8"))).toBe(true);
    });
  }

  it("the dashboard layout resolves its workspace through the gate", () => {
    const layout = readFileSync(
      path.join(APP, "(dashboard)", "layout.tsx"),
      "utf8",
    );
    expect(layout).toMatch(/requireOpenWorkspace\(\)/);
    expect(layout).not.toMatch(/getActiveWorkspace\(\)/);
  });

  it("requireBrand resolves its workspace through the gate", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "auth", "require-brand.ts"),
      "utf8",
    );
    expect(source).toMatch(/requireOpenWorkspace\(\)/);
  });
});

/* The parser is only worth its allow-list if the shapes a future route could
   plausibly take cannot slip through it. Each case here passed an earlier
   version of this file with no guard at all. */
describe("access gate coverage: the parser itself", () => {
  it("flags one handler exported under several method names", () => {
    const src =
      "async function handler() {\n  return Response.json({});\n}\nexport { handler as GET, handler as POST };\n";
    expect(unparsedExports(src, "route")).not.toEqual([]);
  });

  it("flags an export list of server actions", () => {
    const src =
      "async function deleteBrandAction() {\n  return 1;\n}\nexport { deleteBrandAction };\n";
    expect(unparsedExports(src, "actions")).not.toEqual([]);
  });

  it("flags a default-exported server action", () => {
    expect(
      unparsedExports(
        "export default async function act() {\n  return 1;\n}\n",
        "actions",
      ),
    ).not.toEqual([]);
  });

  it("does not credit a handler with a guard written in a later helper", () => {
    const src = [
      "export async function POST() {",
      "  return Response.json({});",
      "}",
      "const gate = async () => checkBrandAccess(u, b, c);",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("does not count a guard named only in a comment", () => {
    const src =
      "export async function POST() {\n  /* checkBrandAccess( */\n  return 1;\n}\n";
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("follows a verdict through a local helper the caller tests", () => {
    const src = [
      "async function mayManage(b) {",
      "  return checkBrandAccess(u, b, c);",
      "}",
      "export async function act(b) {",
      "  const allowed = await mayManage(b);",
      "  if (!allowed.ok) return allowed;",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual([]);
  });

  it("rejects a helper's verdict the caller throws away", () => {
    const src = [
      "async function mayManage(b) {",
      "  return checkBrandAccess(u, b, c);",
      "}",
      "export async function act(b) {",
      "  await mayManage(b);",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["act"]);
  });

  it("rejects a verdict stored but never tested", () => {
    const src = [
      "export async function POST() {",
      "  const _access = await checkBrandAccess(u, b, c);",
      "  log({ _access });",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("rejects a verdict tested without being awaited", () => {
    const src = [
      "export async function POST() {",
      "  const access = checkBrandAccess(u, b, c);",
      "  if (!access) return deny();",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("accepts the repo's guard idioms", () => {
    const src = [
      "export async function GET() {",
      "  const guard = await guardWorkspaceRoute();",
      '  if ("response" in guard) return guard.response;',
      "  return ok();",
      "}",
      "export async function POST() {",
      "  const access = await checkBrandAccess(u, b, c);",
      "  if (!access.ok) return deny(access);",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual([]);
  });

  it("requires the rendered page, not generateMetadata, to gate", () => {
    const src = [
      "export async function generateMetadata() {",
      "  await requireOpenWorkspace();",
      "  return {};",
      "}",
      "export default async function Page() {",
      "  return load();",
      "}",
      "",
    ].join("\n");
    expect(defaultExportGated(src)).toBe(false);
  });

  it("counts an inline server action", () => {
    const src = [
      "export default function Page() {",
      "  async function act() {",
      '    "use server";',
      "    return spend();",
      "  }",
      "  return null;",
      "}",
      "",
    ].join("\n");
    expect(inlineServerActions(src)).toBe(1);
  });

  it("is not fooled by a comment-like string ahead of an ungated handler", () => {
    const src = [
      'const ACCEPT = "image/*";',
      "export async function POST() {",
      "  return Response.json({ ACCEPT });",
      "}",
      "/** docs */",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("flags destructured handlers", () => {
    expect(
      unparsedExports("export const { GET, POST } = handlers;\n", "route"),
    ).not.toEqual([]);
  });

  it("flags a star re-export from a route", () => {
    expect(
      unparsedExports('export * from "./handlers";\n', "route"),
    ).not.toEqual([]);
  });

  it("does not count a guard whose verdict is thrown away", () => {
    const src = [
      "export async function POST() {",
      "  await checkBrandAccess(u, b, c);",
      "  return spend();",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("counts a redirecting guard even as a bare call", () => {
    const src = [
      "export async function act() {",
      "  await requireOpenWorkspace();",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    expect(ungatedExports(src)).toEqual([]);
  });

  it("allows Next segment config in a route", () => {
    expect(
      unparsedExports("export const maxDuration = 60;\n", "route"),
    ).toEqual([]);
  });

  const handler = (...body: string[]) =>
    ["export async function POST() {", ...body, "}", ""].join("\n");

  it("rejects a tested verdict whose branch forgets to return", () => {
    const src = handler(
      "  const access = await checkBrandAccess(u, b, c);",
      "  if (!access.ok) {",
      "    Response.json({ error: access.error }, { status: 403 });",
      "  }",
      "  return spend();",
    );
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("rejects a tested verdict that only logs", () => {
    const src = handler(
      "  const access = await checkBrandAccess(u, b, c);",
      "  if (!access.ok) logger.warn(access.error);",
      "  return spend();",
    );
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("rejects a ternary that computes a value instead of denying", () => {
    const src = handler(
      "  const access = await checkBrandAccess(u, b, c);",
      '  const label = access.ok ? access.brand.name : "x";',
      "  return spend(label);",
    );
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("rejects the truthiness of an always-truthy verdict object", () => {
    const src = handler(
      "  const access = await checkBrandAccess(u, b, c);",
      "  if (!access) return deny();",
      "  return spend();",
    );
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("does not treat a verdict returned from a nested callback as handed back", () => {
    const src = [
      "async function checkAll(ids) {",
      "  await Promise.all(ids.map((id) => checkBrandAccess(u, id, c)));",
      "  return ids;",
      "}",
      handler(
        "  const ids = await checkAll(list);",
        "  if (!ids.length) return deny();",
        "  return spend();",
      ),
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("accepts the redirecting and aliased idioms the repo uses", () => {
    const src = handler(
      "  const access = await checkBrandAccess(u, b, c);",
      "  const isMember = access.ok;",
      "  if (!isMember && !isStaff) {",
      "    return deny();",
      "  }",
      "  return spend();",
    );
    expect(ungatedExports(src)).toEqual([]);
  });

  it("finds the component behind `export default Page`", () => {
    const src = [
      "const Page = async () => {",
      "  await requireOpenWorkspace();",
      "  return null;",
      "};",
      "export default Page;",
      "",
    ].join("\n");
    expect(defaultExportGated(src)).toBe(true);
  });

  it("discovers every route, page and layout extension Next serves", () => {
    for (const ext of ["ts", "tsx", "js", "jsx"]) {
      expect(ROUTE_FILE.test(`route.${ext}`)).toBe(true);
      expect(PAGE_FILE.test(`page.${ext}`)).toBe(true);
      expect(LAYOUT_FILE.test(`layout.${ext}`)).toBe(true);
    }
  });

  it("checks the staff role per admin handler, not per file", () => {
    const src = [
      "export async function GET() {",
      '  if (dbUser?.role !== "admin") return forbidden();',
      "  return ok();",
      "}",
      "export async function DELETE() {",
      "  // isStaff( is only mentioned here",
      "  return destroy();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["DELETE"]);
  });

  it("flags an arrow handler in a staff-only route", () => {
    const src = "export const POST = async () => destroy();\n";
    expect(unstaffedExports(src)).toEqual([]);
    expect(unparsedExports(src, "route")).toEqual(["POST"]);
  });

  it("rejects a redirecting guard that is not awaited", () => {
    const src = handler("  requireOpenWorkspace();", "  return spend();");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("holds a helper's raw verdict object to the .ok rule", () => {
    const src = [
      "async function access(b) {",
      "  return checkBrandAccess(u, b, c);",
      "}",
      handler(
        "  const a = await access(b);",
        "  if (!a) return deny();",
        "  return spend();",
      ),
    ].join("\n");
    expect(ungatedExports(src)).toEqual(["POST"]);
  });

  it("accepts a helper that hands back access.ok as a boolean", () => {
    const src = [
      "async function canManage(b) {",
      "  const access = await checkBrandAccess(u, b, c);",
      "  return access.ok;",
      "}",
      handler(
        "  if (!(await canManage(b))) return deny();",
        "  return spend();",
      ),
    ].join("\n");
    expect(ungatedExports(src)).toEqual([]);
  });

  it("does not take a request body's role for the caller's", () => {
    const src = [
      "export async function POST() {",
      "  const body = await req.json();",
      '  if (body.role !== "admin") return bad();',
      "  return promote(body);",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["POST"]);
  });

  it("does not take an assignee's role check for a caller check", () => {
    const src = [
      "export async function PATCH() {",
      '  if (assignee.role !== "designer" && assignee.role !== "admin") {',
      "    return bad();",
      "  }",
      "  return assign();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["PATCH"]);
  });

  it("rejects a caller role check whose branch forgets to return", () => {
    const src = [
      "export async function POST() {",
      '  if (dbUser?.role !== "admin") {',
      '    Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "  return destroy();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["POST"]);
  });

  it("accepts the admin routes' real caller check", () => {
    const src = [
      "export async function POST() {",
      "  const { dbUser } = await getAuthUser();",
      '  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {',
      '    return Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "  return ok();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual([]);
  });

  it("rejects a staff helper's 403 the handler throws away", () => {
    const src = [
      "async function requireAdmin() {",
      "  const { dbUser } = await getAuthUser();",
      '  if (dbUser?.role !== "admin") {',
      '    return Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "  return null;",
      "}",
      "export async function POST() {",
      "  await requireAdmin();",
      "  return destroy();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["POST"]);
  });

  it("accepts a staff helper whose 403 the handler returns", () => {
    const src = [
      "async function denyUnlessAdmin() {",
      "  const { dbUser } = await getAuthUser();",
      '  if (dbUser?.role !== "admin") {',
      '    return Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "  return null;",
      "}",
      "export async function POST() {",
      "  const denied = await denyUnlessAdmin();",
      "  if (denied) return denied;",
      "  return destroy();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual([]);
  });

  it("accepts a staff helper that throws, called bare", () => {
    const src = [
      "async function assertAdmin() {",
      "  const { dbUser } = await getAuthUser();",
      '  if (dbUser?.role !== "admin") throw new Forbidden();',
      "}",
      "export async function POST() {",
      "  await assertAdmin();",
      "  return destroy();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual([]);
  });

  it("does not take a check that blocks designers for admins-only", () => {
    const src = [
      "export async function POST() {",
      "  const { dbUser } = await getAuthUser();",
      '  if (dbUser?.role === "designer") {',
      '    return Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "  return promote();",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual(["POST"]);
  });

  it("accepts the positive form with the denial in the else branch", () => {
    const src = [
      "export async function POST() {",
      '  if (dbUser?.role === "admin") {',
      "    return promote();",
      "  } else {",
      '    return Response.json({ error: "Forbidden" }, { status: 403 });',
      "  }",
      "}",
      "",
    ].join("\n");
    expect(unstaffedExports(src)).toEqual([]);
  });

  it("follows negation around isStaff", () => {
    const deny = (cond: string) =>
      [
        "export async function GET() {",
        `  if (${cond}) return forbidden();`,
        "  return list();",
        "}",
        "",
      ].join("\n");
    expect(unstaffedExports(deny("!isStaff(dbUser)"))).toEqual([]);
    expect(unstaffedExports(deny("isStaff(dbUser)"))).toEqual(["GET"]);
  });

  it("treats a route group in front of admin as an admin path", () => {
    expect(isAdminPath("(staff)/admin/export/route.ts")).toBe(true);
    expect(isAdminPath("api/admin/users/route.ts")).toBe(true);
    expect(isAdminPath("api/brand/admin-notes/route.ts")).toBe(false);
  });

  it("leaves a re-exported constant in a route alone", () => {
    expect(
      unparsedExports("export { MAX_CONVERSATION_TITLE };\n", "route"),
    ).toEqual([]);
  });
});
