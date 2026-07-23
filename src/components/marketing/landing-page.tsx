"use client";

import {
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Globe,
  Mail,
  MapPin,
  Menu,
  Paintbrush,
  PenTool,
  Phone,
  Quote,
  Sparkles,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/* Brand glyphs — lucide v1 dropped brand icons, so we inline these to keep
   the social links visually faithful to the mockup. */
function Instagram({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function Linkedin({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function Twitter({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Tiktok({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function Whatsapp({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/* Official KO Content Studios profiles + contact channels. Single source of
   truth for every social anchor on the marketing site. */
const SOCIAL_LINKS = {
  linkedin: "https://www.linkedin.com/company/ko-content-studios/",
  x: "https://x.com/kocontentstudio?t=QgL3lZN0yC6k9WF2Oh3O4Q&s=09",
  instagram:
    "https://www.instagram.com/kocontentstudios?igsh=MWZoc2d2ejNmeTB0NQ==",
  tiktok: "https://www.tiktok.com/@kocontentstudios?_r=1&_t=ZS-979RX8xpHKK",
  email: "hello@kocontentstudios.com",
  whatsapp: "https://wa.me/2348135647207",
  phone: "+2348135647207",
  phoneDisplay: "+234 813 564 7207",
} as const;

const SERVICES = [
  {
    icon: Brain,
    cls: "blue",
    title: "AI Strategy",
    body: "Chat with KO to build a complete content strategy. Campaign overview, channel recommendations, content mix, and timeline.",
  },
  {
    icon: CalendarDays,
    cls: "purple",
    title: "Content Calendar",
    body: "AI converts your strategy into a day-by-day calendar. Month, week, day, and agenda views. Every item actionable.",
  },
  {
    icon: Paintbrush,
    cls: "cyan",
    title: "Human Design",
    body: "Request designs from KO's human team. Auto-filled briefs with your brand colors, logo, and content context.",
  },
  {
    icon: PenTool,
    cls: "green",
    title: "Graphic Design",
    body: "Stand out with custom visuals — social posts, banners, decks, packaging, and brand identity assets.",
  },
  {
    icon: Video,
    cls: "red",
    title: "Video Editing",
    body: "Turn raw footage into polished Reels, ads, explainers, and promotional videos ready for any channel.",
  },
  {
    icon: Film,
    cls: "orange",
    title: "Motion Graphics",
    body: "Add energy with animated logos, transitions, and dynamic graphics that make your brand feel alive.",
  },
];

type FounderSocials = {
  linkedin?: string;
  instagram?: string;
  website?: string;
  x?: string;
};

const FOUNDERS: {
  initials: string;
  name: string;
  role: string;
  bio: string;
  image: string;
  socials: FounderSocials;
}[] = [
  {
    initials: "OK",
    name: "Obafela Killa",
    role: "Founder & CEO",
    bio: "Visionary and operator driving the KO OS mission to make brand building faster, smarter, and more creative.",
    image: "/founders/obafela_killa.jpg",
    socials: {
      linkedin: "https://www.linkedin.com/in/obafelakilla",
      instagram: "https://www.instagram.com/obafelakilla",
      website: "https://obafelakilla.com",
    },
  },
  {
    initials: "PO",
    name: "Precious Oyenuga",
    role: "Co-founder & CCPO",
    bio: "Chief Creative and Product Officer. Shapes product experience, creative direction, and the brand voice that users feel.",
    image: "/founders/precious_oyenuga.jpg",
    socials: {
      linkedin: "https://www.linkedin.com/in/precious-oyenuga-394b92341",
      instagram: "https://www.instagram.com/preciousoyenuga_",
    },
  },
  {
    initials: "OI",
    name: "Oluwaseyi Idowu",
    role: "Co-founder & CTO",
    bio: "Architects the technology behind KO OS, ensuring every AI feature and design workflow runs at scale.",
    image: "/founders/oluwaseyi_idowu.jpeg",
    socials: {
      linkedin: "https://www.linkedin.com/in/oluwaseyi-idowu-sunday",
      instagram: "https://www.instagram.com/idowuseyi22",
      website: "https://idowu.cerfic.com",
      x: "https://x.com/idowuseyi22",
    },
  },
];

/* Ordered so every founder card renders icons in the same sequence. */
const FOUNDER_SOCIAL_ICONS: {
  key: keyof FounderSocials;
  label: string;
  Icon: (props: { size?: number }) => React.JSX.Element;
}[] = [
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
  { key: "x", label: "X", Icon: Twitter },
  { key: "instagram", label: "Instagram", Icon: Instagram },
  { key: "website", label: "Website", Icon: GlobeIcon },
];

function GlobeIcon({ size = 18 }: { size?: number }) {
  return <Globe size={size} aria-hidden="true" />;
}

const NAV_LINKS = [
  { href: "#home", label: "Home" },
  { href: "#about", label: "About" },
  { href: "#services", label: "Services" },
  { href: "#contact", label: "Contact" },
];

/* The app lives on a separate host (app.kocontentstudios.com) in production.
   NEXT_PUBLIC_APP_URL points there; when unset (local dev) we fall back to a
   relative path so the same-origin dev server keeps working. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const OPEN_APP_HREF = `${APP_URL}/login`;

const STEPS = [
  {
    n: 1,
    title: "Create Your Brand",
    body: "Set up your brand profile with logo, colors, audience, and tone.",
  },
  {
    n: 2,
    title: "Build Strategy",
    body: "Chat with KO AI to create a campaign strategy tailored to your goals.",
  },
  {
    n: 3,
    title: "Get Calendar",
    body: "AI generates a day-by-day content calendar with posts, emails, and blogs.",
  },
  {
    n: 4,
    title: "Request Designs",
    body: "Submit design tickets to human designers. Receive assets in 24-48 hours.",
  },
];

export function LandingPage() {
  const navRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactPending, setContactPending] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // ── Navbar scroll effect ──────────────────────────────────────────────
  useEffect(() => {
    function onScroll() {
      const nav = navRef.current;
      if (!nav) return;
      nav.classList.toggle("scrolled", window.scrollY > 50);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Scroll reveal ─────────────────────────────────────────────────────
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll(".reveal");
    if (!els) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        }
      },
      { threshold: 0.1 },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleContactSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (contactPending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setContactPending(true);
    setContactError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          company: data.get("company"),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not send your message.");
      }
      setContactSent(true);
      form.reset();
      setTimeout(() => setContactSent(false), 5000);
    } catch (err) {
      setContactError(
        err instanceof Error ? err.message : "Could not send your message.",
      );
    } finally {
      setContactPending(false);
    }
  }

  function handleBrandClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div ref={rootRef} className="landing-page font-brand">
      <div className="orb-container">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>
      <div className="grid-lines" />

      {/* ── Navbar ── */}
      <nav className="nav" id="navbar" ref={navRef}>
        <Link href="/" className="nav-brand" onClick={handleBrandClick}>
          <div className="nav-brand-icon">KO</div>
          <span className="nav-brand-text">KO OS</span>
        </Link>
        <button
          type="button"
          className="nav-mobile-toggle"
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Menu size={20} />
        </button>
        <div className={`nav-links${menuOpen ? " open" : ""}`}>
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="nav-link"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <Link href={OPEN_APP_HREF} className="nav-cta nav-cta-primary">
            Open KO-OS
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero" id="home">
        <div className="hero-badge">
          <Sparkles size={14} /> AI-Powered Brand Strategy
        </div>
        <h1>
          Your Brand Brain <span>Powered By KO</span>
        </h1>
        <p className="hero-subtitle">
          Turn raw ideas into brand-ready campaigns. AI builds your strategy and
          calendar. Human designers bring it to life.
        </p>
        <div className="hero-ctas">
          <Link href={OPEN_APP_HREF} className="hero-cta-primary">
            Open KO-OS <ArrowRight size={16} />
          </Link>
          <a href="#services" className="hero-cta-secondary">
            Explore Services
          </a>
        </div>

        <div className="hero-visual">
          <div className="hero-visual-card hero-visual-card-2">
            <div className="hvc-header">
              <div className="hvc-avatar">KO</div>
              <span className="hvc-name">KO AI</span>
            </div>
            <div className="hvc-text">
              I will build a content strategy for your product launch. What are
              you working on?
            </div>
          </div>
          <div className="hero-visual-card hero-visual-card-1">
            <div className="hvc-header">
              <div
                className="hvc-avatar"
                style={{
                  background: "linear-gradient(135deg, #D47575, #A855F7)",
                }}
              >
                PO
              </div>
              <span className="hvc-name">Precious Oyenuga</span>
            </div>
            <div className="hvc-text">
              Launching a 3-step skincare kit in 3 weeks. Target: women 22-38,
              urban, Instagram-active.
            </div>
            <div className="hvc-badges">
              <span className="hvc-badge hvc-badge-blue">Instagram</span>
              <span className="hvc-badge hvc-badge-green">Email</span>
              <span className="hvc-badge hvc-badge-gray">Blog</span>
            </div>
          </div>
          <div className="hero-visual-card hero-visual-card-3">
            <div className="hvc-header">
              <div className="hvc-avatar">KO</div>
              <span className="hvc-name">Strategy Ready</span>
            </div>
            <div className="hvc-text">
              The Fresh Drop — 21 day campaign. 6 carousels, 3 Reels, 4 stories,
              2 emails, 1 blog.
            </div>
            <div className="hvc-badges">
              <span className="hvc-badge hvc-badge-blue">
                Calendar Generated
              </span>
            </div>
          </div>
        </div>

        <div className="scroll-indicator">
          <span>Scroll to explore</span>
          <ChevronDown size={14} />
        </div>
      </section>

      {/* ── About ── */}
      <section className="about" id="about">
        <div className="about-grid">
          <div className="about-text reveal">
            <h2>We built KO OS for busy brand builders</h2>
            <p>
              KO OS is the Brand Brain — an AI-first workspace that turns your
              product ideas, audience, and goals into a full campaign strategy,
              a day-by-day content calendar, and design-ready briefs.
            </p>
            <p>
              We combine the speed of an AI strategist with the craft of a human
              design team so you can plan, create, and launch without juggling
              five tools.
            </p>
            <div className="about-stats">
              <div className="about-stat">
                <h4>3 min</h4>
                <p>From idea to strategy</p>
              </div>
              <div className="about-stat">
                <h4>24h</h4>
                <p>Design turnaround</p>
              </div>
              <div className="about-stat">
                <h4>1 home</h4>
                <p>For brand + content</p>
              </div>
            </div>
          </div>
          <div className="about-visual reveal">
            <div className="feature-card" style={{ height: "100%" }}>
              <div className="feature-icon blue">
                <Quote size={20} />
              </div>
              <h3>Our mission</h3>
              <p>
                Give every founder, marketer, and creator a clear brand brain
                that handles the heavy lifting so they can focus on what only
                humans can do — storytelling, taste, and connection.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founders ── */}
      <section className="founders" id="founders">
        <div className="section-header reveal">
          <h2>Meet the founders</h2>
          <p>The people shaping the future of brand building</p>
        </div>
        <div className="founders-grid">
          {FOUNDERS.map((f) => (
            <div className="founder-card reveal" key={f.initials}>
              <div className="founder-avatar">
                {f.image ? (
                  // biome-ignore lint/performance/noImgElement: static local avatar, no next/image layout needed
                  <img src={f.image} alt={f.name} width={84} height={84} />
                ) : (
                  f.initials
                )}
              </div>
              <h3>{f.name}</h3>
              <div className="founder-role">{f.role}</div>
              <p>{f.bio}</p>
              <div className="founder-socials">
                {FOUNDER_SOCIAL_ICONS.map(({ key, label, Icon }) => {
                  const href = f.socials[key];
                  if (!href) return null;
                  return (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${f.name} on ${label}`}
                    >
                      <Icon size={16} />
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Services ── */}
      <section className="features" id="services">
        <div className="section-header reveal">
          <h2>Services built for modern brands</h2>
          <p>
            From strategy to design, KO OS handles the full content pipeline
          </p>
        </div>
        <ServicesCarousel />
      </section>

      {/* ── How it works ── */}
      <section className="how-it-works" id="how">
        <div className="section-header reveal">
          <h2>How it works</h2>
          <p>Four steps from idea to published content</p>
        </div>
        <div className="steps-grid">
          {STEPS.map((s, i) => (
            <div
              className={`step-card reveal${i < STEPS.length - 1 ? " step-connector" : ""}`}
              key={s.n}
            >
              <div className="step-number">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Contact ── */}
      <section className="contact" id="contact">
        <div className="section-header reveal">
          <h2>Get in touch</h2>
          <p>
            Questions, partnerships, or just saying hello — we are here for it.
          </p>
        </div>
        <div className="contact-grid">
          <div className="contact-details reveal">
            <h3>Contact details</h3>
            <div className="contact-detail">
              <Mail size={16} />
              <a href={`mailto:${SOCIAL_LINKS.email}`}>{SOCIAL_LINKS.email}</a>
            </div>
            <div className="contact-detail">
              <Phone size={16} />
              <a href={`tel:${SOCIAL_LINKS.phone}`}>
                {SOCIAL_LINKS.phoneDisplay}
              </a>
            </div>
            <div className="contact-detail">
              <MapPin size={16} />
              <span>Nigeria</span>
            </div>
            <div className="contact-detail">
              <Clock size={16} />
              <span>Mon - Fri, 9am - 6pm WAT</span>
            </div>
            <div className="contact-socials">
              <a
                href={SOCIAL_LINKS.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={18} />
              </a>
              <a
                href={SOCIAL_LINKS.x}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
              >
                <Twitter size={18} />
              </a>
              <a
                href={SOCIAL_LINKS.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn"
              >
                <Linkedin size={18} />
              </a>
              <a
                href={SOCIAL_LINKS.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
              >
                <Tiktok size={18} />
              </a>
              <a
                href={SOCIAL_LINKS.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
              >
                <Whatsapp size={18} />
              </a>
            </div>
          </div>
          <div className="contact-form reveal">
            <div className={`form-success${contactSent ? " visible" : ""}`}>
              <CheckCircle2 size={16} /> Message sent. We will get back to you
              shortly.
            </div>
            {contactError && (
              <div
                className="form-success visible"
                role="alert"
                style={{ color: "var(--status-error-fg, #d47575)" }}
              >
                {contactError}
              </div>
            )}
            <form onSubmit={handleContactSubmit}>
              <div className="form-group">
                <label htmlFor="contactName">Name</label>
                <input
                  type="text"
                  id="contactName"
                  name="name"
                  placeholder="Your name"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="contactEmail">Email</label>
                <input
                  type="email"
                  id="contactEmail"
                  name="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="contactMessage">Message</label>
                <textarea
                  id="contactMessage"
                  name="message"
                  placeholder="How can we help?"
                  required
                />
              </div>
              <div aria-hidden="true" className="hp-field">
                <label htmlFor="contactCompany">Company</label>
                <input
                  type="text"
                  id="contactCompany"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                className="cta-btn"
                style={{ width: "100%" }}
                disabled={contactPending}
              >
                {contactPending ? "Sending…" : "Send Message"}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="cta-section">
        <div className="cta-card reveal">
          <h2>Ready to build your brand?</h2>
          <p>
            Join hundreds of brands using KO OS to plan, create, and launch
            campaigns.
          </p>
          <Link href={OPEN_APP_HREF} className="cta-btn">
            Open KO-OS <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── Theme strip ── */}
      <div className="theme-strip" id="themeToggleHost">
        <span className="theme-strip-label">Theme</span>
        <ThemeToggle />
      </div>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-col">
            <div className="footer-brand">
              <div className="brand-icon">KO</div>
              <span>KO OS</span>
            </div>
            <p className="footer-tagline">
              The Brand Brain that turns your ideas into campaigns, calendars,
              and design-ready assets.
            </p>
            <p className="footer-address">
              <MapPin size={14} /> Nigeria
            </p>
            <p className="footer-email">
              <Mail size={14} />{" "}
              <a href="mailto:hello@kocontentstudios.com">
                hello@kocontentstudios.com
              </a>
            </p>
            <div className="footer-socials">
              <a
                href={SOCIAL_LINKS.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={16} />
              </a>
              <a
                href={SOCIAL_LINKS.x}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
              >
                <Twitter size={16} />
              </a>
              <a
                href={SOCIAL_LINKS.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn"
              >
                <Linkedin size={16} />
              </a>
              <a
                href={SOCIAL_LINKS.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
              >
                <Tiktok size={16} />
              </a>
              <a
                href={SOCIAL_LINKS.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
              >
                <Whatsapp size={16} />
              </a>
            </div>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <a href="#services">Services</a>
            <a href="#how">How It Works</a>
            <Link href={OPEN_APP_HREF}>Open KO-OS</Link>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <a href="#about">About</a>
            <a href="#founders">Founders</a>
            <a href="#contact">Contact</a>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <a href="#home">Cookie Policy</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p className="footer-copyright">
            2026 KO OS — Brand Brain. All rights reserved.
          </p>
          <div className="footer-legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Services carousel (auto-advance 4s, pause on hover/focus, responsive) ── */
function ServicesCarousel() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [perView, setPerView] = useState(3);
  const [current, setCurrent] = useState(0);
  const hoveringRef = useRef(false);

  const maxIndex = Math.max(0, SERVICES.length - perView);

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      const clamped = Math.max(0, Math.min(index, maxIndex));
      setCurrent(clamped);
      if (track) {
        const gap = 24;
        const slideWidth = 100 / perView;
        const gapPct = (gap / track.offsetWidth) * 100;
        const offset = clamped * (slideWidth + gapPct / perView);
        track.style.transform = `translateX(-${offset}%)`;
      }
    },
    [maxIndex, perView],
  );

  // Responsive perView
  useEffect(() => {
    function recalc() {
      const w = window.innerWidth;
      setPerView(w <= 600 ? 1 : w <= 1024 ? 2 : 3);
    }
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  // Re-apply the transform whenever the layout (goTo identity) changes.
  // goTo already depends on perView + maxIndex, so this covers resize.
  useEffect(() => {
    goTo(current);
  }, [current, goTo]);

  // Autoplay
  useEffect(() => {
    const timer = setInterval(() => {
      if (hoveringRef.current) return;
      setCurrent((c) => {
        const nextIndex = c >= maxIndex ? 0 : c + 1;
        goTo(nextIndex);
        return nextIndex;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [maxIndex, goTo]);

  const dots = Array.from({ length: maxIndex + 1 });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus only pauses autoplay; all real controls are buttons
    <div
      className="services-carousel reveal"
      onMouseEnter={() => {
        hoveringRef.current = true;
      }}
      onMouseLeave={() => {
        hoveringRef.current = false;
      }}
      onFocus={() => {
        hoveringRef.current = true;
      }}
      onBlur={() => {
        hoveringRef.current = false;
      }}
    >
      <button
        type="button"
        className="carousel-arrow carousel-prev"
        aria-label="Previous service"
        onClick={() => goTo(current <= 0 ? maxIndex : current - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="carousel-window">
        <div className="carousel-track" ref={trackRef}>
          {SERVICES.map((s) => {
            const Icon = s.icon;
            return (
              <div className="feature-card" key={s.title}>
                <div className={`feature-icon ${s.cls}`}>
                  <Icon size={20} />
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="carousel-arrow carousel-next"
        aria-label="Next service"
        onClick={() => goTo(current >= maxIndex ? 0 : current + 1)}
      >
        <ChevronRight size={16} />
      </button>
      <div className="carousel-dots">
        {dots.map((_, i) => (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
            key={i}
            className={`carousel-dot${i === current ? " active" : ""}`}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}
