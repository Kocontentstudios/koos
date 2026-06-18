import Link from "next/link";

export interface LegalSection {
  heading: string;
  body: string;
}

export function LegalPage({
  title,
  lastUpdated,
  sections,
}: {
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
}) {
  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-[680px] mx-auto px-6 py-16">
        <Link
          href="/"
          className="mb-10 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-foreground transition-colors"
        >
          ← Back
        </Link>

        <h1 className="font-display text-3xl text-foreground font-bold">
          {title}
        </h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Last updated: {lastUpdated}
        </p>

        {sections.map((section) => (
          <div key={section.heading}>
            <h2 className="text-lg font-semibold text-foreground mt-8">
              {section.heading}
            </h2>
            <p className="text-[var(--text-secondary)] mt-2 leading-relaxed whitespace-pre-line">
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Privacy Policy copy                                               */
/* ------------------------------------------------------------------ */

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Information We Collect",
    body: "We collect the information you provide when setting up your brand profile, including brand name, business type, goals, tone, and uploaded assets such as logos and colors. We also collect generated content (strategies, calendar items, design briefs), your interactions with the AI chat, and basic device and diagnostic data to keep the service running.",
  },
  {
    heading: "How We Use Your Information",
    body: "Your information is used to generate marketing strategies and content calendars, route design tickets to KO designers, and continuously improve the KO OS platform. We do not sell your data to third parties.",
  },
  {
    heading: "Third-Party AI Processing",
    body: "Text inputs may be processed by third-party AI providers (e.g. OpenAI) under their respective data-protection terms. We do not allow your data to be used to train third-party AI models without your explicit consent.",
  },
  {
    heading: "Data Retention",
    body: "Your data is retained for as long as your account is active. If you request account deletion, we will remove your personal data within 30 days.",
  },
  {
    heading: "Your Rights",
    body: "You have the right to access, correct, export, or delete the personal data we hold about you. To exercise any of these rights, contact us at the address below.",
  },
  {
    heading: "Contact",
    body: "For privacy inquiries, reach us at hello@kocontentstudios.com.",
  },
];

/* ------------------------------------------------------------------ */
/*  Terms of Service copy                                             */
/* ------------------------------------------------------------------ */

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "Acceptance of Terms",
    body: "By creating an account or using KO OS, you agree to these Terms of Service. If you do not agree, please do not use the platform.",
  },
  {
    heading: "Ownership of AI Outputs",
    body: "You receive full commercial rights to all final assets delivered through KO OS. Draft content and intermediate AI outputs remain platform-owned until formally delivered to you.",
  },
  {
    heading: "AI Outputs Are Provided As-Is",
    body: "AI-generated strategies, content, and copy are provided without warranty of accuracy, fitness for a particular purpose, or legal clearance. You are responsible for reviewing outputs before use.",
  },
  {
    heading: "Beta Notice",
    body: "KO OS is in early-stage development. Features may change, and the platform may experience downtime or contain bugs. We appreciate your patience as we improve.",
  },
  {
    heading: "Limitation of Liability",
    body: "Our liability to you is capped at the total fees you paid in the 12 months preceding any claim. We are not liable for service downtime, AI output errors, or data loss beyond this cap.",
  },
  {
    heading: "Prohibited Uses",
    body: "You may not use KO OS to create content that infringes trademarks, incorporates hate symbols, impersonates individuals or organisations, or facilitates illegal branding activities.",
  },
  {
    heading: "Contact",
    body: "For questions about these Terms, contact us at hello@kocontentstudios.com.",
  },
];
