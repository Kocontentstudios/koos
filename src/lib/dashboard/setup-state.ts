// Pure account-setup state machine for the dashboard. The dashboard is only
// reachable once a brand exists (requireBrand redirects otherwise), so the
// stages start from "brand exists".

export type SetupStage = "needs-strategy" | "needs-calendar" | "complete";

export interface SetupInput {
  hasStrategy: boolean;
  hasCalendar: boolean;
}

export interface SetupCta {
  label: string;
  href: string;
  desc: string;
}

export interface SetupState {
  stage: SetupStage;
  /** The single next action to surface in the hero. */
  nextCta: SetupCta;
}

export function getSetupState(input: SetupInput): SetupState {
  if (!input.hasStrategy) {
    return {
      stage: "needs-strategy",
      nextCta: {
        label: "Build a Strategy",
        href: "/strategy",
        desc: "Chat with KO AI to create a campaign strategy for your goals.",
      },
    };
  }
  if (!input.hasCalendar) {
    return {
      stage: "needs-calendar",
      nextCta: {
        label: "Generate Your Calendar",
        href: "/strategy",
        desc: "Turn your strategy into a day-by-day content calendar.",
      },
    };
  }
  return {
    stage: "complete",
    nextCta: {
      label: "View Your Calendar",
      href: "/calendar",
      desc: "See your day-by-day content schedule and request designs.",
    },
  };
}
