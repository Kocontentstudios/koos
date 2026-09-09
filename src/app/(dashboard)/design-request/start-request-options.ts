export type StartRequestKey = "direct" | "calendar" | "campaign";

export interface StartRequestOption {
  key: StartRequestKey;
  title: string;
  description: string;
  href: string;
}

/** Fixed arity so the dialog can name each option instead of indexing. */
type StartRequestOptions = readonly [
  StartRequestOption,
  StartRequestOption,
  StartRequestOption,
];

/** "Campaigns" in the product is the Strategy builder — there is no
 *  campaigns table or /campaigns route; see nav.ts MAIN_NAV. */
export const START_REQUEST_OPTIONS: StartRequestOptions = [
  {
    key: "direct",
    title: "Request a new design",
    description:
      "Write a brief, add references, and send it straight to the design team.",
    href: "/design-request/new",
  },
  {
    key: "calendar",
    title: "Choose from Content Calendar",
    description: "Pick a planned post and request the design for it.",
    /* Agenda, not the default month view: month renders items as
       pointer-events-none chips, so the banner's "pick an item" would be
       impossible on arrival. Agenda is the only view wired to open the drawer. */
    href: "/calendar?pick=design&view=agenda",
  },
  {
    key: "campaign",
    title: "Start a new campaign",
    description: "No content plan yet? Build a campaign first with KO AI.",
    href: "/strategy",
  },
];
