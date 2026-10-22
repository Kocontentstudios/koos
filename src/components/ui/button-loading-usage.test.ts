import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/* Loading is not disabled (CLAUDE.md "Every wait gets an affordance"). A call
   site that also feeds its loading flag into `disabled` paints the primary
   button's disabled tokens under the "Saving…" label for the whole wait, which
   six call sites did until 2026-10-22. */

const SRC = path.join(process.cwd(), "src");

function flagOf(attr: ts.JsxAttribute | undefined): string | null {
  const init = attr?.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
  return init.expression.getText();
}

function identifiersIn(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      names.add(n.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

function loadingAlsoDisables(fileName: string, source: string) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === "Button"
    ) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const named = (name: string) =>
        attrs.find((a) => a.name.getText() === name);
      const loading = flagOf(named("loading"));
      const disabled = named("disabled")?.initializer;
      if (
        loading &&
        disabled &&
        ts.isJsxExpression(disabled) &&
        disabled.expression &&
        identifiersIn(disabled.expression).has(loading)
      ) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        problems.push(
          `${fileName}:${line + 1} disabled repeats loading={${loading}}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

describe("a loading Button is never also disabled by its own flag", () => {
  it("holds across src", () => {
    const problems: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true })) {
      const rel = String(entry);
      if (!rel.endsWith(".tsx") || rel.endsWith(".test.tsx")) continue;
      problems.push(
        ...loadingAlsoDisables(
          `src/${rel}`,
          readFileSync(path.join(SRC, rel), "utf8"),
        ),
      );
    }
    expect(problems).toEqual([]);
  });

  it.each([
    `<Button loading={pending} disabled={pending}>Save</Button>`,
    `<Button loading={pending} disabled={!ready || pending}>Save</Button>`,
    `<Button loading={form.saving} disabled={form.saving}>Save</Button>`,
  ])("flags %s", (tsx) => {
    expect(loadingAlsoDisables("fixture.tsx", tsx)).toHaveLength(1);
  });

  it.each([
    `<Button loading={pending} disabled={!ready}>Save</Button>`,
    `<Button loading={pending}>Save</Button>`,
    `<Button disabled={pending}>Save</Button>`,
  ])("leaves %s alone", (tsx) => {
    expect(loadingAlsoDisables("fixture.tsx", tsx)).toEqual([]);
  });
});
