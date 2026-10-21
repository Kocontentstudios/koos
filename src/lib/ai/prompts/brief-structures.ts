import { type DesignFormat, formatRules } from "@/lib/design/formats";

/**
 * Per-format design brief structures, shared by the design-request brief
 * generator and the calendar item brief writer so every brief the AI produces
 * is structured, production-ready markdown instead of one block of text.
 */
export const BRIEF_STRUCTURES = `Structure every brief as clearly labelled markdown sections (bold section headings, blank line between sections). Pick the template matching the content format and adapt it — do not force one layout onto every request:

CAROUSEL:
**Title** / **Objective** / **Slide 1** … **Slide N** (one section per slide, with the exact copy for that slide) / **Caption** / **Call-to-Action (CTA)** / **Design Notes / Visual Direction**

SINGLE (STATIC) DESIGN (post, flyer, banner, story, ad):
**Request Title** / **Objective** / **Text Overlay** (exact words on the design) / **Supporting Copy** (if applicable) / **Visual Direction / Image Suggestion** / **Branding Requirements** / **Call-to-Action (CTA)**

LINKEDIN POST / ARTICLE:
**Title** / **Main Content** (or full article) / **Supporting Caption** (if applicable) / **Call-to-Action (CTA)** / **Suggested Visual or Cover Image**

VIDEO:
**Video Title** / **Objective** / **Concept Summary** / **Scene Breakdown or Script** / **Text Overlays** / **Visual Direction** / **Caption** / **Call-to-Action (CTA)**

Always include the execution details a designer needs — CTAs, captions, visual direction, branding notes — so the brief is complete with little or no manual editing.`;

/**
 * One brief structure per deliverable format — KOOS-AI-001, the ticket's
 * "brief structure changes appropriately for each deliverable" criterion.
 *
 * The block above stays for the calendar writer: one of its calls drafts the
 * briefs for a whole chunk of calendar slots whose formats differ from each
 * other, so no single structure can serve that prompt. The design-request path
 * writes one brief at a time and knows its format first, and a chosen
 * structure beats four templates and an instruction to pick: "post, flyer,
 * banner, story, ad" shared one mould, so a thumbnail that can carry four
 * words was asked for supporting copy and a flyer's venue and phone number had
 * no section of their own.
 *
 * The sections are module 01 §2's required-content list and §3's four content
 * levels — primary, secondary, action, utility — specialised per format, plus
 * module 05 §1-2's rule that contact details, handles, addresses and sponsor
 * marks are what earn a footer and the order they go in. Module 08 is NOT a
 * source here: it is organised by what the design is selling, which is the
 * category axis, and it feeds playbooks.ts. A format that cannot
 * carry a level does not ask for it: asking is an invitation to fill it.
 */
export interface BriefSection {
  name: string;
  /** What this section must contain, in the designer's terms. */
  asks: string;
}

