/**
 * The filename a saved design lands under.
 *
 * Built from what the user can see on the card — the design type and the
 * pixel size — because a folder of `design-a1b2c3d4.png` is unsortable and
 * tells them nothing about which file is the portrait one.
 */
export interface DownloadNameFields {
  id: string;
  designType: string | null;
  width: number | null;
  height: number | null;
}

function slug(value: string): string {
  return (
    value
      /* Accents are folded, not split on: "Ünïcode" would otherwise become
       "n-code" rather than "unicode", which is worse than dropping them. */
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      /* designType is unbounded free text and ends up in a
         Content-Disposition filename; 48 characters identifies a design. */
      .slice(0, 48)
      .replace(/-+$/, "")
  );
}

export function generationFileName(fields: DownloadNameFields): string {
  const parts = [
    slug(fields.designType ?? "") || "design",
    fields.width && fields.height ? `${fields.width}x${fields.height}` : null,
    // Enough to tell two same-day variants apart without pasting a full uuid.
    fields.id.slice(0, 8),
  ].filter(Boolean);
  return `${parts.join("-")}.png`;
}
