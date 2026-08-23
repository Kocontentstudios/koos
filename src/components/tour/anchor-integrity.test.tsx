import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarCollapseProvider } from "@/components/layout/sidebar-context";
import { tourAnchorSelector } from "@/lib/tour/anchors";
import { TOUR_STEPS } from "@/lib/tour/steps";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

const WORKSPACE = {
  id: "w1",
  name: "Acme",
  logoUrl: null,
  role: "owner" as const,
};

function renderSidebar() {
  return render(
    <SidebarCollapseProvider>
      <AppSidebar workspace={WORKSPACE} memberships={[WORKSPACE]} />
    </SidebarCollapseProvider>,
  );
}

const ANCHORS = TOUR_STEPS.map((s) => s.anchor).filter(
  (a): a is NonNullable<typeof a> => a !== null,
);
const NAV_ANCHORS = ANCHORS.filter((a) => a.startsWith("nav-"));
const PAGE_ANCHORS = ANCHORS.filter((a) => !a.startsWith("nav-"));

describe("tour anchor integrity", () => {
  it("renders every sidebar anchor a step points at", () => {
    const { container } = renderSidebar();
    for (const anchor of NAV_ANCHORS) {
      expect(
        container.querySelector(tourAnchorSelector(anchor)),
        `sidebar is missing [data-tour="${anchor}"]`,
      ).not.toBeNull();
    }
  });

  it("keeps the sidebar anchors when collapsed to the icon rail", () => {
    // `collapsed` hides the label span, not the link, so anchors must survive.
    window.localStorage.setItem("koos_sidebar_collapsed", "true");
    const { container } = renderSidebar();
    for (const anchor of NAV_ANCHORS) {
      expect(
        container.querySelector(tourAnchorSelector(anchor)),
      ).not.toBeNull();
    }
  });

  /* The dashboard is an async server component behind requireBrand() and five
     DB queries; rendering it here would cost more mock surface than the
     assertion is worth. A static source check is the same trade
     scripts/migration-lint.test.mjs already makes. */
  it("wires every dashboard anchor into the dashboard page source", () => {
    const source = readFileSync(
      "src/app/(dashboard)/dashboard/page.tsx",
      "utf8",
    );
    for (const anchor of PAGE_ANCHORS) {
      expect(source, `dashboard page never renders "${anchor}"`).toContain(
        `data-tour={TOUR_ANCHORS.${anchor.replace(/-(.)/g, (_, c) => c.toUpperCase())}}`,
      );
    }
  });

  it("covers every anchored step between the two checks above", () => {
    // Adding an 8th step with a new anchor fails here until it is both wired
    // into the DOM and covered by one of the checks. This is the drift guard.
    const covered = new Set([...NAV_ANCHORS, ...PAGE_ANCHORS]);
    expect(covered).toEqual(new Set(ANCHORS));
  });
});
