"use client";

import { Star, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addLogoVariation,
  removeLogoVariation,
  setDefaultLogoVariation,
} from "./actions";

/**
 * The other marks a brand holds (FEAT-032).
 *
 * `brands.logo_url` stays the primary logo; these are the stacked, horizontal,
 * icon and light/dark cuts that used to overwrite it. The renderer picks
 * between them by MEASURING contrast against each design's background
 * (loadBestLogo), so what is captured here is what measurement cannot infer:
 * what a human calls it, what shape it is, and which one to reach for when two
 * read equally well.
 */

const VARIANTS = [
  { value: "horizontal", label: "Horizontal lockup" },
  { value: "vertical", label: "Stacked" },
  { value: "icon", label: "Icon / mark" },
  { value: "wordmark", label: "Wordmark" },
  { value: "alternate", label: "Alternate" },
] as const;

const BACKGROUNDS = [
  { value: "any", label: "Any background" },
  { value: "light", label: "Light backgrounds" },
  { value: "dark", label: "Dark backgrounds" },
] as const;

export interface LogoVariationRow {
  id: string;
  fileUrl: string;
  fileName: string;
  label: string | null;
  logoVariant: (typeof VARIANTS)[number]["value"] | "primary" | null;
  logoBackground: (typeof BACKGROUNDS)[number]["value"];
  isPreferred: boolean;
}

/** What to call a variation that was never labelled — a filename is noise. */
function nameOf(row: LogoVariationRow): string {
  if (row.label?.trim()) return row.label;
  const shape = VARIANTS.find((v) => v.value === row.logoVariant)?.label;
  return shape ?? row.fileName;
}

export function LogoVariations({
  brandId,
  initial,
}: {
  brandId: string;
  initial: LogoVariationRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("");
  const [variant, setVariant] =
    useState<(typeof VARIANTS)[number]["value"]>("horizontal");
  const [background, setBackground] =
    useState<(typeof BACKGROUNDS)[number]["value"]>("any");
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) {
        toast.error("That upload failed. Try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      setUploadedUrl(url);
      setFileName(file.name);
    } catch {
      toast.error("That upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleAdd() {
    if (!uploadedUrl) return;
    startTransition(async () => {
      const result = await addLogoVariation({
        brandId,
        fileUrl: uploadedUrl,
        fileName,
        label,
        logoVariant: variant,
        logoBackground: background,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      /* Optimistic row with a temporary id: the server revalidates /brand, and
         until that lands the user should see what they just added. */
      setRows((current) => [
        ...current,
        {
          id: `pending-${uploadedUrl}`,
          fileUrl: uploadedUrl,
          fileName,
          label: label.trim() || null,
          logoVariant: variant,
          logoBackground: background,
          isPreferred: false,
        },
      ]);
      setUploadedUrl(null);
      setFileName("");
      setLabel("");
      toast.success("Variation saved.");
    });
  }

  function handleDefault(row: LogoVariationRow) {
    startTransition(async () => {
      const result = await setDefaultLogoVariation(brandId, row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRows((current) =>
        current.map((r) => ({ ...r, isPreferred: r.id === row.id })),
      );
    });
  }

  function handleRemove(row: LogoVariationRow) {
    startTransition(async () => {
      const result = await removeLogoVariation(brandId, row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRows((current) => current.filter((r) => r.id !== row.id));
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          Other versions of your logo
        </h3>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          A stacked mark, a horizontal lockup, an icon, or light and dark cuts.
          KO picks whichever reads best on each design.
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid={`variation-${row.id}`}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-1 px-3 py-2"
            >
              {/* biome-ignore lint/performance/noImgElement: an R2 logo URL, not optimizable by next/image */}
              <img
                src={row.fileUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {nameOf(row)}
                  {row.isPreferred && (
                    <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                      Default
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {
                    BACKGROUNDS.find((b) => b.value === row.logoBackground)
                      ?.label
                  }
                </p>
              </div>
              {!row.isPreferred && (
                <button
                  type="button"
                  onClick={() => handleDefault(row)}
                  disabled={pending}
                  aria-label={`Make ${nameOf(row)} the default`}
                  className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
                >
                  <Star className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemove(row)}
                disabled={pending}
                aria-label={`Remove ${nameOf(row)}`}
                className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] p-3">
        <div>
          <Label htmlFor="variation-file">Logo file</Label>
          <input
            id="variation-file"
            data-testid="variation-file"
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="mt-1 block w-full text-sm text-[var(--text-secondary)]"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="variation-label">What to call it</Label>
            <Input
              id="variation-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Horizontal lockup"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="variation-shape">Shape</Label>
            <select
              id="variation-shape"
              value={variant}
              onChange={(e) =>
                setVariant(e.target.value as (typeof VARIANTS)[number]["value"])
              }
              className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="variation-background">Background</Label>
            <select
              id="variation-background"
              value={background}
              onChange={(e) =>
                setBackground(
                  e.target.value as (typeof BACKGROUNDS)[number]["value"],
                )
              }
              className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {BACKGROUNDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleAdd}
          disabled={!uploadedUrl || uploading || pending}
          loading={pending}
          loadingText="Saving…"
        >
          Add variation
        </Button>
      </div>
    </div>
  );
}
