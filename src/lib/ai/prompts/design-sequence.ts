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
import { HOOK_CRAFT } from "@/lib/design/sequence/hook";
import type { ProfilePoint } from "@/lib/design/sequence/points";
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

/* Round-2 critic: every five-frame carousel spent a body frame on a bare
   price with an empty subheadline, which the judge called "a receipt stub
   where a slide should be". Canva and Predis fold the price into the
   action frame. A deck's ask is its close, but a price that is how the
   business earns is a slide's point. */
function priceRule(kind: SequenceKind, last: number): string {
  return kind === "presentation"
    ? `The amount asked for (a raise, a package's price) sits on slide ${last} beside how to act. Any other price is the point of the slide about how the business earns, with what it means for the audience.`
    : `A price answers "what does acting cost", so it sits on frame ${last} beside the action. It gets a frame of its own only when the brief makes the price itself the news (free, a discount), and then that frame's point is what it buys, never the figure alone.`;
}

export interface OutlinePromptInput {
  kind: SequenceKind;
  frameCount: number;
  aspectRatio: string;
  facts: readonly BriefFact[];
  offering: string | null;
  imageSource: SequenceImageSource;
  imageAttached: boolean;
  /** The brand profile's points (profilePoints): a second source of
   *  points, for a brief with fewer of its own than there are frames. */
  profilePoints?: readonly ProfilePoint[];
  /** Points of a previous outline that said the same thing twice. */
  repeated?: string[];
}

const PROFILE_LABEL: Record<ProfilePoint["field"], string> = {
  differentiators: "what sets it apart",
  offer: "its offer",
  values: "its values",
  targetAudience: "who it is for: speak to them, never describe them",
  primaryGoal:
    "the brand's own aim: a reason to act, never a claim that it already happens",
  overview: "what it is",
};

/** The profile's points, numbered for the outline to cite. */
export function profilePointList(points: readonly ProfilePoint[]): string {
  return points
    .map((p, i) => `P${i + 1}. (${PROFILE_LABEL[p.field]}) "${p.text}"`)
    .join("\n");
}

/* Oluwaseyi's ruling (2026-10-30): a brief with fewer points than frames
   may borrow from the brand profile, never invent, and the count stays
   what was asked. Labelled as a second source so the brief's own points
   are spent first. */
