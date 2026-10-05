import type { DesignCategory } from "./playbooks";

/**
 * Infer the design CATEGORY from the words the request used.
 *
 * The chat path can be asked for a category outright, but the form and
 * quick-request paths never call a model (src/lib/design/quick-request.ts) and
 * still need a playbook. A wrong guess costs a less apt playbook, never a
 * wrong fact, so this leans on unambiguous signals and falls back rather than
 * reaching for a weak match.
 *
 * Order matters: the first rule that matches wins, and the rules are sorted by
 * how decisively the signal names the communication job, not alphabetically.
 * Three orderings are deliberate and were each wrong first time:
 *   - OFFER above food: a discount on pastries communicates the deal, and the
 *     offer playbook leads with it.
 *   - EDUCATION above recruitment: "admission … apply before September" is a
 *     school intake, but "apply by" alone reads as a job advert.
 *   - PERSONAL-BRAND above educational: "3 lessons I learned … CEO" is a
 *     person speaking, and the portrait is the recognition anchor; the same
 *     words without a person are a teaching graphic.
 */

const RULES: [RegExp, DesignCategory][] = [
  [
    /\b\d{1,3}\s?%\s?(off|discount)|\bdiscount\b|\bpromo code\b|\bcoupon\b|\bsale ends\b|\bflash sale\b|\bbuy one\b|\blimited time\b/i,
    "offer",
  ],
  [
    /\b(admission|enrol\w*|enroll\w*|school|students?|pupils?|jss\d|sss\d|semester|scholarship|curriculum|academy)\b/i,
    "education",
  ],
  [
    /\b(hiring|recruit\w*|vacanc\w+|job opening|apply (now|by|before)|we are looking for|join our team|cv|résumé|resume)\b/i,
    "recruitment",
  ],
  [
    /\b(event|webinar|conference|summit|workshop|masterclass|seminar|meetup|concert|festival|speaker|panel|rsvp|register now|doors open)\b/i,
    "event",
  ],
  [
    /\b(happy (new month|new year|birthday|holidays?|easter|christmas)|eid|ramadan|anniversary|season'?s greetings|independence day)\b/i,
    "celebration",
  ],
  [
    /\b(i learned|my journey|lessons? (i|from)|founder|ceo|thought leadership|personal brand|op-?ed)\b/i,
    "personal-brand",
  ],
  [
    /\b(\d+\s+(tips|lessons|ways|steps|things|reasons)|how to|did you know|guide to|explained|myth|checklist|thread)\b/i,
    "educational",
  ],
  [
    /\b(send money|transfer|wallet|bank|fintech|loan|savings|investment|payment|zero fees|cashback|app store|google play)\b/i,
    "finance",
  ],
  [
    /\b(menu|meal|pastry|pastries|cake|pizza|restaurant|bakery|catering|recipe|meat pie|smoothie|platter|freshly (baked|made)|order (now|today) for delivery)\b/i,
    "food",
  ],
  [
    /\b(gadget|device|earbuds|headphones|laptop|smartphone|battery|software|platform|saas|ai|hardware|wireless|charger)\b/i,
    "technology",
  ],
  [
    /\b(we (clean|repair|install|consult|manage|design|build)|our services?|book (a|an) (visit|appointment|consultation)|consultation|maintenance|agency)\b/i,
    "service",
  ],
];

export function inferCategory(
  text: string | null | undefined,
  designType?: string | null,
): DesignCategory {
  const haystack = `${text ?? ""} ${designType ?? ""}`.trim();
  if (!haystack) return "product";

  for (const [pattern, category] of RULES) {
    if (pattern.test(haystack)) return category;
  }

  /* The most common commercial case, and the least wrong default: its priority
     order (subject → benefit → CTA → utility) is close to the cross-playbook
     rule the manual states for every category. */
  return "product";
}
