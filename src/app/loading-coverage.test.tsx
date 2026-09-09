import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Every routable segment must resolve a loading.tsx that is actually useful.
 *
 * Existence alone is not the bar — `export default () => null` would satisfy a
 * file check and help nobody — so each resolved fallback is rendered and must
 * announce itself and draw placeholders. Route groups are discovered from the
 * filesystem rather than listed, so a new one is covered the day it appears.
 *
 * Before this, 21 of 25 segments had no pending state at all: navigating froze
 * the previous page on screen and a hard load showed a blank document.
 */

const APP = path.join(process.cwd(), "src", "app");

function dirsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith("_") || entry === "api") continue;
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    found.push(full, ...dirsUnder(full));
  }
  return found;
}

function has(dir: string, file: string): boolean {
  try {
    statSync(path.join(dir, file));
    return true;
  } catch {
    return false;
  }
}

/** The loading.tsx Next would use for `dir` — nearest at or above it. */
function resolveLoading(dir: string): string | null {
  let current = dir;
  for (;;) {
    if (has(current, "loading.tsx")) return path.join(current, "loading.tsx");
    if (current === APP) return null;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(APP)) return null;
    current = parent;
  }
}

const segments = [APP, ...dirsUnder(APP)].filter((d) => has(d, "page.tsx"));
const fallbacks = [...new Set(segments.map(resolveLoading))].filter(
  (f): f is string => f !== null,
);

afterEach(cleanup);

describe("route loading coverage", () => {
  it("found routable segments to check", () => {
    expect(segments.length).toBeGreaterThan(10);
  });

  it("resolves a loading.tsx for every segment", () => {
    const uncovered = segments
      .filter((d) => resolveLoading(d) === null)
      .map((d) => path.relative(APP, d) || "(root)");
    expect(uncovered).toEqual([]);
  });

  /* A segment nested under a route with a TAILORED skeleton inherits that
     skeleton, not the generic one — which is how brand/create briefly showed a
     brand-profile card grid ahead of a stepped form.

     Intent can't be read off the filesystem, so the generic fallbacks are named
     here; every other loading.tsx is treated as tailored to its own segment. */
  const GENERIC = new Set(
    ["loading.tsx", "(dashboard)/loading.tsx", "admin/loading.tsx"].map((f) =>
      path.join(APP, f),
    ),
  );

  it("names only real files as generic fallbacks", () => {
    for (const f of GENERIC) expect(fallbacks).toContain(f);
  });

  it("never inherits a sibling route's tailored skeleton", () => {
    const wrong = segments
      .filter((d) => {
        const f = resolveLoading(d);
        return f !== null && !GENERIC.has(f) && path.dirname(f) !== d;
      })
      .map((d) => path.relative(APP, d));
    expect(wrong).toEqual([]);
  });
});

describe.each(fallbacks.map((f) => [path.relative(APP, f), f] as const))(
  "%s",
  (_name, file) => {
    it("announces itself with real text and draws placeholders", async () => {
      const mod = await import(/* @vite-ignore */ file);
      const Fallback = mod.default as () => React.ReactElement;
      const { container } = render(<Fallback />);

      const status = screen.getByRole("status");
      expect(status.textContent?.trim()).toMatch(/loading/i);

      /* aria-busy on a live region tells assistive tech to WITHHOLD the update
         the region exists to deliver, and it never flips back — the fallback
         unmounts wholesale. */
      expect(status).not.toHaveAttribute("aria-busy");

      const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
      for (const s of skeletons) {
        expect(s).toHaveAttribute("aria-hidden", "true");
        expect(s.className).toContain("bg-skeleton");
      }

      /* --surface-1 and --surface-2 are both #ffffff in light mode, so a
         placeholder drawn with either is invisible on the card it sits in.
         That is how the shipped fallbacks rendered a blank dashboard. */
      expect(container.innerHTML).not.toContain("bg-surface-2");
      expect(container.innerHTML).not.toContain("bg-muted");

      // Nothing hand-rolls the animation; it belongs to Skeleton.
      const strays = [...container.querySelectorAll(".animate-pulse")].filter(
        (el) => el.getAttribute("data-slot") !== "skeleton",
      );
      expect(strays).toEqual([]);
    });
  },
);
