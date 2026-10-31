import { inferCategory } from "@/lib/ai/design-training/infer-category";
import { playbookBlock } from "@/lib/ai/design-training/playbooks";
import type { DesignContext } from "@/lib/design/context";
import { formatRules } from "@/lib/design/formats";
import type { ArcPoint } from "@/lib/design/sequence/arc";
import type {
  FrameBeat,
  FrameRole,
  SequenceImageSource,
  SequenceKind,
} from "@/lib/design/sequence/contract";
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
 * Arc first, then copy. Code numbers every point the set may make (the
 * brief's clauses and facts, then the brand profile's); the arc call ranks
 * them and assigns one to each frame, writing no claim but the hook's
 * angle; code holds the assignment to distinctness (arc.ts). The copy call
 * then writes each frame told only its own claim and the claims it must
 * leave alone, the audit call reads the set cold for repeats in other
 * words and unsourced statements, and the fix call rewrites only the
 * fields found at fault. A model asked for N frames of copy in one go writes one ad cut
 * into N pieces: the arc is where the story is decided.
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

function arcImageBlock(source: SequenceImageSource, attached: boolean): string {
  if (source === "none") {
    return 'Imagery: there is no image. Every frame is text-led ("showsImage": false): type, colour and space carry it, in hero-center, quote-card, or stat-highlight for a frame whose point is a figure (a price, a count, a time). Set "backgroundTreatment" to "solid" or "gradient".';
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

const SOURCE_LABEL: Record<ArcPoint["source"], string> = {
  brief: "the brief says",
  fact: "a brief fact",
  profile: "the brand profile says",
  value: "a belief the brand states",
  user: "the owner wrote",
};

/** The pool of points, numbered for the arc to assign. */
export function pointList(pool: readonly ArcPoint[]): string {
  return pool
    .map((p, i) => `${i + 1}. (${SOURCE_LABEL[p.source]}) "${p.text}"`)
    .join("\n");
}

export interface ArcPromptInput {
  kind: SequenceKind;
  frameCount: number;
  aspectRatio: string;
  pool: readonly ArcPoint[];
  /** The brief's words for the facts the last frame carries whatever the
   *  arc: how and where to act, and a carousel's price. */
  actionFacts: readonly string[];
  offering: string | null;
  imageSource: SequenceImageSource;
  imageAttached: boolean;
  /** The owner approved the outline: point k is frame k's, in order, and
   *  the call only chooses titles, layouts and the shared brand frame. */
  fixed?: boolean;
}

/**
 * The arc: one numbered point per frame, the hook's angle, and the unused
 * points ranked. The model chooses and orders the story; it writes no
 * claim but the hook's angle, so every middle frame says something the
 * brief or the brand profile gives.
 */
export function buildArcPrompt(
  context: DesignContext,
  {
    kind,
    frameCount,
    aspectRatio,
    pool,
    actionFacts,
    offering,
    imageSource,
    imageAttached,
    fixed = false,
  }: ArcPromptInput,
): string {
  const noun = frameNoun(kind);
  const Noun = noun === "slide" ? "Slide" : "Frame";
  const last = frameCount;
  if (fixed) {
    return [
      requestBlock(context, kind, frameCount, aspectRatio),
      `Plan the arc of the ${kind} before any copy is written: exactly ${frameCount} ${noun}s, in order. The owner has approved its points, so the order and the points are settled. Write no copy.`,
      `The approved points, numbered in ${noun} order:\n${pointList(pool)}`,
      [
        `- ${Noun} k makes point k: set "point" to the ${noun}'s own number on ${noun}s 1 to ${last - 1}, and to 0 on ${noun} ${last}, the action, which says how to act and carries ${actionFacts.length > 0 ? actionFacts.map((f) => `"${f}"`).join(", ") : "the way to act"}.`,
        `- "hookAngle": point 1 as written. "subjects" and "spare": [].`,
        `- "title": what the ${noun} is about in 2 to ${t.title.words} words taken from its own point, never a label for its job ("The price", "Next steps"). No two ${noun}s share a title, in any casing.`,
        `- "layout": the composition. Neighbouring ${noun}s never share a layout; stat-highlight only for a ${noun} whose point is a figure.`,
        `- "showsImage": whether the ${noun} shows the set's image.`,
        `- The shared brand frame, chosen once for every ${noun}: "palette" from the brand colours, "logoPlacement", "logoFree", "logoFreeQuote", "backgroundTreatment" and "footerStyle" ("bar" or "text" when any ${noun} has contact, place or date lines to show, "none" otherwise).`,
      ].join("\n"),
      arcImageBlock(imageSource, imageAttached),
    ].join("\n\n");
  }
  const middle =
    frameCount > 2
      ? `- ${Noun}s 2 to ${last - 1}: each makes one point from the list, by its number in "point". Every ${noun} a different point, and no two points that say one thing in other words (the same quality from two sides, a benefit and its cause, a fact and what it means are one point). Order them so the story builds: what the reader gets, then why it is true or different, then what makes it easy to say yes. Take the brief's own points first; take the brand profile's points only for ${noun}s the brief has no point left for, and a belief the brand states only when no concrete point (what it is, how it is made, where it comes from, who makes it, what the reader gets) is left.`
      : null;
  return [
    requestBlock(context, kind, frameCount, aspectRatio),
    `Plan the arc of the ${kind} before any copy is written: exactly ${frameCount} ${noun}s, in order, each making one claim from the numbered points below. Write no copy.`,
    `The points the ${kind} may make, numbered:\n${pointList(pool) || "(none: the brief and the profile give no point beyond the offering)"}`,
    [
      `- ${Noun} 1 is the hook${offering ? `, about "${offering}"` : ""}. Set its "point" to the number of the point that gives the most concrete reason to keep going (a figure, how it is made, who makes it, what it changes for the reader${kind === "presentation" ? ", or what is asked for and what it buys" : ""}), and write "hookAngle": that point said as the one reason to see ${noun} 2, naming what is on offer, in one sentence of at most 14 words, in the point's own measure (never sharper, rounder or faster than it). Where the brief gives news (a launch, a return, a first), it goes beside that reason, never instead of it, and never as "is here", "is back" or "has arrived": an arrival is a label, not a reason. The angle never gives a price${kind === "carousel" ? ", a time or a place" : ""} and is never a mood.`,
      middle,
      `- ${Noun} ${last} is the action: "point" 0. It says how to act and carries ${actionFacts.length > 0 ? actionFacts.map((f) => `"${f}"`).join(", ") : "the way to act"}${kind === "carousel" ? ", so no earlier frame states those" : ""}.`,
      `- "subjects": before you assign anything, sort the numbered points by what each tells the reader about the offering (where it comes from, what goes in it, how it is made, who makes it, how it is used or served, what the reader gets, who it is for, why the brand does it, when and where). Name each subject in 2 to 4 words and list the number of every point that touches it, even in passing: a point that says what the offering is and also what it is made from goes under both subjects. A reader hears two points on one subject as one point made twice, whatever their words: "grown on one family farm" and "tastes of the valley it grew in" are both where it comes from; "no setup fee" and "pay only for what you use" are both what it costs. So no two ${noun}s make points that share a subject while a point on a subject no ${noun} makes is left.`,
      `- "spare": every point no ${noun} uses, by number, strongest first. A ${noun} whose point cannot stand takes the first spare point that says something no other ${noun} says.`,
      `- "title": what the ${noun} is about in 2 to ${t.title.words} words taken from its own point, never a label for its job ("The price", "Next steps"). No two ${noun}s share a title, in any casing.`,
      `- "layout": the composition. Neighbouring ${noun}s never share a layout; stat-highlight only for a ${noun} whose point is a figure.`,
      `- "showsImage": whether the ${noun} shows the set's image.`,
      `- The shared brand frame, chosen once for every ${noun}: "palette" from the brand colours, "logoPlacement", "logoFree", "logoFreeQuote", "backgroundTreatment" and "footerStyle" ("bar" or "text" when any ${noun} has contact, place or date lines to show, "none" otherwise).`,
    ]
      .filter(Boolean)
      .join("\n"),
    arcImageBlock(imageSource, imageAttached),
  ].join("\n\n");
}

/** One frame of a settled arc, as the copy call is told it. */
export interface ClaimedFrame {
  role: FrameRole;
  title: string;
  /** The one thing the frame says; empty on the action frame. */
  claim: string;
  /** The brief's words for each fact this frame must state. */
  facts: string[];
  layout: string;
  showsImage: boolean;
  /** The claim is the owner's own words from the approved outline. */
  owned?: boolean;
}

const ROLE_BRIEF: Record<FrameRole, string> = {
  hook: `HOOK: earns the swipe. The headline is built on its claim, the most concrete thing the brief gives (a figure, a duration, how it is made, who makes it, or for a deck what is asked for and what it buys), said in the target audience's terms, so it could only be about this offering. Say it straight, as a question that holds it, or as a before-and-after that holds it; a question or promise without it ("Still doing it yourself?", "Ready for something better?") is flat, because any competitor could post it word for word. A claim keeps the brief's own measure: never sharper, rounder or faster than the brief says. Name the offering, by its own name when the brief gives one (a product, app, event or package name), in the headline where it fits, else the subheadline. The subheadline is one whole sentence on the reader's stake: what they get, or what changes for them, because of the claim; news the brief gives (a launch, a return, the date it happens) may sit beside that stake, never instead of it, and opening days, hours or a place never fill it. It never restates the headline or reuses its words. Never the offering's name alone, the name with where to find it, or "X is here", "has arrived", "Introducing", "Just in" or "New in": a label or an announcement gives no reason to swipe. Do not spend the point a later frame makes. No button.`,
  body: 'ONE POINT: the headline says this frame\'s claim, in words no other frame uses. The subheadline is one whole sentence with a concrete detail of this claim the headline leaves out (a number, a place, a material, a step, who does it, what the reader sees or gets), from its source or the brief, in words no other frame uses. Never a line about values, feelings or what it means in general, and never the headline again. Never the headline again in other words, a reassurance the brief does not give ("No card needed", "Worth every penny") or a phrase another frame used. No button.',
  cta: 'ACTION: the headline tells the reader what they get by acting, in words no earlier frame used; the footer holds how to act; the button ("cta") is the action itself, starting with a verb ("Book your seat", "Order on WhatsApp"). It recaps nothing an earlier frame said, in its words or its facts.',
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
- "subheadline": at most ${t.subheadline.words} words and ${t.subheadline.chars} characters (hard limit ${COPY_LIMITS.subheadline}). Every middle ${frameNoun(kind)} has one: a headline alone reads as an unfinished thought. The first and last may leave it "".
- "footerLines": up to 3 lines of at most ${t.footerLine.chars} characters each, for contact, place, date and booking details. Leave it empty on a frame with none.
- "cta": the last frame's button, at most ${t.cta.words} words and ${t.cta.chars} characters.

Only the brief's facts. Every number, price, time, day, date, count, place, contact and claim must be written in the brief or the brand profile, and a number written as a word counts ("one message", "two weeks"); a detail the brief did not give is left out, never guessed. State each fact a frame must carry in the brief's own words ("₦4,500 a slice", not "from ₦4,500"), each time, price, date or count in a field of its own, and a phone number never on the same line as a time (a time beside a phone number reads as part of it). Never "now", "only", "fresh", "today", "limited" or "new" unless the brief says it, and no scarcity, urgency or praise the brief does not give ("they go fast", "before it's gone", "award-winning"). Never promise the reader a perk, reward, recognition or result that neither the brief nor the brand profile offers (their name on something, a gift, a guaranteed outcome, a document, demo or meeting the brief does not offer), and never state what the brand hopes will happen as if it already does: the brand's goal is why it is posting, not something true to say.
${kind === "carousel" ? `A price is stated on the last ${frameNoun(kind)} only, beside the action.\n` : ""}Say everything once. A frame states the facts it must state and no others; no fact appears on two frames, or twice on one frame (in the subheadline and again in the footer). A subheadline never restates its own headline. No two headlines or subheadlines share their idea or their words beyond the offering's name. The offering is named on the first frame; later frames may name it again only where the point needs it.
Never write about the ${kind} itself ("this ${kind} covers", "in the next ${frameNoun(kind)}s"): say what it is about.
One voice: the frames sound like one brand speaking in order, not ${frameNoun(kind)}s written by strangers, and every headline is in sentence case.`;
};

/**
 * What the hook must name: what the brief offers, and the brand's own name
 * when the brief makes the brand its subject (an app's launch brief that
 * names the app), since then the brand is the product. With no offering read, the
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

/** The claims and facts a frame leaves to the others: what makes another
 *  frame's point, and the brief facts another frame states. */
function leftToOthers(
  frames: readonly ClaimedFrame[],
  index: number,
  noun: string,
): string[] {
  const claims = frames.flatMap((other, i) =>
    i !== index && other.claim ? [`"${other.claim}" (${noun} ${i + 1})`] : [],
  );
  const facts = frames.flatMap((other, i) =>
    i !== index ? other.facts.map((f) => `"${f}" (${noun} ${i + 1})`) : [],
  );
  return [
    claims.length > 0
      ? `  must not say, in any words, the points of the other ${noun}s: ${claims.join("; ")}`
      : null,
    facts.length > 0
      ? `  must not give the facts other ${noun}s state: ${facts.join("; ")}`
      : null,
  ].filter((line): line is string => line !== null);
}

function claimedLines(
  frames: readonly ClaimedFrame[],
  noun: string,
  names: readonly string[],
): string {
  return frames
    .map((f, i) =>
      [
        `${noun} ${i + 1} (${ROLE_BRIEF[f.role]})`,
        `  working title: ${f.title}`,
        f.claim && f.owned
          ? `  its claim, in the owner's own words, the only point it makes: "${f.claim}". Keep what it claims, its figures and its terms; shorten it to fit, never turn it into another claim.`
          : f.claim
            ? `  its claim, the only point it makes: "${f.claim}"`
            : f.role === "cta"
              ? "  its claim: how to act, and what the reader gets by acting"
              : `  its claim: a detail of the offering that the brief or the brand profile gives and no other ${noun} makes`,
        `  layout: ${f.layout}, ${f.showsImage ? "shows the image" : "text-led, no image"}`,
        f.role === "hook" && names.some((n) => !f.facts.includes(n))
          ? `  must name, in these words: ${names
              .filter((n) => !f.facts.includes(n))
              .map((n) => `"${n}"`)
              .join(", ")}`
          : null,
        f.facts.length > 0
          ? `  must state, in these words: ${f.facts.map((x) => `"${x}"`).join(", ")}`
          : "  must state: nothing beyond its claim",
        ...leftToOthers(frames, i, noun),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export interface ArcCopyPromptInput {
  kind: SequenceKind;
  frames: readonly ClaimedFrame[];
  offering: string | null;
  imageSource: SequenceImageSource;
  aspectRatio: string;
  /** The claims come from an outline the owner approved. */
  approved?: boolean;
}

/** Hook versions the copy call writes beside frame 1, on the same claim
 *  from other angles; code keeps the one with the fewest faults. */
export const OTHER_HOOKS = 2;

/** Every frame's copy, each written to its own claim alone. */
export function buildArcCopyPrompt(
  context: DesignContext,
  {
    kind,
    frames,
    offering,
    imageSource,
    aspectRatio,
    approved = false,
  }: ArcCopyPromptInput,
): string {
  const noun = frameNoun(kind);
  return [
    requestBlock(context, kind, frames.length, aspectRatio),
    `Write the copy for this arc, one entry in "frames" per ${noun}, in order, and the last ${noun}'s button in "cta". Each ${noun} says its own claim and nothing another ${noun} says.${offering ? ` What the brief offers: "${offering}".` : ""}`,
    approved
      ? `The owner approved exactly these ${noun}s and their claims, and took other points out. Say nothing the brief or the brand profile gives that no ${noun}'s claim or facts hold.`
      : null,
    claimedLines(frames, noun, hookNames(context, offering)),
    `In "otherHooks", write ${noun} 1 ${OTHER_HOOKS} more ways on the same claim, each a headline and subheadline: one a question that holds the claim, one a before-and-after that holds it. Put your strongest opening in "frames".`,
    COPY_RULES(kind),
    `Every subheadline is a whole sentence: it starts with a capital and names its own subject, never a clause that leans on the headline above it.`,
    `"title": each ${noun}'s name on its card, written after its copy: 2 to ${t.title.words} words naming what its own headline says, as a whole phrase (never cut off mid-way), any figure written as in the copy, and never another ${noun}'s title.`,
    sceneRule(imageSource),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Versions of each frame the fix call writes. A rewrite that fixes one
 *  fault often makes another (a fact dropped, a neighbour echoed), and is
 *  then refused; a second version in the same call is a second chance at
 *  no extra wait. */
export const FIX_VERSIONS = 2;

export interface FrameFix {
  /** Zero-based. */
  index: number;
  faults: string[];
  /** A new claim for a frame whose own could not be written without
   *  repeating another frame; null keeps its claim. */
  newClaim?: string | null;
}

export interface FixPromptInput {
  kind: SequenceKind;
  plan: readonly FrameBeat[];
  /** The arc each frame is written to, by index. */
  frames: readonly ClaimedFrame[];
  fixes: readonly FrameFix[];
  names: readonly string[];
}

/**
 * Targeted rewrites: the set as it stands, and for each frame code found
 * at fault, its faults and FIX_VERSIONS versions asked for. A frame keeps
 * its claim unless given a new one. Code keeps a version only where the
 * set is left with fewer faults, and never writes a word of one.
 */
export function buildFixPrompt(
  context: DesignContext,
  { kind, plan, frames, fixes, names }: FixPromptInput,
): string {
  const noun = frameNoun(kind);
  const last = plan.length;
  const claimed = frames.map((f, i) => {
    const fix = fixes.find((x) => x.index === i);
    return fix?.newClaim ? { ...f, claim: fix.newClaim } : f;
  });
  const listed = plan
    .map((beat, i) => {
      const fix = fixes.find((x) => x.index === i);
      const frame = claimed[i];
      return [
        beatLine(beat, i, noun),
        frame?.claim ? `  its claim: "${frame.claim}"` : null,
        frame && frame.facts.length > 0
          ? `  must state, in these words: ${frame.facts.map((x) => `"${x}"`).join(", ")}`
          : null,
        fix?.newClaim
          ? `  NEW CLAIM: its point was another ${noun}'s, so it now makes this one instead: "${fix.newClaim}"`
          : null,
        ...(fix?.faults ?? []).map((f) => `  fault: ${f}`),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const asked = fixes.map((f) => f.index + 1).join(", ");
  return [
    requestBlock(context, kind, last, null),
    `The ${kind} as written, with each ${noun}'s claim, the facts it must state and every fault code found:\n\n${listed}`,
    `Rewrite ${noun}s ${asked} only, ${FIX_VERSIONS} versions each, as entries in "frames" with "frame" set to the ${noun}'s number. A version fixes every fault listed for its ${noun}, keeps its role, its claim (or its new claim) and the facts it must state, and says nothing another ${noun} says. Leave a field that has no fault as it is, word for word.${names.length > 0 ? ` ${noun === "slide" ? "Slide" : "Frame"} 1 names ${names.map((n) => `"${n}"`).join(" and ")}, in these words.` : ""}`,
    fixes.some((f) => f.index === 0) ? ROLE_BRIEF.hook : null,
    COPY_RULES(kind),
    `Every subheadline is a whole sentence: it starts with a capital and names its own subject. The title is the ${noun}'s name as the client reads it on its card, 2 to ${t.title.words} words, never one another ${noun} has. "cta" is the button on ${noun} ${last} only, and "" on every other.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function beatLine(f: FrameBeat, index: number, noun: string): string {
  return [
    `${noun} ${index + 1} (${f.role}): title "${f.title}"`,
    `  headline: "${f.headline}"`,
    `  subheadline: ${f.subheadline ? `"${f.subheadline}"` : "(none)"}`,
    `  footer lines: ${f.footerLines.length > 0 ? f.footerLines.map((l) => `"${l}"`).join(", ") : "(none)"}`,
    f.role === "cta" ? `  button: "${f.cta}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function beatLines(
  frames: readonly FrameBeat[],
  noun: string,
  only?: ReadonlySet<number>,
): string {
  return frames
    .map((f, i) => (only && !only.has(i) ? null : beatLine(f, i, noun)))
    .filter(Boolean)
    .join("\n\n");
}

export interface AuditPromptInput {
  kind: SequenceKind;
  frames: readonly FrameBeat[];
  /** Unused points of the arc's pool, by their number in it. */
  spares: readonly { number: number; text: string }[];
  /** What the brand profile states, besides the brief. */
  profile: readonly string[];
}

/**
 * A cold read of the written set for what word overlap cannot find: two
 * frames making one point in different words, and a statement no source
 * gives. The reader reports; code decides which frame takes a spare point
 * and which words are cut, and never takes a word from this call.
 */
export function buildAuditPrompt(
  context: DesignContext,
  { kind, frames, spares, profile }: AuditPromptInput,
): string {
  const noun = frameNoun(kind);
  return [
    requestBlock(context, kind, frames.length, null),
    profile.length > 0
      ? `The brand profile says:\n${profile.map((p) => `- ${p}`).join("\n")}`
      : "The brand profile says nothing beyond the brand's name.",
    `The ${kind} as written:\n\n${beatLines(frames, noun)}`,
    spares.length > 0
      ? `Spare points no ${noun} makes yet, numbered:\n${spares.map((p) => `${p.number}. "${p.text}"`).join("\n")}`
      : null,
    `Read the ${kind} in order, as the person it is for would, and report what you find. Rewrite nothing.
- "repeats": every ${noun} whose point an earlier ${noun} already made. One point in other words is a repeat ("Fast delivery" and "At your door within the hour"), and so is a benefit beside its cause ("Automatic backups" and "Never lose a file"). Two ${noun}s that share a word but make different points are not. The last ${noun} repeats only where its headline makes an earlier ${noun}'s point again.
- "unsourced": every fact a ${noun} adds that neither the brief nor the brand profile gives in any words: a policy ("walk-ins welcome"), a promise or guarantee, a feature, a step of how it is made, a number. Quote only the words that carry the new fact, at most 8, exactly as the ${noun} writes them. Saying a sourced point in other words, explaining it, or naming what it plainly means for the reader is sourced; wording, tone and the offering's name never count. When unsure, leave it out.
- "freshSpares": the spare points that say something no ${noun} says.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface RegeneratePromptInput {
  kind: SequenceKind;
  frames: readonly FrameBeat[];
  index: number;
  mustState: string[];
  offering: string | null;
}

/** Versions of a frame one regenerate asks for. One call, so the user pays
 *  one unit's wait; two versions, so one that echoes a neighbour does not
 *  fail the regenerate on its own. */
export const REGENERATE_VERSIONS = 2;

/** One frame written again, given its set, so it stays distinct from its
 *  neighbours and keeps its job in the story. */
export function buildFrameRegeneratePrompt(
  context: DesignContext,
  { kind, frames, index, mustState, offering }: RegeneratePromptInput,
): string {
  const noun = frameNoun(kind);
  const beat = frames[index];
  const others = new Set(frames.map((_, i) => i).filter((i) => i !== index));
  return [
    requestBlock(context, kind, frames.length, null),
    `The other ${noun}s of the ${kind}, which stay as they are:\n\n${beatLines(frames, noun, others)}`,
    `Write ${noun} ${index + 1} again, ${REGENERATE_VERSIONS} different versions of it: each a new headline and supporting copy for the same point ("${beat.title}"), different from what it says now, from every other ${noun} and from each other. It stays ${ROLE_BRIEF[beat.role]}`,
    `It says now: headline "${beat.headline}"${beat.subheadline ? `, subheadline "${beat.subheadline}"` : ""}.`,
    mustState.length > 0
      ? `Each version states, in these words: ${mustState.map((x) => `"${x}"`).join(", ")}.`
      : null,
    beat.role === "hook" && offering
      ? `Each version names "${offering}" in its headline or subheadline.`
      : null,
    kind === "carousel" && beat.role !== "cta"
      ? `No version gives a price: the price is said once, on ${noun} ${frames.length} beside the action.`
      : null,
    COPY_RULES(kind),
    `Return the ${REGENERATE_VERSIONS} versions as the entries in "frames", each with "frame" set to ${index + 1}. "cta" is ${beat.role === "cta" ? "its button" : '""'}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
