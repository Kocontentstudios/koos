import {
  Calendar,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Palette,
  Ticket,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** Primary sidebar items, in the exact order from UI Spec section 7.1. */
export const MAIN_NAV: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Brands", href: "/brand", icon: Palette },
  { title: "Campaigns", href: "/strategy", icon: Lightbulb },
  { title: "Calendar", href: "/calendar", icon: Calendar },
  { title: "Design Tickets", href: "/design-request", icon: Ticket },
];
