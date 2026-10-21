/**
 * Design-type playbooks — module 08 of the AI Design Training System.
 *
 * Source: docs/design-training/koos_design_system/08 — Design-Type Playbooks.
 *
 * These are the starting logic for a category when the user names what they
 * want but gives no art direction. The manual's own framing: "The category
 * determines the communication structure; the brand determines how that
 * structure looks and feels; the current message determines what changes."
 *
 * Category is WHAT THE DESIGN SELLS. It is a different axis from the FORMAT
 * (src/lib/design/formats.ts), which is what the deliverable is and how it is
 * read. A food promotion can be a flyer, a thumbnail or a carousel, and the
 * playbook holds either way.
 *
 * Kept as data rather than prose in a prompt string so the routing is
 * testable, the manual's wording stays traceable, and a category can be
 * revised without rewriting a prompt by hand.
 */

export const DESIGN_CATEGORIES = [
  "product",
  "service",
  "event",
  "recruitment",
  "education",
  "food",
  "technology",
  "finance",
  "celebration",
  "personal-brand",
  "educational",
  "offer",
] as const;

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export interface Playbook {
  /** Ranked content order. This decides what becomes the headline and what
   *  becomes utility text, so it is the most load-bearing field here. */
  priority: string[];
  composition: string;
  imagery: string;
  background: string;
  footer: string;
  avoid: string[];
}

