import Link from "next/link";
import { Markdown } from "@/components/ui/markdown";

export interface LegalSection {
  heading: string;
  /** Markdown — supports paragraphs, **bold**, and bullet/numbered lists. */
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
    <div className="font-brand relative min-h-screen bg-background overflow-hidden">
      {/* Background orbs — consistent with the marketing/auth pages */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-[-20%] left-[-10%] w-150 h-150 rounded-full bg-primary blur-[100px] opacity-[0.06]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[-20%] right-[-10%] w-125 h-125 rounded-full bg-[#A855F7] blur-[100px] opacity-[0.06]"
      />

      <div className="relative z-[2] max-w-[800px] mx-auto px-6 py-12 md:py-16">
        {/* Brand wordmark — links back home */}
        <Link href="/" className="inline-flex items-center gap-2.5 mb-8">
          <div
            aria-hidden="true"
            className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center"
          >
            <span className="text-white text-sm font-extrabold leading-none">
              KO
            </span>
          </div>
          <span className="text-lg font-bold text-foreground tracking-tight">
            KO OS
          </span>
        </Link>

        {/* Branded content card — matches the auth/marketing surfaces */}
        <article className="bg-surface-1 border border-[var(--border)] rounded-2xl p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <header className="pb-6 mb-8 border-b border-[var(--border)]">
            <h1 className="text-3xl md:text-4xl text-foreground font-bold tracking-tight">
              {title}
            </h1>
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              Last updated: {lastUpdated}
            </p>
          </header>

          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-lg md:text-xl font-semibold text-foreground mb-2">
                  {section.heading}
                </h2>
                <Markdown className="text-[15px] text-[var(--text-secondary)]">
                  {section.body}
                </Markdown>
              </section>
            ))}
          </div>
        </article>

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-foreground transition-colors"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Privacy Policy copy                                               */
/* ------------------------------------------------------------------ */

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Who We Are",
    body: "KO OS is operated by **KO Content Studios** (“KO”, “we”, “us”), based in Nigeria. We are the data controller responsible for the personal data described in this policy.\n\nThis policy explains what we collect, why, how we protect it, and the rights you have. It is written to align with the Nigeria Data Protection Act / NDPR and, where applicable, the EU/UK GDPR.",
  },
  {
    heading: "Information We Collect",
    body: "**Account information.** Your first and last name, email address, password (stored only as a salted hash), profile avatar, and authentication method (email or Google).\n\n**Brand profile information.** Details you provide when creating a brand: business type and stage, goals, target audience, tone and brand values, colors, uploaded logos and assets, competitors, and social channels.\n\n**Content and interactions.** Strategies, content calendars, design briefs and tickets you generate, plus your messages to the AI strategist.\n\n**Usage and technical data.** Basic device, log, and diagnostic information (such as actions taken and timestamps) needed to operate and secure the service.\n\n**Cookies.** A small number of essential cookies and local-storage values for sign-in sessions and preferences (for example, your theme choice).",
  },
  {
    heading: "How We Use Your Information",
    body: "We use your information to:\n\n- Provide the service — generate marketing strategies and content calendars, and route design tickets to KO designers.\n- Operate, secure, and improve the platform, including troubleshooting and preventing abuse.\n- Communicate with you about your account and service updates.\n\nOur legal bases are **performance of a contract** (to deliver the service you sign up for), our **legitimate interests** (to secure and improve the platform), **consent** (where required, e.g. optional communications), and **legal obligation** where applicable. **We do not sell your personal data.**",
  },
  {
    heading: "AI Processing and Subprocessors",
    body: "KO OS uses third-party AI providers to generate content. By default we use **Google (Gemini)**; depending on configuration we may also use **OpenAI** or **Anthropic**. The text you submit (such as brand details and chat messages) is sent to the active provider to produce a response, under that provider’s data-processing terms.\n\nWe do not permit your data to be used to train third-party AI models without your explicit consent. We also rely on infrastructure subprocessors, including **Cloudflare R2** (file/asset storage) and a managed **PostgreSQL** database provider.",
  },
  {
    heading: "How We Share Information",
    body: "We share personal data only with:\n\n- **Service providers / subprocessors** acting on our behalf (AI providers, hosting, storage, email) under appropriate contractual safeguards.\n- **KO designers** assigned to fulfil your design requests, limited to what is needed for the task.\n- **Authorities**, where required by law or to protect rights, safety, and the integrity of the service.",
  },
  {
    heading: "Storage, Transfers, and Security",
    body: "Your data is stored in our PostgreSQL database and in Cloudflare R2. Because our providers operate globally, your information may be processed outside Nigeria, including in regions covered by GDPR; where this happens we rely on appropriate safeguards such as standard contractual clauses.\n\nWe protect data with measures including encrypted transport (HTTPS), hashed passwords (argon2id), and hashed session tokens. No system is perfectly secure, but we work to protect your information against unauthorised access, loss, or misuse.",
  },
  {
    heading: "Data Retention",
    body: "We retain your information for as long as your account is active and as needed to provide the service. If you request deletion, we will remove your personal data (and associated brand, content, and design records) within **30 days**, except where we must retain limited information to meet legal obligations.",
  },
  {
    heading: "Your Rights",
    body: "Subject to applicable law (NDPR and, where relevant, GDPR), you have the right to:\n\n- **Access** the personal data we hold about you.\n- **Rectify** inaccurate or incomplete data.\n- **Erase** your data (“right to be forgotten”).\n- **Port** your data to another service.\n- **Object to** or **restrict** certain processing.\n- **Withdraw consent** at any time, without affecting prior processing.\n\nTo exercise any of these rights, contact us at **hello@kocontentstudios.com**. You also have the right to lodge a complaint with your data-protection authority.",
  },
  {
    heading: "Cookies and Tracking",
    body: "We use only essential cookies and local-storage values required to keep you signed in and remember preferences such as your theme and sidebar state. We do not use third-party advertising cookies.",
  },
  {
    heading: "Children’s Privacy",
    body: "KO OS is intended for users aged 18 and over and is not directed at children. We do not knowingly collect personal data from children. If you believe a child has provided us data, contact us and we will delete it.",
  },
  {
    heading: "Changes to This Policy",
    body: "We may update this policy as the platform evolves or as the law requires. Material changes will be reflected by updating the “Last updated” date above, and where appropriate we will notify you in-app or by email.",
  },
  {
    heading: "Contact",
    body: "For privacy questions or to exercise your rights, contact us at **hello@kocontentstudios.com**.",
  },
];

