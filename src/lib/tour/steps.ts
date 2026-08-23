import { TOUR_ANCHORS, type TourAnchorId } from "./anchors";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Null renders the step as a centered card instead of an anchored popover. */
  anchor: TourAnchorId | null;
  /** Sidebar-anchored steps open the mobile drawer before they can be seen. */
  isNav: boolean;
  /** Which side of the anchor the popover sits on. */
  side: "top" | "bottom" | "left" | "right";
}

export const TOUR_PROMPT = {
  headline: "Take a quick tour of KOOS",
  body: "We'll show you where everything is, so you know how to create campaigns, request designs, and manage your brand.",
  start: "Start Tour",
  skip: "Skip for Now",
} as const;

export const TOUR_FINISH_LABEL = "Finish Tour";

/** Copy is contractual — steps.test.ts locks every string against the ticket. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    title: "Your Dashboard",
    body: "This is your main workspace. From here, you can see your brand activity and access the main tools in KOOS.",
    anchor: TOUR_ANCHORS.dashboardHero,
    isNav: false,
    side: "bottom",
  },
  {
    id: "brand-profile",
    title: "Your Brand Profile",
    body: "This is where KOOS stores what it knows about your business, audience, tone, offers, and brand details.",
    anchor: TOUR_ANCHORS.navBrands,
    isNav: true,
    side: "right",
  },
  {
    id: "campaigns",
    title: "Create Campaigns",
    body: "Use this section to create marketing campaigns based on your brand, goals, and content needs.",
    anchor: TOUR_ANCHORS.navCampaigns,
    isNav: true,
    side: "right",
  },
  {
    id: "request-design",
    title: "Request a Design",
    body: "Submit a design request using AI, or upload your own brief and assets if you already know what you need.",
    anchor: TOUR_ANCHORS.dashboardActions,
    isNav: false,
    side: "top",
  },
  {
    id: "track-work",
    title: "Track Your Work",
    body: "View your submitted campaigns, design requests, and progress updates in one place.",
    anchor: TOUR_ANCHORS.navDesignTickets,
    isNav: true,
    side: "right",
  },
  {
    id: "account",
    title: "Manage Your Account",
    body: "Update your profile, account details, preferences, and workspace settings here.",
    anchor: TOUR_ANCHORS.navSettings,
    isNav: true,
    side: "right",
  },
  {
    id: "finish",
    title: "You're ready to use KOOS",
    body: "You can now create a campaign, request a design, or explore your dashboard.",
    anchor: null,
    isNav: false,
    side: "bottom",
  },
];
