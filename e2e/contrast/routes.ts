/**
 * Every route the contrast lane renders, and every page in src/app it does
 * not, with the reason. `src/app/contrast-lane-coverage.test.ts` (the <2s
 * gate) fails when a page.tsx is in neither list, so a new route cannot land
 * unmeasured. Kept free of Playwright imports so vitest can read it.
 */

export type Who =
  | "anon"
  | "full"
  | "admin"
  | "member"
  | "pending"
  /* One fresh account per theme: probing presses Escape and dismisses the
     welcome dialog for good. */
  | "welcome"
  | "start";

export interface SeededIds {
  brandId: string;
  ticketId: string;
  inviteToken: string;
}

export interface LaneRoute {
  label: string;
  /** The page file under src/app this route renders. */
  file: string;
  path: string | ((ids: SeededIds) => string);
  who: Who;
  /** A heading only the rendered page shows. The error boundary, a redirect
   * or a blank shell never has it, so a page that crashed cannot pass. */
  sentinel: string;
  /** The sentinel's role when it is not a heading: a page whose only heading
   * is the top bar's, which a phone hides. */
  sentinelRole?: "heading" | "button";
}

export const ROUTES: LaneRoute[] = [
  {
    label: "landing",
    file: "page.tsx",
    path: "/",
    who: "anon",
    sentinel: "Your Brand Brain",
  },
  {
    label: "login",
    file: "(auth)/login/page.tsx",
    path: "/login",
    who: "anon",
    sentinel: "Welcome back",
  },
  {
    label: "register",
    file: "(auth)/register/page.tsx",
    path: "/register",
    who: "anon",
    sentinel: "Create your account",
  },
  {
    label: "forgot-password",
    file: "(auth)/forgot-password/page.tsx",
    path: "/forgot-password",
    who: "anon",
    sentinel: "Reset your password",
  },
  {
    label: "reset-password",
    file: "(auth)/reset-password/page.tsx",
    path: "/reset-password?token=e2e-contrast",
    who: "anon",
    sentinel: "Choose a new password",
  },
  {
    label: "verify-email",
    file: "(auth)/verify-email/[token]/page.tsx",
    path: "/verify-email/e2e-contrast-expired",
    who: "anon",
    sentinel: "This link is invalid or has expired",
  },
  {
    label: "invite",
    file: "invite/[token]/page.tsx",
    path: (ids) => `/invite/${ids.inviteToken}`,
    who: "anon",
    sentinel: "Join Ada Studio on KO OS",
  },
  {
    label: "privacy",
    file: "(marketing)/privacy/page.tsx",
    path: "/privacy",
    who: "anon",
    sentinel: "Privacy Policy",
  },
  {
    label: "terms",
    file: "(marketing)/terms/page.tsx",
    path: "/terms",
    who: "anon",
    sentinel: "Terms of Service",
  },
  {
    label: "access",
    file: "access/page.tsx",
    path: "/access",
    who: "pending",
    sentinel: "Everything your brand needs",
  },
  {
    label: "dashboard",
    file: "(dashboard)/dashboard/page.tsx",
    path: "/dashboard",
    who: "full",
    sentinel: "Welcome back, Ada",
  },
  {
    label: "onboarding-welcome",
    file: "(dashboard)/dashboard/page.tsx",
    path: "/dashboard",
    who: "welcome",
    sentinel: "Welcome to KO OS",
  },
  {
    label: "calendar",
    file: "(dashboard)/calendar/page.tsx",
    path: "/calendar",
    who: "full",
    sentinel: "Calendar",
  },
  {
    label: "design-studio",
    file: "(dashboard)/design-studio/page.tsx",
    path: "/design-studio",
    who: "full",
    sentinel: "Your designs",
  },
  {
    label: "strategy",
    file: "(dashboard)/strategy/page.tsx",
    path: "/strategy",
    who: "full",
    sentinel: "Campaigns",
  },
  {
    label: "brand",
    file: "(dashboard)/brand/page.tsx",
    path: "/brand",
    who: "full",
    sentinel: "Lumen Coffee",
  },
  {
    label: "brand-create",
    file: "(dashboard)/brand/create/page.tsx",
    path: "/brand/create",
    who: "full",
    sentinel: "Create Your Brand",
  },
  {
    label: "onboarding-start",
    file: "(dashboard)/brand/onboarding/page.tsx",
    path: "/brand/onboarding",
    who: "start",
    sentinel: "Start with KO",
    sentinelRole: "button",
  },
  {
    label: "design-tickets",
    file: "(dashboard)/design-request/page.tsx",
    path: "/design-request",
    who: "full",
    sentinel: "Design Tickets",
  },
  {
    label: "design-ticket",
    file: "(dashboard)/design-request/[id]/page.tsx",
    path: (ids) => `/design-request/${ids.ticketId}`,
    who: "full",
    sentinel: "Ticket in in progress",
  },
  {
    label: "design-request-new",
    file: "(dashboard)/design-request/new/page.tsx",
    path: "/design-request/new",
    who: "full",
    sentinel: "New Design Request",
  },
  {
    label: "design-request-quick",
    file: "(dashboard)/design-request/quick/page.tsx",
    path: "/design-request/quick",
    who: "full",
    sentinel: "Request a Design",
  },
  {
    label: "team",
    file: "(dashboard)/team/page.tsx",
    path: "/team",
    who: "full",
    sentinel: "Team",
  },
  {
    label: "settings",
    file: "(dashboard)/settings/page.tsx",
    path: "/settings",
    who: "full",
    sentinel: "Change password",
  },
  {
    label: "workspace-settings",
    file: "(dashboard)/workspace/settings/page.tsx",
    path: "/workspace/settings",
    who: "full",
    sentinel: "Workspace Information",
  },
  {
    label: "no-brands",
    file: "(dashboard)/no-brands/page.tsx",
    path: "/no-brands",
    who: "member",
    sentinel: "No brands yet",
  },
  {
    label: "admin",
    file: "admin/page.tsx",
    path: "/admin",
    who: "admin",
    sentinel: "Recent tickets",
  },
  {
    label: "admin-tickets",
    file: "admin/tickets/page.tsx",
    path: "/admin/tickets",
    who: "admin",
    sentinel: "Design Queue",
  },
  {
    label: "admin-ticket",
    file: "admin/tickets/[id]/page.tsx",
    path: (ids) => `/admin/tickets/${ids.ticketId}`,
    who: "admin",
    sentinel: "Post an update",
  },
  {
    label: "admin-users",
    file: "admin/users/page.tsx",
    path: "/admin/users",
    who: "admin",
    sentinel: "Users & Roles",
  },
  {
    label: "admin-brands",
    file: "admin/brands/page.tsx",
    path: "/admin/brands",
    who: "admin",
    sentinel: "Brands",
  },
  {
    label: "admin-brand",
    file: "admin/brands/[id]/page.tsx",
    path: (ids) => `/admin/brands/${ids.brandId}`,
    who: "admin",
    sentinel: "Lumen Coffee",
  },
  {
    label: "admin-workspaces",
    file: "admin/workspaces/page.tsx",
    path: "/admin/workspaces",
    who: "admin",
    sentinel: "Workspace access",
  },
  {
    label: "admin-analytics",
    file: "admin/analytics/page.tsx",
    path: "/admin/analytics",
    who: "admin",
    sentinel: "Most active brands",
  },
  {
    label: "admin-analytics-records",
    file: "admin/analytics/records/page.tsx",
    path: "/admin/analytics/records",
    who: "admin",
    sentinel: "Generations",
  },
  {
    label: "admin-delivered",
    file: "admin/delivered/page.tsx",
    path: "/admin/delivered",
    who: "admin",
    sentinel: "Delivered Projects",
  },
  {
    label: "admin-settings",
    file: "admin/settings/page.tsx",
    path: "/admin/settings",
    who: "admin",
    sentinel: "Email (SMTP)",
  },
];

/** Pages the lane does not render, each with the reason. */
export const NOT_RENDERED: Record<string, string> = {
  "feat-033-preview/page.tsx":
    "TEMPORARY FEAT-033 review harness (notFound() in production), deleted before merge; its views ship inside design-studio and are measured there",
};

export const routePath = (route: LaneRoute, ids: SeededIds) =>
  typeof route.path === "string" ? route.path : route.path(ids);

/** The routes this run measures: all of them, or the labels listed in
 * E2E_ROUTES (comma-separated), to rerun a few or split a run on a small
 * machine. An unknown label fails rather than measuring nothing. */
export function selectedRoutes(only = process.env.E2E_ROUTES): LaneRoute[] {
  if (!only) return ROUTES;
  const labels = only
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const unknown = labels.filter((l) => !ROUTES.some((r) => r.label === l));
  if (unknown.length > 0) {
    throw new Error(`E2E_ROUTES names no route: ${unknown.join(", ")}`);
  }
  return ROUTES.filter((r) => labels.includes(r.label));
}
