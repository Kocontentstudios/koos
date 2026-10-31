import type {
  FrameRole,
  OutlinePoint,
  PlannedOutline,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";

export const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
export const SET = "9b1d7c1e-5f7e-4d4b-8f43-2f8f0c1a0b11";

const TITLES = [
  "The launch",
  "The fabric",
  "The price",
  "The venue",
  "Book now",
];

function roleAt(index: number, count: number): FrameRole {
  if (index === 0) return "hook";
  return index === count - 1 ? "cta" : "body";
}

/** One frame row as GET /api/design/generations serializes it. */
export function frameRow(
  index: number,
  overrides: Partial<SerializedGeneration> & { count?: number } = {},
): SerializedGeneration {
  const { count = 5, ...rest } = overrides;
  return {
    id: `f${index}`,
    url: `https://cdn.example/f${index}.png`,
    renderer: "composite",
    provider: "koos",
    model: "satori",
    status: "succeeded",
    error: null,
    width: 1080,
    height: 1350,
    designType: "Instagram carousel",
    briefId: null,
    calendarItemId: null,
    headline: `Headline ${index + 1}`,
    subheadline: `Subheadline ${index + 1}`,
    cta: roleAt(index, count) === "cta" ? "Book a table" : null,
    createdAt: `2026-10-30T10:00:0${index}.000Z`,
    direction: { title: TITLES[index] ?? `Frame ${index + 1}`, reasons: [] },
    imageSource: "none",
    editable: true,
    frame: {
      setId: SET,
      index,
      count,
      role: roleAt(index, count),
      title: TITLES[index] ?? `Frame ${index + 1}`,
    },
    ...rest,
  } as SerializedGeneration;
}

export function frameRows(count = 5): SerializedGeneration[] {
  return Array.from({ length: count }, (_, i) => frameRow(i, { count }));
}

export function singleRow(
  id: string,
  overrides: Partial<SerializedGeneration> = {},
): SerializedGeneration {
  return {
    ...frameRow(0),
    id,
    url: `https://cdn.example/${id}.png`,
    designType: "Instagram post",
    headline: `Single ${id}`,
    direction: null,
    frame: null,
    ...overrides,
  };
}

const OUTLINE_POINTS: Omit<OutlinePoint, "id" | "role">[] = [
  {
    title: "The launch",
    point: "Ade's new linen range opens this Saturday.",
    source: "brief",
    facts: ["linen range", "Saturday"],
    weak: null,
  },
  {
    title: "The fabric",
    point: "Every piece is woven in Abeokuta from Nigerian cotton.",
    source: "brief",
    facts: ["Abeokuta"],
    weak: null,
  },
  {
    title: "Who it's for",
    point: "For young professionals in Lagos.",
    source: "brief",
    facts: [],
    weak: {
      kind: "filler",
      reason: "Only says who it is for. Add what the reader gets.",
    },
  },
  {
    title: "Our story",
    point: "We have tailored for Lagos families since 1998.",
    source: "profile",
    facts: [],
    weak: {
      kind: "profile-fill",
      reason:
        "Taken from your brand profile, not this brief. Replace it with something about this offer.",
    },
  },
  {
    title: "Come Saturday",
    point: "Visit the Lekki store this Saturday from 10am.",
    source: "brief",
    facts: ["Lekki store"],
    weak: null,
  },
];

/** What POST /api/design/outline answers with: N points, hook first, cta
 *  last, two of them flagged weak. */
export function plannedOutline(
  count = 5,
  kind: SequenceKind = "carousel",
): PlannedOutline {
  const bodies = OUTLINE_POINTS.slice(1, -1);
  const points = Array.from({ length: count }, (_, i) => {
    const base =
      i === 0
        ? OUTLINE_POINTS[0]
        : i === count - 1
          ? OUTLINE_POINTS[OUTLINE_POINTS.length - 1]
          : (bodies[i - 1] ?? {
              title: `Point ${i + 1}`,
              point: `Body point number ${i + 1}.`,
              source: "brief" as const,
              facts: [],
              weak: null,
            });
    return { ...base, id: `p${i + 1}`, role: roleAt(i, count) };
  });
  return {
    kind,
    frameCount: count,
    points,
    offering: "linen range",
    facts: ["linen range", "Saturday", "Abeokuta", "Lekki store"],
  };
}
