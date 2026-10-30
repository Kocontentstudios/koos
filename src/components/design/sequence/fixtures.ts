import type { FrameRole } from "@/lib/design/sequence/contract";
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