const SECTIONS: Record<DesignFormat, BriefSection[]> = {
  "social-post": [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the post should achieve" },
    {
      name: "Headline",
      asks: "the exact words that go on the design, verbatim",
    },
    {
      name: "Supporting Copy",
      /* Module 01 §3's secondary level, which is where a date, a price or
         what-is-included belongs — not the footer, whose three lines have no
         room for it. Without this the most requested format had nowhere to
         carry a fact the user supplied. */
      asks: "one short line if the message needs it, plus any date, time, price or what-is-included the user supplied, verbatim; otherwise say none",
    },
    {
      name: "Call-to-Action",
      asks: "the single action, in the words it should appear in",
    },
    /* The renderer gained a footer band in 3c663fb, and this is the format it
       draws most often. Without a section for them, a handle or an order line
       the user asked for has nowhere to land, and the spec step would have to
       invent the footer's contents. */
    {
      name: "Footer Content",
      /* Module 05 §2's order exactly: main action or primary contact
         first, then secondary contact or website, then the social handle,
         then address or terms. footerLines is capped at three, so a list in
         the wrong order drops the manual's first item first — which a real
         run did, demoting the order line below the handle. */
      asks: 'in this priority order: the order channel or primary contact, then website or secondary contact, then social handle, then address or terms — keep only what fits three short lines, or write "no footer", which module 05 §1 calls a design decision rather than an unfinished state',
    },
    { name: "Caption", asks: "the post copy that ships with the image" },
    {
      name: "Visual Direction",
      asks: "subject, crop, mood, where the copy sits",
    },
    {
      name: "Branding Requirements",
      asks: "logo use, colours, typography, anything to avoid",
    },
  ],
  carousel: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the set should achieve" },
    {
      name: "Slide-by-Slide Copy",
      asks: "one numbered subsection per slide (Slide 1, Slide 2, …) carrying that slide's exact copy; slide 1 earns the swipe, each middle slide carries one point, the last carries the action",
    },
    {
      name: "Through-line",
      asks: "the type, palette and layout rules every slide shares so the set reads as one piece",
    },
    { name: "Call-to-Action", asks: "on the final slide" },
    { name: "Caption", asks: "the post copy that accompanies the set" },
    {
      name: "Visual Direction",
      asks: "subject, crop, mood, how the frames relate",
    },
  ],
  flyer: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the flyer should achieve" },
    { name: "Headline", asks: "the exact words, verbatim" },
    {
      name: "Supporting Copy",
      asks: "the explanation or benefit, kept short",
    },
    {
      name: "Utility Details",
      asks: "date, time, venue, price, phone, handle, address: list every one supplied, and name any the user asked for but did not supply so it reaches the designer as a gap rather than an invention",
    },
    {
      name: "Call-to-Action",
      asks: "the instruction — how to register, order or attend",
    },
    {
      name: "Visual Direction",
      asks: "subject, crop, mood, where the copy sits",
    },
    {
      name: "Branding Requirements",
      asks: "logo use, colours, typography, anything to avoid",
    },
  ],
  /* Module 08 §3 orders event work date/venue above the action, and names
     sponsor marks as content. A poster is also read twice — across a room,
     then up close — so its secondary level is what rewards the second read,
     not a generic supporting line. */
  poster: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the poster should achieve" },
    {
      name: "Headline",
      asks: "the one statement that must read across a room, verbatim, and nothing else at that size",
    },
    {
      name: "Step-Closer Detail",
      asks: "what rewards someone who walks up to it: topic, programme, speakers, what is included",
    },
    {
      name: "Schedule & Location",
      asks: "date, time, doors, venue and address, each exactly as supplied",
    },
    {
      name: "Action & Access",
      asks: "the action plus how it is reached from a printed surface — QR, short link, box office, tickets at the gate",
    },
    {
      name: "Credits & Sponsor Marks",
      asks: "partner logos, sponsors, organisers and any required legal line; a logo row costs layout space, so name them or say there are none",
    },
    {
      name: "Visual Direction",
      asks: "the single image idea that carries at distance",
    },
    {
      name: "Branding Requirements",
      asks: "logo use, colours, typography, anything to avoid",
    },
  ],
  banner: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the banner should achieve" },
    {
      name: "Headline",
      asks: "very short; a banner is wide and shallow and a long line will not fit",
    },
    {
      name: "Call-to-Action",
      asks: "one action, with nothing competing with it",
    },
    {
      name: "Layout Split",
      asks: "which side carries the copy and which the subject; a centred stack wastes this shape",
    },
    { name: "Visual Direction", asks: "subject, crop, mood" },
    {
      name: "Branding Requirements",
      asks: "logo use, colours, typography, anything to avoid",
    },
  ],
  thumbnail: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "the click it has to earn" },
    {
      name: "Headline",
      asks: "three or four words at most, verbatim, sized to read at a few hundred pixels",
    },
    {
      name: "Focal Subject",
      asks: "the one face, object or moment, and how tightly it is cropped",
    },
    {
      name: "Contrast Note",
      asks: "what makes this read beside competing thumbnails",
    },
    {
      name: "Branding Requirements",
      asks: "minimal; a thumbnail has no room for a footer or a full logo lock-up",
    },
  ],
  presentation: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the deck has to land" },
    {
      name: "Slide-by-Slide Copy",
      asks: "one numbered subsection per slide (Slide 1, Slide 2, …) with its heading and body copy",
    },
    {
      name: "Master Layout",
      asks: "the type scale, palette and furniture every slide repeats",
    },
    { name: "Visual Direction", asks: "imagery, charts, tone" },
    {
      name: "Production Note",
      asks: "what the automated renderer can and cannot deliver here",
    },
  ],
  logo: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the mark has to stand for" },
    {
      name: "Name / Wordmark Text",
      asks: "the exact spelling and capitalisation",
    },
    {
      name: "Associations",
      asks: "what it should feel like, and what it must not resemble",
    },
    { name: "Usage", asks: "the sizes and grounds it has to survive" },
    {
      name: "Production Note",
      asks: "what the automated renderer can and cannot deliver here",
    },
  ],
  "print-collateral": [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the piece has to do" },
    {
      name: "Copy",
      asks: "every piece of text that is not a contact detail, verbatim, front and back where it applies",
    },
    {
      name: "Utility Details",
      asks: "the contact block only: name, role, phone, email, address, handles",
    },
    {
      name: "Specification",
      asks: "finished size, orientation, stock and finish if known",
    },
    { name: "Visual Direction", asks: "imagery, materials, tone" },
    {
      name: "Production Note",
      asks: "what the automated renderer can and cannot deliver here",
    },
  ],
  motion: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the piece has to achieve" },
    { name: "Concept Summary", asks: "the idea in two or three sentences" },
    {
      name: "Frame-by-Frame Beats",
      asks: "one numbered subsection per beat (Frame 1, Frame 2, …) with the on-screen copy for each",
    },
    { name: "Text Overlays", asks: "exact words" },
    { name: "Audio & Pace", asks: "music feel, voiceover, duration" },
    {
      name: "Production Note",
      asks: "what the automated renderer can and cannot deliver here",
    },
  ],
  "product-ui": [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "the task the user is trying to finish" },
    {
      name: "Screen-by-Screen Content",
      asks: "one numbered subsection per screen (Screen 1, Screen 2, …) with its real content, states and empty cases",
    },
    {
      name: "Component Inventory",
      asks: "the controls each screen needs",
    },
    { name: "Visual Direction", asks: "density, tone, reference products" },
    {
      name: "Production Note",
      asks: "what the automated renderer can and cannot deliver here",
    },
  ],
  /* The fallback for an unrecognised label and for "Custom Request", so it
     must be the general case rather than any one format's template. Module 01
     §2's required-content list, nothing format-specific layered on. */
  other: [
    { name: "Request Title", asks: "short internal name for the request" },
    { name: "Objective", asks: "what the design should achieve" },
    {
      name: "Main Message",
      asks: "the one idea the viewer must remember, verbatim where the user gave the words",
    },
    {
      name: "Required Content",
      asks: "every piece of text, fact, date, price, product detail and contact the design must carry — each verbatim, or named as a gap where the user asked for it and did not supply it",
    },
    { name: "Action", asks: "exactly what the viewer should do" },
    {
      name: "Visual Direction",
      asks: "subject, crop, mood, where the copy sits",
    },
    {
      name: "Branding Requirements",
      asks: "logo use, colours, typography, anything to avoid",
    },
  ],
};

