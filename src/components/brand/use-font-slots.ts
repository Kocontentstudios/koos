"use client";

import { useState } from "react";

/**
 * Uploading a brand typeface, for whichever form is asking.
 *
 * Shared rather than written twice. The upload route and the renderer once
 * kept their own copies of the accepted formats, which is how `.ttc` came to
 * be accepted in one and refused in the other (KOS-V1-BUG-018); two copies of
 * the UPLOAD half would drift the same way, and the second copy is what a user
 * would hit when replacing a font that the first copy had already rejected.
 */

export type FontSlot = "heading" | "body";

/** The brand column each slot writes. */
export const FONT_FIELD: Record<FontSlot, "brandFontUrl" | "bodyFontUrl"> = {
  heading: "brandFontUrl",
  body: "bodyFontUrl",
};

/* The formats the upload route actually accepts, by byte signature. Extension
   entries matter as much as the MIME ones: browsers send fonts as
   application/octet-stream or nothing at all — see file-upload.tsx.

   No .ttc: satori refuses every TrueType collection with "Unsupported OpenType
   signature ttcf", so offering it only moved the failure into the render,
   where nothing named the font. */
export const FONT_ACCEPT = ".ttf,.otf,font/ttf,font/otf";

export const FONT_MAX_MB = 5;

type SlotState<T> = Record<FontSlot, T>;

const bothSlots = <T>(value: T): SlotState<T> => ({
  heading: value,
  body: value,
});

export interface FontSlotsController {
  fileName: SlotState<string | null>;
  error: SlotState<string | null>;
  uploading: SlotState<boolean>;
  /** True while either slot is in flight, for a single shared status line. */
  busy: boolean;
  select: (slot: FontSlot, file: File) => Promise<void>;
  remove: (slot: FontSlot) => void;
}

/**
 * @param write receives the column and its new value: a URL on success, an
 *        empty string when the user removes the font. Empty rather than
 *        undefined is deliberate — the server reads omission as "leave it
 *        alone" and an empty string as "clear it" (KOS-V1-BUG-020).
 * @param initialNames filenames already stored, so a form can show what is set
 *        rather than looking empty until the user uploads something.
 */
export function useFontSlots(
  write: (field: "brandFontUrl" | "bodyFontUrl", value: string) => void,
  initialNames: Partial<SlotState<string | null>> = {},
): FontSlotsController {
  /* Per slot, not per hook: one shared value would make the heading field
     display the body field's filename and error. */
  const [fileName, setFileName] = useState<SlotState<string | null>>({
    heading: initialNames.heading ?? null,
    body: initialNames.body ?? null,
  });
  const [error, setError] = useState<SlotState<string | null>>(bothSlots(null));
  const [uploading, setUploading] = useState<SlotState<boolean>>(
    bothSlots(false),
  );

  const patch = <T>(
    set: (fn: (prev: SlotState<T>) => SlotState<T>) => void,
    slot: FontSlot,
    value: T,
  ) => set((prev) => ({ ...prev, [slot]: value }));

  function remove(slot: FontSlot) {
    patch(setFileName, slot, null);
    patch(setError, slot, null);
    write(FONT_FIELD[slot], "");
  }

  /* A refused font clears the filename too: leaving it there makes a rejected
     file look attached, and FileUpload only shows the error in its empty
     state. */
  function reject(slot: FontSlot, message: string) {
    patch(setFileName, slot, null);
    patch(setError, slot, message);
    write(FONT_FIELD[slot], "");
  }

  async function select(slot: FontSlot, file: File) {
    patch(setFileName, slot, file.name);
    patch(setError, slot, null);
    patch(setUploading, slot, true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "font");
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) {
        /* The server's message names the file and why it was refused, which
           beats anything this side could say about bytes it never saw. */
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        reject(slot, data?.error ?? "Could not upload that font file.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      write(FONT_FIELD[slot], url);
    } catch {
      reject(slot, "Could not upload that font file.");
    } finally {
      patch(setUploading, slot, false);
    }
  }

  return {
    fileName,
    error,
    uploading,
    busy: uploading.heading || uploading.body,
    select,
    remove,
  };
}

/** A readable name for a font already stored on the brand.
 *
 * The stored key is randomised at upload (`1736…-a1b2c3.ttf`), so the original
 * filename is gone by the time a form loads it. Showing the key would look
 * like corruption; showing nothing would say the brand has no font when it
 * has one. The format is the part that is both true and useful. */
export function storedFontName(url: string | null | undefined): string | null {
  if (!url) return null;
  const extension = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  return extension ? `Current font (.${extension})` : "Current font";
}
