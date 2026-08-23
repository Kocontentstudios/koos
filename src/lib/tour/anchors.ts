/**
 * The ids that couple tour steps to real DOM nodes. Steps import these, and so
 * do the components that render the anchored elements, so the two sides cannot
 * name different things. `anchor-integrity.test.tsx` asserts every id in use
 * actually resolves at render time.
 */

export const TOUR_ANCHORS = {
  dashboardHero: "dashboard-hero",
  navBrands: "nav-brands",
  navCampaigns: "nav-campaigns",
  dashboardActions: "dashboard-actions",
  navDesignTickets: "nav-design-tickets",
  navSettings: "nav-settings",
} as const;

export type TourAnchorId = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS];

/**
 * Sidebar hrefs that carry a tour anchor, keyed by href rather than by a field
 * on NavItem: href is already the stable identity of a nav row (it is the React
 * key and the active-route discriminator), and a key that stops matching a real
 * nav entry is a hard test failure, where a stale optional field would be
 * invisible. Every key must exist in MAIN_NAV — asserted in anchors.test.ts.
 */
export const NAV_TOUR_ANCHORS: Record<string, TourAnchorId> = {
  "/brand": TOUR_ANCHORS.navBrands,
  "/strategy": TOUR_ANCHORS.navCampaigns,
  "/design-request": TOUR_ANCHORS.navDesignTickets,
};

export function tourAnchorSelector(id: TourAnchorId): string {
  return `[data-tour="${id}"]`;
}