export function briefSectionsFor(
  format: DesignFormat,
): readonly BriefSection[] {
  return SECTIONS[format];
}

/** The headings this format declares. The eval scorer reads the brief against
 *  exactly these, so it never has to guess whether a bold run is a heading or
 *  the model emphasising a line of copy. */
export function sectionNamesFor(format: DesignFormat): string[] {
  return SECTIONS[format].map((section) => section.name);
}

export function briefStructureFor(format: DesignFormat): string {
  const rules = formatRules(format);
  /* Deliberately does not name the section: the section list is the only place
     that declares it, so a test asserting the heading is present proves the
     list carries it rather than matching this sentence. */
  const limitation = rules.generatable
    ? null
    : `The automated renderer produces one flat still image, which is not this deliverable. ${rules.guidance} State that limitation plainly in the section the list reserves for it, and brief the closest still frame the renderer can produce.`;

  return [
    "Write the brief as markdown with exactly these sections, in this order, each heading bold and separated by a blank line:",
    "",
    SECTIONS[format]
      .map((section) => `**${section.name}** — ${section.asks}`)
      .join("\n"),
    "",
    `Keep the headline to roughly ${rules.headlineWords} words or fewer — ${rules.guidance}`,
    "Reproduce supplied copy, names, prices, dates and venues exactly as the user gave them. Where the user asked for a detail but never supplied its value, say so in its section rather than inventing a plausible one; an invented phone number on a finished design is the error nobody catches.",
    "Every heading above appears, in order, even where the answer is short. Where a section has nothing to carry, write the heading and say so in a few words — a brief that silently omits a heading reads as unfinished, while one that states the section is not needed is a decision.",
    limitation,
  ]
    .filter((part) => part !== null)
    .join("\n");
}
