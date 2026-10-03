/**
 * Benchmark briefs — KOOS-AI-001 deliverable #8.
 *
 * Five briefs, each run twice: once with the design-training system off
 * (the pipeline as it was) and once on. Same brand, same brief, same model,
 * so the only variable is the training system.
 *
 * Chosen to exercise what the training system claims to change rather than to
 * flatter it:
 *   - a format whose reading conditions differ sharply from a social post,
 *   - a category whose priority order is not "product first",
 *   - a brief missing a fact the design needs, where inventing one is the
 *     documented failure,
 *   - a deliverable the still renderer cannot produce at all,
 *   - a plain social post, as the control that should change least.
 */

export interface BenchmarkCase {
  id: string;
  designType: string;
  dimensions: string;
  platform: string;
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  briefText: string;
  /** What a good answer does here, for the report. Not auto-scored — the
   *  deterministic checks cover what can be measured, and a human reads the
   *  rest against this line. */
  looksLike: string;
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "thumbnail-reading-distance",
    designType: "Video Thumbnail",
    dimensions: "1280x720",
    platform: "YouTube",
    aspectRatio: "16:9",
    briefText:
      "Episode 4 of our series on starting a food business in Lagos. Guest is Amaka Obi, who runs three pastry shops. Make it click.",
    looksLike:
      "Three or four very large words, one face, extreme contrast. Not a paragraph at social-post size.",
  },
  {
    id: "recruitment-priority-order",
    designType: "Flyer",
    dimensions: "1080x1350",
    platform: "Instagram",
    aspectRatio: "4:5",
    briefText:
      "We are hiring a senior delivery rider. Full time, Lagos mainland. Applications close 28 October. Send a WhatsApp message to apply.",
    looksLike:
      "Leads with the role, not the company name or the logo. Deadline is legible, not decorative.",
  },
  {
    id: "missing-fact-placeholder",
    designType: "Flyer",
    dimensions: "1080x1350",
    platform: "Instagram",
    aspectRatio: "4:5",
    briefText:
      "Weekend promo on our meat pies. Call us to order — put our number on it. Delivery across Yaba.",
    looksLike:
      "A placeholder where the phone number belongs. Inventing a plausible number is the failure this case exists to catch.",
  },
  {
    id: "unproducible-format",
    designType: "Motion Graphics",
    dimensions: "1080x1080",
    platform: "Instagram",
    aspectRatio: "1:1",
    briefText:
      "A short animated loop of our logo forming out of flour dust for the shop anniversary.",
    looksLike:
      "Says plainly that a still renderer cannot produce motion, and offers the closest useful still.",
  },
  {
    /* The same missing-fact rule, but for a fact that belongs in the COPY
       rather than in contact details. If this one gets a placeholder and
       missing-fact-placeholder does not, the gap is the spec having nowhere to
       put contact details — a schema and renderer problem, not a prompt one. */
    id: "missing-fact-in-copy",
    designType: "Flyer",
    dimensions: "1080x1350",
    platform: "Instagram",
    aspectRatio: "4:5",
    briefText:
      "Our anniversary tasting event. Put the date on it prominently so people can plan. Free entry, limited spaces.",
    looksLike:
      "A visible placeholder where the date belongs. The brief named the date as the thing to feature, and no date was supplied.",
  },
  {
    id: "control-social-post",
    designType: "Social Media Post",
    dimensions: "1080x1080",
    platform: "Instagram",
    aspectRatio: "1:1",
    briefText: "New seasonal flavour: suya chicken pie, in shops from Friday.",
    looksLike:
      "The control. A competent product post either way; large differences here would suggest noise rather than improvement.",
  },
];
