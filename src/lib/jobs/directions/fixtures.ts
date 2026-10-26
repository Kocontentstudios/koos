import type { DirectionDraft } from "./schema";

/**
 * Model answers and a design context for the directions tests. A draft is
 * the full shape generateObject returns, so a test that reads one field is
 * not quietly passing on a double that lacks the rest.
 */

export function draftOf(over: Partial<DirectionDraft> = {}): DirectionDraft {
  return {
    layout: "hero-center",
    headline: "Almond croissants for the commute",
    subheadline: "Baked before sunrise in Lekki",
    cta: "Order for pickup",
    footerStyle: "none",
    footerLines: [],
    palette: {
      background: "#FFF4E6",
      foreground: "#3B2416",
      accent: "#C2410C",
    },
    logoPlacement: "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundPrompt: "a bakery counter at dawn with almond croissants",
    backgroundTreatment: "photographic",
    nativePrompt: "a bakery poster",
    aspectRatio: "4:5",
    title: "Morning bake story",
    rationale: [
      "Leads with the croissant, the product commuters queue for",
      "Speaks to commuters on their way to work",
    ],
    productName: "almond croissants",
    productLook:
      "golden crescent pastries topped with flaked almonds and icing sugar",
    ...over,
  };
}

/** A second concept that shares nothing with draftOf()'s copy. */
export function contrastingDraft(
  over: Partial<DirectionDraft> = {},
): DirectionDraft {
  return draftOf({
    layout: "quote-card",
    headline: "Your weekend table is waiting",
    subheadline: "Slow brunch, good coffee, no rush",
    cta: "Book a table",
    backgroundPrompt: "a sunlit cafe table set for two with coffee",
    title: "Weekend table invitation",
    rationale: [
      "Speaks to weekend brunch, the occasion in the brief",
      "The headline invites weekend brunch regulars in",
    ],
    ...over,
  });
}

export const BRAND_ID = "11111111-1111-4111-8111-111111111111";

export function directionsContext(over: Record<string, unknown> = {}) {
  return {
    source: "quick",
    brand: {
      id: BRAND_ID,
      name: "Crumb & Co.",
      logoUrl: null,
      primaryColor: "#FFF4E6",
      secondaryColor: "#C2410C",
      additionalColors: null,
      brandFontUrl: null,
      bodyFontUrl: null,
    },
    brandSummary: {
      name: "Crumb & Co.",
      overview: "Neighbourhood bakery in Lekki, Lagos",
      tone: "Warm and unfussy",
      primaryColor: "#FFF4E6",
      secondaryColor: "#C2410C",
    },
    briefId: null,
    calendarItemId: null,
    attachments: [],
    title: "Croissant launch",
    briefText:
      "Promote our almond croissants to commuters before work. Brunch on weekends.",
    designType: "Instagram Post",
    dimensions: "1080x1350",
    aspectRatio: "4:5",
    platform: "Instagram",
    scheduledFor: null,
    referenceUrls: [],
    logoAssetUrls: [],
    logoCandidates: [],
    ...over,
  } as never;
}

/**
 * A PNG header carrying a design's compressed density. The blank-frame check
 * measures bytes per pixel, so a 64-byte stub for a 1080x1350 frame would
 * read as an empty render and send every test through the correction path.
 */
export function designPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64 + Math.ceil(width * height * 0.08));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A plate check's answer: the product shown or not, nothing lettered, and
 *  no subject box unless one is given. */
export function verdict(
  shows: boolean,
  seen: string,
  extra: Partial<{
    subject: { x: number; y: number; w: number; h: number } | null;
    items: string[];
    lettering: boolean;
    person: boolean;
  }> = {},
) {
  return {
    shows,
    seen,
    subject: null,
    items: [],
    lettering: false,
    person: false,
    ...extra,
  };
}

/** Whether a mocked generateObject call is the brief reader's
 *  (brief-read.ts), so a test can answer it apart from the directions. */
export function isBriefReadCall(options: unknown): boolean {
  const prompt = (options as { prompt?: unknown } | null)?.prompt;
  return (
    typeof prompt === "string" &&
    prompt.startsWith("You read a small business's design brief")
  );
}

/** The brief reader's answer: the facts given, in the brief's words. */
export function readAnswer(
  facts: { kind: string; text: string }[] = [],
  offering: { kind: string; phrase: string } = { kind: "none", phrase: "" },
  people: string[] = [],
) {
  return { object: { facts, offering, people } };
}

const promptOf = (options: unknown): string => {
  const prompt = (options as { prompt?: unknown } | null)?.prompt;
  return typeof prompt === "string" ? prompt : "";
};

/** The fact writer's call (fact-writer.ts). */
export function isFactWriteCall(options: unknown): boolean {
  return promptOf(options).startsWith(
    "You edit the copy of social media designs",
  );
}

/** The claim check's call (claim-check.ts). */
export function isClaimCheckCall(options: unknown): boolean {
  return promptOf(options).startsWith("You check marketing copy");
}

const quoted = (text: string) =>
  [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/**
 * A well-behaved model's answer to the fact writer: the subheadline kept,
 * fragment items and times on a phone's line moved apart, and each missing
 * fact written in the brief's words on a footer line of its own, joined to
 * the last line once there are three. Job tests use it where the real model
 * would write the facts in.
 */
export function fakeFactWrite(options: unknown): {
  object: {
    rewrites: { id: number; subheadline: string; footerLines: string[] }[];
  };
} {
  const blocks = promptOf(options)
    .split(/\n\n(?=Design \d+:)/)
    .slice(1);
  const rewrites = blocks.map((block) => {
    const id = Number(/^Design (\d+):/.exec(block)?.[1] ?? 0);
    const field = (name: string) =>
      new RegExp(`^  ${name}: (.*)$`, "m").exec(block)?.[1] ?? "";
    const sub = field("subheadline");
    const footer = field("footer lines");
    const missing = quoted(field("must state"));
    const items = (footer === "(none)" ? [] : quoted(footer))
      .map((line) =>
        line
          .split(" · ")
          .filter(
            (item) => !/^(?:one|two|three|four|five|\d[\d,.]*)$/i.test(item),
          )
          .join(" · "),
      )
      .filter(Boolean);
    /* Hours and days a model writes as opening times, never bare. */
    const isHours = (text: string) =>
      !/\d{7,}|\d[\d\s-]{8,}/.test(text) &&
      (/^[\d\s:.–-]+(?:am|pm)?$/i.test(text) ||
        /^(?:daily|weekdays?|weekends?|every ?day|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)(?:\s|$)/i.test(
          text,
        ) ||
        /^\d{1,2}\s?[-–]\s?\d{1,2}\b/.test(text));
    const hours = missing.filter(isHours);
    const lines: string[] = [];
    const written = [
      ...items,
      ...missing.filter((m) => !isHours(m)),
      ...(hours.length > 0 ? [`Open ${hours.join(" ")}`] : []),
    ];
    for (const item of written) {
      const bareNumber = /^[\d\s+().-]{7,}$/.test(item);
      const phoneLine = lines.findIndex((l) => /\d{4}/.test(l));
      if (bareNumber && phoneLine >= 0) {
        lines[phoneLine] = `${lines[phoneLine]} or ${item}`;
      } else if (lines.length < 3) lines.push(item);
      else lines[2] = `${lines[2]} · ${item}`;
    }
    return {
      id,
      subheadline: sub === "(none)" ? "" : sub,
      footerLines: lines,
    };
  });
  return { object: { rewrites } };
}
