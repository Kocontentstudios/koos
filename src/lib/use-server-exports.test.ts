import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function isUseServerModule(source: string): boolean {
  return /^\s*(["'])use server\1\s*;?/.test(source);
}

/** Value exports that aren't async functions. Type-only exports are erased at
 *  compile time, so they're allowed and deliberately not matched here. */
function illegalValueExports(source: string): string[] {
  const found: string[] = [];
  const declaration =
    /^export\s+(?!type\b|interface\b)(?:(const|let|var)\s+(\w+)\s*(?:[:=])|(class)\s+(\w+)|(default)\b)/gm;

  for (const match of source.matchAll(declaration)) {
    const [line, kind, name, classKind, className, defaultKind] = match;
    if (kind) {
      const rest = source.slice(match.index + line.length);
      // `export const foo = async (…) => …` is a legal server action.
      if (/^\s*async\s*(\(|function\b)/.test(rest)) continue;
      found.push(`${kind} ${name}`);
    } else if (classKind) {
      found.push(`${classKind} ${className}`);
    } else if (defaultKind) {
      found.push("default");
    }
  }
  return found;
}

/* Regression: exporting a plain string const from a "use server" module made
   Next drop EVERY export from it, so the server action alongside it vanished
   at runtime with "The module has no exports at all". Vitest imports these
   files as ordinary ES modules and honors no such rule, so no unit test on the
   action itself can catch it — only this scan can. */
describe('"use server" modules', () => {
  const modules = sourceFiles(SRC).filter((file) =>
    isUseServerModule(readFileSync(file, "utf8")),
  );

  it("finds the server-action modules to check", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(modules)("%s exports async functions only", (file) => {
    expect(illegalValueExports(readFileSync(file, "utf8"))).toEqual([]);
  });
});

describe("illegalValueExports", () => {
  it("flags a plain const, the exact shape that broke onboarding", () => {
    expect(
      illegalValueExports('export const NAME = "Untitled brand";'),
    ).toEqual(["const NAME"]);
  });

  it("allows an exported async arrow and async function", () => {
    expect(
      illegalValueExports(
        "export const a = async () => {};\nexport async function b() {}\n",
      ),
    ).toEqual([]);
  });

  it("allows type-only exports", () => {
    expect(
      illegalValueExports("export type A = string;\nexport interface B {}\n"),
    ).toEqual([]);
  });

  it("flags an exported class and a default export", () => {
    expect(illegalValueExports("export class C {}")).toEqual(["class C"]);
    expect(illegalValueExports("export default 3;")).toEqual(["default"]);
  });
});
