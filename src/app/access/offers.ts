import {
  Calendar,
  Lightbulb,
  type LucideIcon,
  Rocket,
  Sparkles,
  Target,
  Ticket,
  Users,
  Wand2,
} from "lucide-react";

export interface Offer {
  title: string;
  description: string;
  icon: LucideIcon;
}

/* Icons match the sidebar (src/lib/nav.ts) so a client who is approved later
   recognises each feature where it actually lives. */
export const OFFERS: Offer[] = [
  {
    title: "Brand Brain",
    description:
      "Keep your brand’s identity, audience, voice, and guidelines in one place.",
    icon: Target,
  },
  {
    title: "AI Onboarding",
    description: "Set up your brand with guided onboarding.",
    icon: Sparkles,
  },
  {
    title: "AI-Assisted Strategy and Content",
    description:
      "Develop brand-aligned ideas, strategy, messaging, and content.",
    icon: Lightbulb,
  },
  {
    title: "Campaign Generation",
    description: "Create a 30-day campaign plan for your brand.",
    icon: Rocket,
  },
  {
    title: "Content Calendar",
    description: "Organise your content and campaign schedule.",
    icon: Calendar,
  },
  {
    title: "Studio",
    description: "Create designs and videos for your brand.",
    icon: Wand2,
  },
  {
    title: "Design Tickets",
    description: "Submit and track design requests.",
    icon: Ticket,
  },
  {
    title: "Team Collaboration",
    description: "Work with your team and manage access across brands.",
    icon: Users,
  },
];
