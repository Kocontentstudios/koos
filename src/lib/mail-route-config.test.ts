import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_MAIL_ROUTE_MAX_DURATION } from "@/lib/email";

/**
 * Every entry point that sends mail must outlast the SMTP socket timeout in
 * email.ts. Vercel's default budget is shorter, so a stalled send is killed
 * before the handler can log or report it — the failure that made BUG-008
 * invisible in the first place.
 *
 * Membership is computed from the import graph, not from a name pattern. A
 * regex over each file misses `createTicketFromRequest`, which sends two
 * emails a call site away, and a guard with a hole is worse than none because
 * it reads as coverage.
 */
const SRC = path.resolve(__dirname, "..");

function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx}").filter(
    (file) => !/\.(test|spec)\.tsx?$/.test(file),
  );
}

/* Comments are stripped before ANY source is inspected. Deleting text by
   regex is how a guard lies: matching an import across a stray comment, or
   reading `maxDuration` out of a "TODO: export const maxDuration = 60" note
   sitting beside the declaration it is waiting for — and this diff puts prose
   next to those declarations, so it is a live pattern. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function importsOf(file: string): string[] {
  /* Each import statement is classified rather than deleted: a type-only
     import is erased at build time and carries no runtime code, so counting it
     taints unrelated modules — but stripping it textually with `[^;]*` runs
     past a semicolon-less line and eats the NEXT import's specifier, hiding a
     real mail import entirely. Anchoring each match on its own `from "..."`
     cannot cross into the following statement. */
  const source = withoutComments(readFileSync(file, "utf8"));
  const specifiers = [
    ...[
      /* `export … from` counts: design/notify.ts already re-exports appUrl
         that way, so a barrel one step from the mail module would otherwise
         detaint everything downstream of it. */
      ...source.matchAll(
        /\b(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g,
      ),
    ]
      .filter((m) => !m[1])
      .map((m) => m[2]),
    // Bare side-effect import — `import "@/lib/x";` — already used in this repo.
    ...[...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
      (m) => m[1],
    ),
    ...[...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
      (m) => m[1],
    ),
  ];
  return specifiers
    .map((specifier: string) => {
      if (specifier.startsWith("@/")) {
        return path.join(SRC, specifier.slice(2));
      }
      if (specifier.startsWith(".")) {
        return path.join(path.dirname(path.resolve(file)), specifier);
      }
      return null;
    })
    .filter((resolved): resolved is string => resolved !== null)
    .flatMap((resolved) =>
      [".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((ext) => `${resolved.replace(/\.(ts|tsx)$/, "")}${ext}`)
        .map((candidate) => path.relative(process.cwd(), candidate)),
    );
}

/** Files that reach @/lib/email through any chain of imports. */
function mailSendingFiles(): Set<string> {
  const files = sourceFiles();
  const graph = new Map(files.map((file) => [file, importsOf(file)]));
  const tainted = new Set(["src/lib/email.ts"]);

  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, imports] of graph) {
      if (tainted.has(file)) continue;
      if (imports.some((dep) => tainted.has(dep))) {
        tainted.add(file);
        grew = true;
      }
    }
  }
  return tainted;
}

/* The NUMBER, not merely the declaration: `export const maxDuration = 1`
   satisfies a presence check while reintroducing the original bug in full. */
function declaredMaxDuration(file: string): number | null {
  const match = withoutComments(readFileSync(file, "utf8")).match(
    /export const maxDuration = (\d+)/,
  );
  return match ? Number(match[1]) : null;
}

describe("mail-sending entry points", () => {
  const tainted = mailSendingFiles();
  const routes = [...tainted]
    .filter(
      (file) => file.startsWith("src/app/") && /\/route\.tsx?$/.test(file),
    )
    .sort();

  it("traces mail through the import graph, not just direct callers", () => {
    // Reached only via createTicketFromRequest -> design/notify -> email.
    expect(routes).toContain("src/app/api/design-tickets/route.ts");
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("%s outlasts the SMTP timeouts", (file) => {
    expect(declaredMaxDuration(file)).toBeGreaterThanOrEqual(
      MIN_MAIL_ROUTE_MAX_DURATION,
    );
  });

  /* Server actions cannot carry route segment config; the page or layout they
     are invoked from supplies it. Derived from the same graph rather than
     hardcoded — a hardcoded list silently stopped covering
     resendVerificationEmail when its only caller moved into the dashboard
     layout. */
  const segments = [...tainted]
    .filter(
      (file) =>
        file.startsWith("src/app/") &&
        /\/(page|layout|template|default)\.tsx?$/.test(file),
    )
    .sort();

  it("finds the segments that host a mail-sending server action", () => {
    expect(segments).toContain("src/app/(dashboard)/layout.tsx");
    expect(segments).toContain("src/app/invite/[token]/page.tsx");
  });

  it.each(segments)("%s outlasts the SMTP timeouts", (file) => {
    expect(declaredMaxDuration(file)).toBeGreaterThanOrEqual(
      MIN_MAIL_ROUTE_MAX_DURATION,
    );
  });
});