function profileBlock(
  points: readonly ProfilePoint[],
  noun: string,
  kind: SequenceKind,
): string {
  if (points.length === 0) {
    return `"profilePoint": 0 on every ${noun}; this brand profile gives no point the brief does not.`;
  }
  return `A second source, used only once the brief's own points are spent: the brand profile's points, numbered. A middle ${noun} whose point is one of these sets "profilePoint" to its number (1 for P1) and says it in the profile's measure, adding nothing to it; every other ${noun} sets "profilePoint" to 0. Each profile point is made by one ${noun} at most, and the first and last ${noun}s never use one. With more ${noun}s than the brief has points, take the next profile point rather than say a brief point twice or invent one. When the brief has enough points for every ${noun} of the ${kind}, use none.\n${profilePointList(points)}`;
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
    profilePoints = [],
    repeated = [],
  }: OutlinePromptInput,
): string {
  const noun = frameNoun(kind);
  const Noun = noun === "slide" ? "Slide" : "Frame";
  const last = frameCount;
  const factsBlock =
    facts.length > 0
      ? `The brief's facts, numbered. Every one is carried by exactly one ${noun}; list each ${noun}'s fact numbers in "facts". Put each fact where it is that ${noun}'s point, and the ways to act (contact, booking, link) on ${noun} ${last}. ${priceRule(kind, last)} A fact is given once in the whole ${kind}: a second ${noun} repeating it is a ${noun} with nothing new to say.\n${factList(facts)}`
      : `The brief gives no hard facts (no price, date, place or contact): leave every "facts" list empty and invent none.`;
  return [
    requestBlock(context, kind, frameCount, aspectRatio),
    `First, lay out the arc of the ${kind}: exactly ${frameCount} ${noun}s, in order. Do not write any copy yet.`,
    `- ${Noun} 1 is the hook${offering ? `: it is about "${offering}"` : ""}. ${Noun} ${last} is the call to action.${frameCount > 2 ? ` ${Noun}s 2 to ${last - 1} carry one point each, each a different point, ordered so the story builds.` : ""}
- "title": what the ${noun} is about in 2 to ${t.title.words} words ("The price", "Where to find us").
- "point": the one thing it tells the viewer, as a plain sentence for the writer. Each point is a different reason to care, drawn from the brief: what it is, what the reader gets from it, how it is made or why it is different, what it costs, when and where, how to act. Two ${noun}s never share a point, and the hook's point is the sharpest reason the brief gives to keep going, never "it is here" or "it is new".
- "beat": the kind of point. "promise" (what the reader gets, said boldly), "benefit", "proof" (how it is made, who makes it, why it is different), "detail" (what is included), "how-it-works", "audience" (who it is for), ${kind === "carousel" ? "" : '"price", '}"when-where", "scarcity" (only a limit the brief itself states), "action" (how to act: the last ${noun}). No two ${noun}s share a beat.
- Points come from the brief first, then from the brand profile's numbered points below. Never a claim neither gives ("Africa's leading", "loss is highest here", "loved by thousands"), never the same point twice and never an invented one.
- "layout": the composition. Neighbouring ${noun}s never share a layout.
- "showsImage": whether the ${noun} shows the set's image.
- The shared brand frame, chosen once for every ${noun}: "palette" from the brand colours, "logoPlacement", "logoFree", "logoFreeQuote", "backgroundTreatment" and "footerStyle" ("bar" or "text" when any ${noun} has contact, place or date lines to show, "none" otherwise).`,
    factsBlock,
    profileBlock(profilePoints, noun, kind),
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
  /** The brand-profile point this frame makes, when its point is not the
   *  brief's. */
  profilePoint?: string | null;
  layout: string;
  showsImage: boolean;
}

const ROLE_BRIEF: Record<FrameRole, string> = {
  hook: `HOOK: earns the swipe. The headline is the reason to swipe, the stake for the target audience in their terms: a question the customer is already asking about the problem the offering solves (a bicycle repair shop's "Still walking your bike to work?"), the brief's boldest specific turned into a reason to care, in the brief's words and only when no later frame is about that specific, or a before-and-after (the old way they know, against what the offering changes). Whichever angle, the headline carries something only this offering has (its name, a detail or figure from the brief, its place): a question or promise any competitor could post word for word is flat. A claim keeps the brief's own measure: never sharper, rounder or faster than the brief says. The subheadline then names the offering, by its own name when the brief gives one (a product, app, event or package name), and adds what the headline does not say; it never restates the headline or reuses its words. Never the offering's name alone, and never "X is here", "has arrived", "Introducing", "Just in" or "New in": a label or an announcement gives no reason to swipe, so make the headline the pull and put the name in the subheadline. Do not spend the point a later frame makes. No button.`,
  body: 'ONE POINT: the headline says this frame\'s point, in words no other frame uses. A subheadline only when it adds a detail from the brief or the brand profile that no other frame gives, or says what the headline\'s fact means for the reader; otherwise "". Never the headline again in other words, a reassurance the brief does not give ("No card needed", "Worth every penny") or a phrase another frame used. No button.',
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

Only the brief's facts. Every number, price, time, day, date, count, place, contact and claim must be written in the brief or the brand profile, and a number written as a word counts ("one message", "two weeks"); a detail the brief did not give is left out, never guessed. State each fact a frame must carry in the brief's own words ("₦4,500 a slice", not "from ₦4,500"), each time, price, date or count in a field of its own, and a phone number never on the same line as a time (a time beside a phone number reads as part of it). Never "now", "only", "fresh", "today", "limited" or "new" unless the brief says it, and no scarcity, urgency or praise the brief does not give ("they go fast", "before it's gone", "award-winning").
${kind === "carousel" ? `A price is stated on the last ${frameNoun(kind)} only, beside the action.\n` : ""}Say everything once. A frame states the facts it must state and no others; no fact appears on two frames, or twice on one frame (in the subheadline and again in the footer). A subheadline never restates its own headline. No two headlines or subheadlines share their idea or their words beyond the offering's name. The offering is named on the first frame; later frames may name it again only where the point needs it.
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

/* The points a frame's copy keeps off, because another frame owns them:
   round 3's judge kept finding a subheadline drifting into a neighbour's
   point (the process restated under the sourcing frame). The hook's own
   opener is not a body frame's to avoid, and the
   action frame owns no point a frame before it could spend. */
function leavesTo(
  frames: readonly OutlinedFrame[],
  frame: OutlinedFrame,
  noun: string,
): string | null {
  const owners = frames.filter(
    (other) =>
      other !== frame &&
      other.role !== "cta" &&
      !(frame.role === "body" && other.role === "hook"),
  );
  return owners.length > 0
    ? `  leaves to the other ${noun}s, so says nothing of: ${owners.map((o) => `"${o.title}"`).join(", ")}`
    : null;
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
        f.profilePoint
          ? `  its point is the brand profile's, so say it in the profile's measure and add nothing to it: "${f.profilePoint}"`
          : null,
        leavesTo(frames, f, noun),
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

/** What the editor holds an opening frame to, in the order a viewer
 *  meets it. Shared by the edit pass and both choices so a hook is
 *  written and picked for the same reasons. */
function openingTest(noun: string): string {
  return `gives a concrete reason to see the next ${noun} (a question the customer is already asking, a tension they feel, or the brief's boldest specific, in the customer's terms) and says what is on offer, rather than a label, an announcement, a mood or a line any brand could post; its second line adds what its first does not`;
}

/* What makes a frame earn its place, as the edit pass reads the set. The
   eval's judge kept finding what no word count sees: two frames making one
   point in different words (the hook's one-of-a-kind claim said again on
   frame 3), a price standing alone as a receipt line, and generic payoffs
   any brand could post. */
function buildsTest(noun: string): string {
  return `every ${noun} makes its own point in its own words: no idea, claim, detail or phrase another ${noun} already gives (said in other words still counts), no ${noun} that says one thing in its headline and again in its subheadline, no ${noun} that only gives a fact without what it means for the reader, and no line any brand could post ("premier", "effortless", "moves the industry", "hands-on")`;
}

export interface EditPassInput {
  kind: SequenceKind;
  frames: readonly FrameBeat[];
  /** The frames code found problems on, with the problems named. */
  fixes: FrameFix[];
  /** What code finds wrong with the hook (hookCopyFaults). */
  hookProblems: string[];
  /** The brief's words for every fact each frame must state, by index. */
  mustState: readonly string[][];
  /** What the hook names, in these words (hookNames). */
  names: readonly string[];
  /** Brand-profile points no frame makes yet, for a frame that needs a
   *  new point. */
  spareProfilePoints?: readonly ProfilePoint[];
}

/**
 * The one repair pass, as an editor's read of the whole set: the problems
 * code found, by frame; the hook in HOOK_VERSIONS angles every time (the
 * opening decides whether anyone sees the rest, and a hook code finds no
 * fault in can still be flat); and the editor's own review of which frames
 * repeat another, which code cannot see. Code chooses between what comes
 * back and never writes a word of it.
 */
export function buildSequenceEditPrompt(
  context: DesignContext,
  {
    kind,
    frames,
    fixes,
    hookProblems,
    mustState,
    names,
    spareProfilePoints = [],
  }: EditPassInput,
): string {
  const noun = frameNoun(kind);
  const Noun = noun === "slide" ? "Slide" : "Frame";
  const last = frames.length;
  const listed = frames
    .map((f, i) => {
      const facts = mustState[i] ?? [];
      const fix = fixes.find((x) => x.index === i);
      return [
        beatLine(f, i, noun),
        facts.length > 0
          ? `  must state, in these words: ${facts.map((x) => `"${x}"`).join(", ")}`
          : null,
        ...(fix?.problems ?? []).map((p) => `  problem: ${p}`),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const hookIssues =
    hookProblems.length > 0
      ? `${Noun} 1 as it stands cannot go out:\n${hookProblems.map((p) => `- ${p}`).join("\n")}`
      : `The opening decides whether anyone sees the rest, so write versions that could open stronger than ${noun} 1 does now.`;
  const hookAsk = `- ${Noun} 1, ${HOOK_VERSIONS} versions, each from a different angle: one a question the customer is already asking, one the brief's boldest specific that no later ${noun} is about, one a before-and-after. No version uses a detail, number or phrase a later ${noun} gives: that ${noun} would then repeat the hook. ${ROLE_BRIEF.hook}${
    names.length > 0
      ? ` Each version names ${names.map((n) => `"${n}"`).join(" and ")}, in these words.`
      : ""
  } ${hookIssues}`;
  return [
    requestBlock(context, kind, frames.length, null),
    `The ${kind} so far, with what each ${noun} must state and every problem code found:\n\n${listed}`,
    `You are the editor. Read the ${kind} in order, as the viewer will, and hold it to three tests:
1. ${Noun} 1 ${openingTest(noun)}.
2. ${buildsTest(noun)}.
3. ${Noun} ${last} carries one clear action and how to take it, and recaps nothing an earlier ${noun} gave.`,
    `In "review", list every ${noun} after ${noun} 1 that fails test 2 or 3: its number, and what it repeats (name the other ${noun}) or lacks. Be as hard as a creative director who cuts any ${noun} that does not earn its place, but list only a real failure; [] when there is none.`,
    `In "frames":
${hookAsk}
- Every other ${noun} with a problem listed above, and every ${noun} your review names, ${REPAIR_VERSIONS} versions each. A version fixes every problem, keeps the ${noun}'s role and the facts it must state, and says it in words no other ${noun} uses. A ${noun} that repeated another takes a new point${
      spareProfilePoints.length > 0
        ? `: one the brief gives that no ${noun} says yet, else the first of these brand-profile points no ${noun} makes yet, in the profile's measure:\n${profilePointList(spareProfilePoints)}\nwith a title for that point.`
        : `: the one thing the brief or the brand profile gives (its offer, audience, values, what sets it apart) that no ${noun} says yet, with a title for that point.`
    } Never a point neither gives.
- No other ${noun}.`,
    COPY_RULES(kind),
    `Each entry in "frames" has "frame" set to its number, its title, headline, subheadline and footer lines. "cta" is the button on ${noun} ${last} only, and "" on every other.`,
  ].join("\n\n");
}

/** Drafts of the whole set, numbered from 1, as the editor chooses
 *  between them (sequence/choose.ts). It picks; it rewrites nothing. */
export function buildSequenceChoicePrompt(
  context: DesignContext,
  { kind, drafts }: { kind: SequenceKind; drafts: readonly FrameBeat[][] },
): string {
  const noun = frameNoun(kind);
  return [
    requestBlock(context, kind, drafts[0].length, null),
    ...drafts.map((d, i) => `Draft ${i + 1}:\n\n${beatLines(d, noun)}`),
    `You are the editor choosing which draft of this ${kind} goes out. Read each in order, as a viewer would, and choose the one that:
1. opens on a ${noun} that ${openingTest(noun)};
2. makes its own point on every ${noun}, so that read in order the ${kind} builds, with no idea, detail or phrase given twice and no ${noun} that adds nothing;
3. ends on one clear action and how to take it.
Prefer the draft that says only what the brief and brand profile give, in the brief's own measure. Answer with the draft's number.`,
  ].join("\n\n");
}

/** Versions of the opening frame, numbered from 1, against the rest of the
 *  set as it stands, for the editor to choose one. */
export function buildHookChoicePrompt(
  context: DesignContext,
  {
    kind,
    frames,
    hooks,
    faults = [],
  }: {
    kind: SequenceKind;
    frames: readonly FrameBeat[];
    hooks: readonly FrameBeat[];
    /** What code finds wrong with each version, in the order shown
     *  (hookCopyFaults), so the editor's taste never overrides it. */
    faults?: readonly (readonly string[])[];
  },
): string {
  const noun = frameNoun(kind);
  const later = new Set(frames.map((_, i) => i).filter((i) => i > 0));
  return [
    requestBlock(context, kind, frames.length, null),
    `The ${noun}s after the opening one:\n\n${beatLines(frames, noun, later)}`,
    `Versions of ${noun} 1:\n\n${hooks
      .map((h, i) =>
        [
          `${i + 1}. headline "${h.headline}"${h.subheadline ? `, subheadline "${h.subheadline}"` : ""}`,
          ...(faults[i] ?? []).map((f) => `   fault: ${f}`),
        ].join("\n"),
      )
      .join("\n")}`,
    `You are the editor choosing how this ${kind} opens. Choose the version that ${openingTest(noun)}, and that does not spend a point a later ${noun} makes. A strong opening does this: ${HOOK_CRAFT}. A version with a fault listed loses to one without. Prefer the one that claims only what the brief gives, in the brief's own measure. Answer with the version's number.`,
  ].join("\n\n");
}

/** Versions of each frame the edit pass rewrites. A rewrite that fixes
 *  one problem often makes another (a fact dropped, a neighbour echoed),
 *  and is then refused; a second version in the same call is a second
 *  chance at no extra wait. Code keeps whichever leaves fewer problems. */
export const REPAIR_VERSIONS = 2;

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
    COPY_RULES(kind),
    `Return the ${REGENERATE_VERSIONS} versions as the entries in "frames", each with "frame" set to ${index + 1}. "cta" is ${beat.role === "cta" ? "its button" : '""'}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Versions of the hook the edit pass asks for, one per angle, for the
 *  editor to choose from beside the hook the draft has. */
export const HOOK_VERSIONS = 3;
