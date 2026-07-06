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
  Mail,
  MapPin,
  Menu,
  Paintbrush,
  PenTool,
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

const FOUNDERS = [
  {
    initials: "OK",
    name: "Obafela Killa",
    role: "Founder & CEO",
    bio: "Visionary and operator driving the KO OS mission to make brand building faster, smarter, and more creative.",
    image: "/founders/obafela_killa.jpg",
  },
  {
    initials: "PO",
    name: "Precious Oyenuga",
    role: "Co-founder & CCPO",
    bio: "Chief Creative and Product Officer. Shapes product experience, creative direction, and the brand voice that users feel.",
    image: "/founders/precious_oyenuga.jpg",
  },
  {
    initials: "OI",
    name: "Oluwaseyi Idowu",
    role: "Co-founder & CTO",
    bio: "Architects the technology behind KO OS, ensuring every AI feature and design workflow runs at scale.",
    image: "/founders/oluwaseyi_idowu.jpg",
  },
];

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
                <a
                  href="https://linkedin.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="LinkedIn"
                >
                  <Linkedin size={16} />
                </a>
                <a
                  href="https://x.com"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="X"
                >
                  <Twitter size={16} />
                </a>
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
              <span>hello@kocontentstudios.com</span>
            </div>
            <div className="contact-detail">
              <MapPin size={16} />
              <span>Lagos, Nigeria</span>
            </div>
            <div className="contact-detail">
              <Clock size={16} />
              <span>Mon - Fri, 9am - 6pm WAT</span>
            </div>
            <div className="contact-socials">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={18} />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
              >
                <Twitter size={18} />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                aria-label="LinkedIn"
              >
                <Linkedin size={18} />
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
              <MapPin size={14} /> Lagos, Nigeria
            </p>
            <p className="footer-email">
              <Mail size={14} />{" "}
              <a href="mailto:hello@kocontentstudios.com">
                hello@kocontentstudios.com
              </a>
            </p>
            <div className="footer-socials">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={16} />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
              >
                <Twitter size={16} />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                aria-label="LinkedIn"
              >
                <Linkedin size={16} />
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