/* ------------------------------------------------------------------ */
/*  Terms of Service copy                                             */
/* ------------------------------------------------------------------ */

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "Acceptance of Terms",
    body: "These Terms of Service (“Terms”) govern your use of KO OS, operated by **KO Content Studios** (“KO”, “we”, “us”). By creating an account or using the platform, you agree to these Terms. If you do not agree, please do not use KO OS.",
  },
  {
    heading: "Eligibility",
    body: "You must be at least 18 years old and able to form a binding contract to use KO OS. If you use the platform on behalf of an organisation, you confirm you are authorised to bind that organisation to these Terms.",
  },
  {
    heading: "Your Account",
    body: "You are responsible for the accuracy of your account information, for keeping your credentials secure, and for all activity under your account. Notify us promptly of any unauthorised use. We may suspend accounts that violate these Terms or pose a security risk.",
  },
  {
    heading: "The Service",
    body: "KO OS helps you build a brand profile, generate AI content strategies and calendars, and submit design tickets that are fulfilled by human KO designers. The service combines automated AI outputs with human design work — “AI plans, humans design.”",
  },
  {
    heading: "Ownership of AI Outputs",
    body: "You receive full commercial rights to the **final assets delivered** to you through KO OS. Draft content and intermediate AI outputs remain platform-owned until formally delivered. You retain ownership of the brand information and materials you upload, and you grant us the licence needed to operate the service and produce your deliverables.",
  },
  {
    heading: "AI Outputs Are Provided “As Is”",
    body: "AI-generated strategies, content, and copy may be inaccurate or unsuitable and are provided without warranty of accuracy, fitness for a particular purpose, or legal clearance. **You are responsible for reviewing outputs before use**, including checking for accuracy, rights, and compliance.",
  },
  {
    heading: "Acceptable Use",
    body: "You agree not to use KO OS to:\n\n- Infringe trademarks, copyrights, or other intellectual-property rights.\n- Create hateful, harassing, deceptive, or unlawful content, or impersonate others.\n- Attempt to disrupt, reverse-engineer, or gain unauthorised access to the platform.\n- Misuse the AI to generate spam, malware, or content that violates a provider’s policies.",
  },
  {
    heading: "Beta Notice",
    body: "KO OS is in early-stage development. Features may change, and the platform may experience downtime or contain bugs. We appreciate your patience as we improve the service.",
  },
  {
    heading: "Intellectual Property",
    body: "The KO OS platform, including its software, design, and branding, is owned by KO Content Studios and protected by applicable laws. These Terms do not grant you any rights in our platform other than the right to use it as permitted.",
  },
  {
    heading: "Third-Party Services",
    body: "KO OS relies on third-party providers (including AI providers such as Google, OpenAI, or Anthropic, and infrastructure providers). Your use of the service is also subject to those providers’ terms where applicable. We are not responsible for third-party services outside our control.",
  },
  {
    heading: "Disclaimers",
    body: "Except where prohibited by law, KO OS is provided “as is” and “as available” without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose, and non-infringement.",
  },
  {
    heading: "Limitation of Liability",
    body: "To the maximum extent permitted by law, our total liability for any claim is capped at the total fees you paid to us in the **12 months** preceding the claim. We are not liable for service downtime, AI output errors, or loss of data or profits beyond this cap.",
  },
  {
    heading: "Indemnification",
    body: "You agree to indemnify and hold KO Content Studios harmless from claims arising out of your content, your use of the service, or your breach of these Terms, except to the extent caused by our own wrongdoing.",
  },
  {
    heading: "Termination",
    body: "You may stop using KO OS and request account deletion at any time. We may suspend or terminate access for breach of these Terms or to protect the service. Provisions that by their nature should survive termination (such as ownership, disclaimers, and liability limits) will continue to apply.",
  },
  {
    heading: "Governing Law",
    body: "These Terms are governed by the laws of the **Federal Republic of Nigeria**, without regard to conflict-of-laws rules. Disputes will be subject to the courts of the Federal Republic of Nigeria, unless applicable law provides otherwise.",
  },
  {
    heading: "Changes to These Terms",
    body: "We may update these Terms as the platform evolves. Material changes will be reflected by updating the “Last updated” date above, and continued use of KO OS after changes take effect constitutes acceptance.",
  },
  {
    heading: "Contact",
    body: "For questions about these Terms, contact us at **hello@kocontentstudios.com**.",
  },
];
