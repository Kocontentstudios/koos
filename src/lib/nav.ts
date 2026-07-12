import {
  Calendar,
  LayoutDashboard,
  type LucideIcon,
  Rocket,
  Target,
  Ticket,
  Users,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** Primary sidebar items, in the exact order from UI Spec section 7.1. */
export const MAIN_NAV: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Brands", href: "/brand", icon: Target },
  { title: "Campaigns", href: "/strategy", icon: Rocket },
  { title: "Calendar", href: "/calendar", icon: Calendar },
  { title: "Design Tickets", href: "/design-request", icon: Ticket },
  { title: "Team", href: "/team", icon: Users },
];

interface PageMeta {
  title: string;
  subtitle: string;
}

/** Topbar title + subtitle per route, mirroring the page headers in the mockups. */
const PAGE_META: { match: string; meta: PageMeta }[] = [
  {
    match: "/dashboard",
    meta: { title: "Dashboard", subtitle: "Your brand at a glance" },
  },
  {
    match: "/brand",
    meta: {
      title: "Brand Profile",
      subtitle:
        "Your brand information used for AI strategies and design assets",
    },
  },
  {
    match: "/strategy",
    meta: {
      title: "Campaigns",
      subtitle: "Build content strategies with KO AI",
    },
  },
  {
    match: "/calendar",
    meta: { title: "Calendar", subtitle: "Your content schedule" },
  },
  {
    match: "/design-request",
    meta: { title: "Design Tickets", subtitle: "Track your design requests" },
  },
  {
    match: "/settings",
    meta: { title: "Settings", subtitle: "Manage your account" },
  },
  {
    match: "/team",
    meta: { title: "Team", subtitle: "People with access to this workspace" },
  },
  {
    match: "/workspace",
    meta: {
      title: "Workspace Settings",
      subtitle: "Name, logo, and danger zone",
    },
  },
  {
    match: "/admin",
    meta: { title: "Admin", subtitle: "Manage the workspace" },
  },
];

export function getPageMeta(pathname: string): PageMeta {
  const hit = PAGE_META.find((p) => pathname.startsWith(p.match));
  return hit?.meta ?? { title: "KO OS", subtitle: "" };
}
