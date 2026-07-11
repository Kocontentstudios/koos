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
