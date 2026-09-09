import { describe, expect, it } from "vitest";
import { MAIN_NAV } from "@/lib/nav";
import { NAV_TOUR_ANCHORS, TOUR_ANCHORS, tourAnchorSelector } from "./anchors";

describe("tour anchors", () => {
  it("maps only hrefs that really exist in the sidebar", () => {
    const hrefs = MAIN_NAV.map((item) => item.href);
    for (const href of Object.keys(NAV_TOUR_ANCHORS)) {
      expect(hrefs).toContain(href);
    }
  });

  it("has no duplicate anchor ids", () => {
    const ids = Object.values(TOUR_ANCHORS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds a selector that finds the attribute it names", () => {
    const el = document.createElement("div");
    el.setAttribute("data-tour", TOUR_ANCHORS.navBrands);
    document.body.append(el);
    expect(
      document.querySelector(tourAnchorSelector(TOUR_ANCHORS.navBrands)),
    ).toBe(el);
    el.remove();
  });
});
