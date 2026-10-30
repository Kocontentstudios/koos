import { inferCategory } from "@/lib/ai/design-training/infer-category";
import { playbookBlock } from "@/lib/ai/design-training/playbooks";
import type { DesignContext } from "@/lib/design/context";
import { formatRules } from "@/lib/design/formats";
import type {
  FrameBeat,
  FrameRole,
  SequenceImageSource,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { inBrief } from "@/lib/jobs/directions/brief-read";
import { COPY_LIMITS, COPY_TARGETS } from "@/lib/jobs/directions/schema";
import {
  buildDesignSpecSystemPrompt,
  type DesignSpecPromptOptions,
} from "./design-spec";
import type { BrandSummary } from "./strategy";

/**
 * The art-director prompts for a carousel or presentation written as a set
 * of frames (KOOS-AI-002). Built on the single-spec system prompt, as the
 * directions prompt is, so every rule the spec path learned (facts,
 * palette, logo, layout memory) holds on every frame.
 *
 * Two asks, outline then copy. The outline lays out the arc (each frame's
 * point and which brief facts it carries) and is held to the roles and
 * coverage in code before a word of copy exists; the copy call then writes
 * to that outline. A model asked for N frames of copy in one go writes one
 * ad cut into N pieces: the outline is where the story is decided.
 */

const t = COPY_TARGETS;

/* Module 10 of the training manual (a consistent pack), read for a set
   that is swiped or clicked through in order. */
const PACK_RULES = `

You are designing a SET of frames that are seen in order, one after another, as one piece. Module 10 of the brand's design system applies: the set repeats the brand's way of making decisions, not one finished design.
- The first frame earns the swipe. It names what is on offer and gives the viewer a reason to see the next frame. It is not the whole pitch, and it carries no button.
- Every middle frame carries one point, and only one. A frame that makes two points is two frames squeezed into one; a point already made is not made again.
- The last frame carries the action: what to do, and how. It is the only frame with a button.
- Fixed across every frame: one palette, one type system, one logo position, one footer system, one tone of voice. Varied freely: the composition, the headline, the image and its crop. Neighbouring frames never share a layout.
- Read in order, the frames are one story: hook, then one point per frame, then the action. Each headline moves the story on; none restates another in different words.`;

export function buildSequenceSystemPrompt(
  brand: BrandSummary,
  hasLogo: boolean,
  options: DesignSpecPromptOptions = {},
): string {
  return `${buildDesignSpecSystemPrompt(brand, hasLogo, options)}${PACK_RULES}`;
}

/* The format's own guidance where it speaks of a set (formats.ts carousel);
   formats.ts still briefs a presentation as one title slide, which is the
   single-design path's limitation, not this one's. */
function formatGuidance(kind: SequenceKind): string {
  const rules = formatRules(kind);
  const guidance =
    kind === "carousel"
      ? rules.guidance
      : "A deck: slides read on a screen in a room or a meeting, one idea per slide. The title slide earns attention, each slide after it makes one point in a short statement, and the closing slide says what to do next. Slides share a master: type, palette and logo position stay put while the composition changes.";
  return `Deliverable format: ${kind}. ${guidance} Keep each headline to ${rules.headlineWords} words or fewer.`;
}

function frameNoun(kind: SequenceKind): string {
  return kind === "presentation" ? "slide" : "frame";
}

/** The brief as the art director reads it for a set. */
function requestBlock(
  context: DesignContext,
  kind: SequenceKind,
  frameCount: number,
  aspectRatio: string | null,
): string {
  const request =
    context.briefText?.trim() ||
    `Produce an on-brand ${kind} that reflects the brand's offer and goal.`;
  const lines = [
    context.title ? `Title: ${context.title}` : null,
    context.designType ? `Design type: ${context.designType}` : null,
    context.platform ? `Platform: ${context.platform}` : null,
    context.scheduledFor ? `Scheduled for: ${context.scheduledFor}` : null,
    `Frames: ${frameCount} ${frameNoun(kind)}s`,
    aspectRatio ? `Target aspect ratio: ${aspectRatio}` : null,
  ].filter(Boolean);
  return [
    `Design request:\n${lines.join("\n")}`,
    formatGuidance(kind),
    playbookBlock(inferCategory(request, context.designType)),
    `Brief:\n${request}`,
  ].join("\n\n");
}

/** The brief's facts, numbered for the outline to assign. */
export function factList(facts: readonly BriefFact[]): string {
  return facts.map((f, i) => `${i + 1}. (${f.kind}) "${f.text}"`).join("\n");
}

function outlineImageBlock(
  source: SequenceImageSource,
  attached: boolean,
): string {
  if (source === "none") {
    return 'Imagery: there is no image. Every frame is text-led ("showsImage": false): type, colour and space carry it, in hero-center, stat-highlight or quote-card. Set "backgroundTreatment" to "solid" or "gradient".';
  }
  if (source === "upload") {
    return [
      "Imagery: the client supplied one photograph, and it is the set's image. The first frame shows it.",
      attached
        ? "The photograph is attached: plan frames that fit what is actually in it."
        : "The photograph is not shown to you: plan frames that do not depend on its exact contents.",
      'Show it again only where it makes that frame\'s point; the same photograph on every frame reads as one design cut into pieces, so give the other frames "showsImage": false and a text-led layout (hero-center, stat-highlight or quote-card). Set "backgroundTreatment" to "photographic".',
    ].join(" ");
  }
  return 'Imagery: KO paints a separate text-free image for each frame that shows one ("showsImage": true), all in one photographic style. The first frame shows one. Give roughly half the frames an image and the rest a text-led layout (hero-center, stat-highlight or quote-card), so the set has rhythm.';
}

export interface OutlinePromptInput {
  kind: SequenceKind;
  frameCount: number;
  aspectRatio: string;
  facts: readonly BriefFact[];
  offering: string | null;
  imageSource: SequenceImageSource;
  imageAttached: boolean;
  /** Points of a previous outline that said the same thing twice. */
  repeated?: string[];
}

export function buildOutlinePrompt(
  context: DesignContext,
  {
    kind,
    frameCount,
    aspectRatio,
    facts,
    offering,
    imageSource,
    imageAttached,
    repeated = [],
  }: OutlinePromptInput,
): string {
  const noun = frameNoun(kind);
  const Noun = noun === "slide" ? "Slide" : "Frame";
  const last = frameCount;
  const factsBlock =
    facts.length > 0
      ? `The brief's facts, numbered. Every one is carried by exactly one ${noun}; list each ${noun}'s fact numbers in "facts". Put each fact where it is that ${noun}'s point (a price on the ${noun} about the price), and the ways to act (contact, booking, link) on ${noun} ${last}. A fact is given once in the whole ${kind}: a second ${noun} repeating it is a ${noun} with nothing new to say.\n${factList(facts)}`
      : `The brief gives no hard facts (no price, date, place or contact): leave every "facts" list empty and invent none.`;
  return [
    requestBlock(context, kind, frameCount, aspectRatio),
    `First, lay out the arc of the ${kind}: exactly ${frameCount} ${noun}s, in order. Do not write any copy yet.`,
    `- ${Noun} 1 is the hook${offering ? `: it is about "${offering}"` : ""}. ${Noun} ${last} is the call to action.${frameCount > 2 ? ` ${Noun}s 2 to ${last - 1} carry one point each, each a different point, ordered so the story builds.` : ""}
- "title": what the ${noun} is about in 2 to ${t.title.words} words ("The price", "Where to find us").
- "point": the one thing it tells the viewer, as a plain sentence for the writer. Each point is a different reason to care, drawn from the brief: what it is, what the reader gets from it, how it is made or why it is different, what it costs, when and where, how to act. Two ${noun}s never share a point, and the hook's point is the sharpest reason the brief gives to keep going, never "it is here" or "it is new".
- "beat": the kind of point. "promise" (what the reader gets, said boldly), "benefit", "proof" (how it is made, who makes it, why it is different), "detail" (what is included), "how-it-works", "audience" (who it is for), "price", "when-where", "scarcity" (only a limit the brief itself states), "action" (how to act: the last ${noun}). No two ${noun}s share a beat.
- Points come only from the brief and the brand profile above (its offer, audience, values and what sets it apart). Never a claim neither gives ("Africa's leading", "loss is highest here", "loved by thousands"). With more ${noun}s than the brief has points, a ${noun} shows one detail of the offering in a few words, never the same point twice and never an invented one.
- "layout": the composition. Neighbouring ${noun}s never share a layout.
- "showsImage": whether the ${noun} shows the set's image.
- The shared brand frame, chosen once for every ${noun}: "palette" from the brand colours, "logoPlacement", "logoFree", "logoFreeQuote", "backgroundTreatment" and "footerStyle" ("bar" or "text" when any ${noun} has contact, place or date lines to show, "none" otherwise).`,
    factsBlock,
    outlineImageBlock(imageSource, imageAttached),
    repeated.length > 0
      ? `Your last outline made the same point twice: ${repeated.map((p) => `"${p}"`).join(", ")}. Give every ${noun} its own point.`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** One frame of a settled outline, as the copy call is told it. */
export interface OutlinedFrame {
  role: FrameRole;
  title: string;
  point: string;
  /** The brief's words for each fact this frame must state. */
  facts: string[];
  layout: string;
  showsImage: boolean;
}

const ROLE_BRIEF: Record<FrameRole, string> = {
  hook: 'HOOK: earns the swipe. The headline is the stake for the target audience, in their terms: a question they would answer yes to ("Can your teen bake real sourdough?"), the most concrete promise the brief supports, or a striking detail from the brief turned into a reason to care ("18 hours for one bottle"). The subheadline then names the offering, by its own name when the brief gives one (a product, app, event or package name), and adds what the headline does not say; it never restates the headline. Never the offering\'s name alone, and never "X is here", "has arrived", "Introducing", "Just in" or "New in": a label or an announcement gives no reason to swipe. Do not spend the point a later frame makes. No button.',
  body: "ONE POINT: the headline says this frame's point, in words no other frame uses; the subheadline, if any, adds what the headline leaves out and never says it again. No button.",
  cta: 'ACTION: the headline tells the reader what they get by acting, in words no earlier frame used; the footer holds how to act; the button ("cta") is the action itself, starting with a verb ("Book your seat", "Order on WhatsApp"). It does not recap facts earlier frames gave.',
};

function sceneRule(source: SequenceImageSource): string {
  if (source === "none") {
    return '"backgroundPrompt": a one-line description of the colour ground (its colour and texture), the same family on every frame.';
  }
  if (source === "upload") {
    return '"backgroundPrompt": a one-line description of the supplied photograph on frames that show it; on text-led frames, a one-line description of the colour ground.';
  }
  return '"backgroundPrompt": on a frame that shows an image, the scene KO paints for it: the product first when the brief names one, then the setting, in the same photographic style on every frame but a different viewpoint or moment on each. Never people, screens, signs, menus, packaging with labels or anything with writing. On a text-led frame, a one-line description of the colour ground.';
}

const COPY_RULES = (kind: SequenceKind) => {
  const words = formatRules(kind).headlineWords;
  return `Write to length. Count the words before you answer; text over its limit is rewritten or the ${frameNoun(kind)} fails:
- "headline": at most ${words} words and ${t.headline.chars} characters (hard limit ${COPY_LIMITS.headline}).
- "subheadline": at most ${t.subheadline.words} words and ${t.subheadline.chars} characters (hard limit ${COPY_LIMITS.subheadline}), or "" for none. Most frames read better with one short line or none.
- "footerLines": up to 3 lines of at most ${t.footerLine.chars} characters each, for contact, place, date and booking details. Leave it empty on a frame with none.
- "cta": the last frame's button, at most ${t.cta.words} words and ${t.cta.chars} characters.

Only the brief's facts. Every number, price, time, day, date, count, place, contact and claim must be written in the brief or the brand profile; a detail the brief did not give is left out, never guessed. State each fact a frame must carry in the brief's own words ("₦4,500 a slice", not "from ₦4,500"), each time, price, date or count in a field of its own, and a phone number never on the same line as a time (a time beside a phone number reads as part of it). Never "now", "only", "fresh", "today", "limited" or "new" unless the brief says it, and no scarcity, urgency or praise the brief does not give ("they go fast", "before it's gone", "award-winning").
Say everything once. A frame states the facts it must state and no others; no fact appears on two frames, or twice on one frame (in the subheadline and again in the footer). A subheadline never restates its own headline. No two headlines or subheadlines share their idea or their words beyond the offering's name. The offering is named on the first frame; later frames may name it again only where the point needs it.
One voice: the frames sound like one brand speaking in order, not ${frameNoun(kind)}s written by strangers.`;
};

export interface CopyPromptInput {
  kind: SequenceKind;
  frames: OutlinedFrame[];
  offering: string | null;
  imageSource: SequenceImageSource;
  aspectRatio: string;
}

/**
 * What the hook must name: what the brief offers, and the brand's own name
 * when the brief makes the brand its subject ("Ledgerly launches on 3
 * March"), since then the brand is the product. With no offering read, the
 * brand's name alone, so a deck's title slide still says whose it is.
 */
export function hookNames(
  context: Pick<DesignContext, "briefText" | "brandSummary">,
  offering: string | null,
): string[] {
  const brand = context.brandSummary.name.trim();
  const brandIsSubject =
    brand.length > 0 && inBrief(brand, context.briefText ?? "") !== null;
  const names: string[] = [];
  for (const name of [offering, brandIsSubject || !offering ? brand : null]) {
    const held = names.some((n) =>
      n.toLowerCase().includes(name?.toLowerCase() ?? ""),
    );
    if (name && !held) names.push(name);
  }
  return names;
}

function frameLines(
  frames: readonly OutlinedFrame[],
  noun: string,
  names: readonly string[],
): string {
  return frames
    .map((f, i) =>
      [
        `${noun} ${i + 1} (${ROLE_BRIEF[f.role]})`,
        `  title: ${f.title}`,
        `  point: ${f.point}`,
        `  layout: ${f.layout}, ${f.showsImage ? "shows the image" : "text-led, no image"}`,
        f.role === "hook" && names.some((n) => !f.facts.includes(n))
          ? `  must name, in these words: ${names
              .filter((n) => !f.facts.includes(n))
              .map((n) => `"${n}"`)
              .join(", ")}`
          : null,
        f.role === "hook" && frames.length > 1
          ? `  leaves to later ${noun}s: ${frames
              .slice(1)
              .map((later) => `"${later.title}"`)
              .join(", ")}`
          : null,
        f.facts.length > 0
          ? `  must state, in these words: ${f.facts.map((x) => `"${x}"`).join(", ")}`
          : "  must state: nothing beyond its point",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function buildFrameCopyPrompt(
  context: DesignContext,
  { kind, frames, offering, imageSource, aspectRatio }: CopyPromptInput,
): string {
  const noun = frameNoun(kind);
  return [
    requestBlock(context, kind, frames.length, aspectRatio),
    `Now write the copy for this outline, one entry in "frames" per ${noun}, in order, and the last ${noun}'s button in "cta".${offering ? ` What the brief offers: "${offering}".` : ""}`,
    frameLines(frames, noun, hookNames(context, offering)),
    COPY_RULES(kind),
    sceneRule(imageSource),
  ].join("\n\n");
}

export interface FrameFix {
  /** Zero-based. */
  index: number;
  problems: string[];
  /** The brief's words for every fact the frame must state. */
  mustState: string[];
}

function beatLines(
  frames: readonly FrameBeat[],
  noun: string,
  only?: ReadonlySet<number>,
): string {
  return frames
    .map((f, i) =>
      only && !only.has(i)
        ? null
        : [
            `${noun} ${i + 1} (${f.role}): title "${f.title}"`,
            `  headline: "${f.headline}"`,
            `  subheadline: ${f.subheadline ? `"${f.subheadline}"` : "(none)"}`,
            `  footer lines: ${f.footerLines.length > 0 ? f.footerLines.map((l) => `"${l}"`).join(", ") : "(none)"}`,
            f.role === "cta" ? `  button: "${f.cta}"` : null,
          ]
            .filter(Boolean)
            .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

/** The one repair pass: the frames that break a rule, with the rule named,
 *  rewritten by the model. Code never writes the copy itself. */
export function buildSequenceRepairPrompt(
  context: DesignContext,
  {
    kind,
    frames,
    fixes,
  }: { kind: SequenceKind; frames: readonly FrameBeat[]; fixes: FrameFix[] },
): string {
  const noun = frameNoun(kind);
  const asked = fixes
    .map((fix) =>
      [
        `${noun} ${fix.index + 1}:`,
        ...fix.problems.map((p) => `  - ${p}`),
        fix.mustState.length > 0
          ? `  It must still state, in these words: ${fix.mustState.map((x) => `"${x}"`).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  return [
    requestBlock(context, kind, frames.length, null),
    `The ${kind} so far:\n\n${beatLines(frames, noun)}`,
    `These ${noun}s cannot go out as they are. Rewrite each one so it fixes every problem listed and keeps its point, its role and its place in the story:\n${asked}`,
    COPY_RULES(kind),
    `Return one entry in "frames" per ${noun} listed above, with "frame" set to its number, its title, headline, subheadline and footer lines. "cta" is the button on the last ${noun} only, and "" on every other.`,
  ].join("\n\n");
}

export interface RegeneratePromptInput {
  kind: SequenceKind;
  frames: readonly FrameBeat[];
  index: number;
  mustState: string[];
  offering: string | null;
  /** What the previous attempt got wrong, on the second ask. */
  problems?: string[];
}

/** One frame written again, given its set, so it stays distinct from its
 *  neighbours and keeps its job in the story. */
export function buildFrameRegeneratePrompt(
  context: DesignContext,
  {
    kind,
    frames,
    index,
    mustState,
    offering,
    problems = [],
  }: RegeneratePromptInput,
): string {
  const noun = frameNoun(kind);
  const beat = frames[index];
  const others = new Set(frames.map((_, i) => i).filter((i) => i !== index));
  return [
    requestBlock(context, kind, frames.length, null),
    `The other ${noun}s of the ${kind}, which stay as they are:\n\n${beatLines(frames, noun, others)}`,
    `Write ${noun} ${index + 1} again: a new headline and supporting copy for the same point ("${beat.title}"), different from what it says now and from every other ${noun}. It stays ${ROLE_BRIEF[beat.role]}`,
    `It says now: headline "${beat.headline}"${beat.subheadline ? `, subheadline "${beat.subheadline}"` : ""}.`,
    mustState.length > 0
      ? `It must state, in these words: ${mustState.map((x) => `"${x}"`).join(", ")}.`
      : null,
    beat.role === "hook" && offering
      ? `It names "${offering}" in its headline or subheadline.`
      : null,
    problems.length > 0
      ? `Your last attempt could not be used:\n${problems.map((p) => `- ${p}`).join("\n")}`
      : null,
    COPY_RULES(kind),
    `Return the ${noun} as the only entry in "frames", with "frame" set to ${index + 1}. "cta" is ${beat.role === "cta" ? "its button" : '""'}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