const PLAYBOOKS: Record<DesignCategory, Playbook> = {
  product: {
    priority: ["product", "benefit or offer", "CTA", "utility details"],
    composition:
      "One hero product at large scale; secondary products smaller and further back. A platform, controlled cluster, hand-held presentation, or contextual use scene.",
    imagery:
      "Preserve packaging, labels, proportions and functional details. Three-quarter view for dimensional products, close-up for texture, eye-level for clarity.",
    background:
      "The brand environment with enough separation around the product. Product colours may inform supporting shapes, but the brand system stays authoritative.",
    footer: "Compact order or contact bar, or a product-stage footer.",
    avoid: [
      "equal emphasis on every product",
      "distorted packaging or hidden labels",
      "decorative effects that make the item look inaccurate",
    ],
  },
  service: {
    priority: [
      "service promise",
      "benefit",
      "proof or context",
      "CTA",
      "contact",
    ],
    composition:
      "Left message with the person on the right is a reliable default. For several services, a controlled grid with equal card treatment.",
    imagery:
      "Show the service happening, its result, or a credible representative. Generic smiling imagery is weaker than visible service context.",
    background:
      "Clean branded field, subtle workplace or environmental cues, and a protected text zone.",
    footer:
      "Full-width contact strip, floating contact bar, or a text-only footer for premium services.",
    avoid: [
      "too many service bullets",
      "unrelated stock photography",
      "a weak CTA and tiny contact details",
    ],
  },
  event: {
    priority: [
      "event name",
      "topic or value",
      "speaker",
      "date and time",
      "CTA",
      "sponsors",
    ],
    composition:
      "A stable information column with the speaker image opposite; a centred stack for a single major event; a grid only when several speakers need equal treatment.",
    imagery:
      "Clear speaker portrait, appropriate crop, accurate identity, expression matching authority or energy.",
    background:
      "Contextual but controlled. Protect dates and registration details from texture.",
    footer:
      "Registration link, sponsor strip, or a compact event-information panel.",
    avoid: [
      "treating every detail as a headline",
      "obscuring the dates",
      "decorative elements mistaken for information",
    ],
  },
  recruitment: {
    priority: [
      "role or opportunity",
      "organisation",
      "requirements or benefit",
      "deadline",
      "application CTA",
    ],
    composition:
      "A bold headline above or beside one representative person; cards when there are several roles.",
    imagery:
      "Confident, relevant people or team context. Gaze and gesture should direct attention toward the role information.",
    background:
      "Credible and energetic without looking like entertainment advertising, unless the brand requires it.",
    footer: "Application URL, email, deadline and location grouped clearly.",
    avoid: [
      "small deadlines",
      "vague role naming",
      "decorative icons that resemble requirement bullets",
    ],
  },
  education: {
    priority: [
      "admission or programme name",
      "learner level",
      "key benefit",
      "application period",
      "contact",
    ],
    composition:
      "Headline and information on one side, student imagery on the other. A grid for subjects, levels or benefits.",
    imagery:
      "Students of the correct age and educational context. Eye-level or slightly low angles for confidence, warm expressions for approachability.",
    background:
      "Clean learning environment, campus cue, books, technology, or restrained academic motifs.",
    footer:
      "School contact, location, website and the application action in a stable strip or ribbon.",
    avoid: [
      "incorrect student age for the programme",
      "unreadable programme details",
      "childish decoration for older learners",
      "unverified claims",
    ],
  },
  food: {
    priority: [
      "food or product",
      "appetite appeal",
      "product name or offer",
      "order CTA",
      "contact",
    ],
    composition:
      "One hero item in the foreground with supporting products behind. Three-quarter view for shape and layers, top-down for assortments, close-up for texture.",
    imagery:
      "Realistic texture, believable glaze, crumbs, fillings, packaging and serving context. Light should reveal freshness and form.",
    background:
      "Brand-led serving environment or a simple product stage. Ingredients may support the story but must not compete with the food.",
    footer: "Order bar, delivery information, or a compact contact panel.",
    avoid: [
      "plastic-looking food",
      "too many equal items",
      "invented discounts",
      "product imagery disconnected from the packaging",
    ],
  },
  technology: {
    priority: [
      "headline or benefit",
      "hero device",
      "supporting devices",
      "CTA",
      "contact or trust",
    ],
    composition:
      "Floating product curve, digital platform, or a lifestyle user interacting with devices. One device or person stays dominant.",
    imagery:
      "Crisp screens, accurate ports and forms, believable reflections, controlled floating shadows. Lifestyle poses should demonstrate use.",
    background:
      "Digital gradient, radial glow, interface-inspired shapes, or a clean modern environment derived from the brand.",
    footer: "Interface-style rounded contact panel or a standard campaign bar.",
    avoid: [
      "impossible device geometry",
      "too many equally large gadgets",
      "mismatched reflections",
      "effects covering the screens",
    ],
  },
  finance: {
    priority: [
      "promise",
      "product interface or card",
      "benefit or proof",
      "CTA",
      "download or access",
    ],
    composition:
      "The phone or card is the product hero. Hands, route lines, receipt confirmations, maps or lifestyle scenes only when connected to the promise.",
    imagery:
      "The interface must be readable and accurate. Perspective may add energy, but critical UI must not be distorted.",
    background:
      "A trustworthy branded environment with clear hierarchy and controlled depth.",
    footer:
      "Website capsule, app-store badges, sign-up action, or a standard download strip.",
    avoid: [
      "generic money imagery with no product connection",
      "inaccurate UI",
      "excessive security claims",
      "tiny download badges",
    ],
  },
  celebration: {
    priority: [
      "greeting",
      "brand presence",
      "emotional image or motif",
      "optional short wish",
    ],
    composition:
      "Centred greeting, expressive lettering, or a lifestyle scene with generous space. The brand stays visible without turning the post into a sale.",
    imagery:
      "Culturally and seasonally relevant motifs, used with restraint — two or three meaningful elements beat a collection of symbols.",
    background:
      "Warm and uncluttered; the greeting is the subject, not the decoration around it.",
    footer:
      "Often unnecessary. A small brand signature or compact contact treatment only when the campaign calls for it.",
    avoid: [
      "overcrowding with unrelated holiday symbols",
      "a large sales CTA in a relationship-building post",
      "weak brand recognition",
    ],
  },
  "personal-brand": {
    priority: [
      "insight or hook",
      "person",
      "supporting statement",
      "name and role",
      "optional CTA",
    ],
    composition:
      "Editorial text-led layout, a portrait on one side, or a centred quotation system. Portrait treatment and title placement repeat across the series.",
    imagery:
      "Consistent portrait lighting, crop, expression and background treatment — the person is the recognition anchor.",
    background:
      "Restrained enough for reading; recurring shapes or editorial lines can create a series system.",
    footer:
      "Name, role, handle or a small series label — not a heavy commercial footer.",
    avoid: [
      "changing the portrait style every post",
      "decorative quotation marks with no function",
      "excessive copy",
      "typography inconsistent with the person's positioning",
    ],
  },
  educational: {
    priority: [
      "topic",
      "key point",
      "structured supporting information",
      "source or CTA",
    ],
    composition:
      "Title plus a numbered sequence, cards, comparison, diagram or checklist. Icons only where they aid comprehension.",
    imagery:
      "Secondary to the information unless a demonstration is essential.",
    background:
      "Quiet and high-contrast, because this is read rather than glanced at.",
    footer: "Source, handle, website, or a save/share action.",
    avoid: [
      "paragraph-heavy blocks",
      "decorative icons with no meaning",
      "weak grouping and too many type sizes",
    ],
  },
  offer: {
    priority: [
      "offer",
      "product or service",
      "deadline or condition",
      "CTA",
      "contact",
    ],
    composition:
      "An offer badge or large numerical statement paired with a clear hero. Terms stay nearby but subordinate.",
    imagery:
      "The product stays credible; urgency comes from hierarchy, not visual chaos.",
    background:
      "Enough contrast for the number to dominate without the product becoming unreadable.",
    footer: "A strong action bar with the ordering channel and concise terms.",
    avoid: [
      "invented scarcity or hidden conditions",
      "making every element urgent",
      "overwhelming the product with the discount",
    ],
  },
};

export function playbook(category: DesignCategory): Playbook {
  return PLAYBOOKS[category];
}

/** The playbook as a prompt block. Ordered deliberately: priority first,
 *  because it decides what becomes the headline. */
export function playbookBlock(category: DesignCategory): string {
  const entry = PLAYBOOKS[category];
  return [
    `Category: ${category}.`,
    `Lead with, in this order: ${entry.priority.join(" → ")}.`,
    `Composition: ${entry.composition}`,
    `Imagery: ${entry.imagery}`,
    `Background: ${entry.background}`,
    `Footer intent: ${entry.footer}`,
    `Avoid: ${entry.avoid.join("; ")}.`,
  ].join("\n");
}
