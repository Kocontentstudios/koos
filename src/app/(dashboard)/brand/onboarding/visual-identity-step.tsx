"use client";

import { Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  brandFontOptions,
  brandStyleOptions,
} from "@/app/(dashboard)/brand/brand-profile-form";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { FileUpload } from "@/components/ui/file-upload";
import { Label } from "@/components/ui/label";
import { MAX_ADDITIONAL_COLORS } from "@/lib/brand-profile";
import { cn } from "@/lib/utils";

export interface VisualIdentityValues {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  brandStyle: string;
  brandFont: string;
  brandFontUrl: string;
  additionalColors: string[];
}

const EMPTY: VisualIdentityValues = {
  logoUrl: "",
  primaryColor: "",
  secondaryColor: "",
  brandStyle: "",
  brandFont: "",
  brandFontUrl: "",
  additionalColors: [],
};

const UPLOAD_FAILED = "Logo upload failed — you can still finish without it.";

function OptionRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium text-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(active ? "" : option)}
              className={cn(
                "min-h-[36px] rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                active
                  ? "border-[var(--border-accent)] bg-[var(--accent-glow)] text-primary"
                  : "border-transparent bg-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] hover:bg-[rgba(19,139,200,0.12)] hover:text-foreground",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Captures what the design engine needs but the conversation cannot: a logo
 * file, colours, and visual direction.
 *
 * It is a panel rather than part of the chat because the onboarding chat is
 * text-only — there is no mechanism for a file upload inside a message, and
 * inventing one to ask for a PNG would be a lot of machinery for a form field.
 */
export function VisualIdentityStep({
  brandId,
  initial,
  onSave,
  onSkip,
}: {
  brandId: string;
  initial?: Partial<VisualIdentityValues>;
  onSave: (values: VisualIdentityValues) => Promise<void> | void;
  onSkip: () => void;
}) {
  const [values, setValues] = useState<VisualIdentityValues>({
    ...EMPTY,
    ...initial,
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [fontFileName, setFontFileName] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<VisualIdentityValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function setColors(next: (current: string[]) => string[]) {
    setValues((current) => ({
      ...current,
      additionalColors: next(current.additionalColors),
    }));
  }

  async function handleFileSelected(file: File) {
    setFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) {
        setUploadError(UPLOAD_FAILED);
        set({ logoUrl: "" });
        return;
      }
      const { url } = (await res.json()) as { url: string };
      set({ logoUrl: url });
    } catch {
      setUploadError(UPLOAD_FAILED);
      set({ logoUrl: "" });
    } finally {
      setUploading(false);
    }
  }

  async function handleFontSelected(file: File) {
    setFontFileName(file.name);
    setFontError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "font");
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        // Drop the filename too: a refused font must not sit there looking
        // attached, and FileUpload only shows the error in its empty state.
        setFontFileName(null);
        setFontError(data?.error ?? "Could not upload that font file.");
        set({ brandFontUrl: "" });
        return;
      }
      const { url } = (await res.json()) as { url: string };
      set({ brandFontUrl: url });
    } catch {
      setFontFileName(null);
      setFontError("Could not upload that font file.");
      set({ brandFontUrl: "" });
    }
  }

  /* An offer, never a requirement. A provider that cannot read images, or a
     logo it cannot read colours from, leaves the fields exactly as they were
     for the user to fill in by hand. */
  async function handleExtract() {
    if (!values.logoUrl || extracting) return;
    setExtracting(true);
    try {
      const res = await fetch("/api/brand/logo-colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, logoUrl: values.logoUrl }),
      });
      const data = (await res.json().catch(() => null)) as {
        palette?: { primary: string | null; secondary: string | null };
      } | null;
      const primary = data?.palette?.primary;
      const secondary = data?.palette?.secondary;
      if (!primary && !secondary) {
        toast.message("Couldn't read colours from that logo — add them below.");
        return;
      }
      set({
        primaryColor: primary ?? values.primaryColor,
        secondaryColor: secondary ?? values.secondaryColor,
      });
      toast.success("Colours picked out of your logo — change any you like.");
    } catch {
      toast.message("Couldn't read colours from that logo — add them below.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[680px] py-8 sm:py-12">
      <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-6 sm:p-8">
        <h1 className="font-display text-[24px] font-bold text-foreground sm:text-[28px]">
          Your visual identity
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          The last piece. This is what every design we make for you is built
          from — you can change any of it later.
        </p>

        <div className="mt-7 space-y-7">
          <section className="space-y-2">
            <Label>Logo</Label>
            <FileUpload
              accept="image/png,image/svg+xml,image/jpeg"
              maxSizeMb={5}
              onFileSelected={handleFileSelected}
              onRemove={() => {
                setFileName(null);
                setPreviewUrl(null);
                setUploadError(null);
                set({ logoUrl: "" });
              }}
              fileName={fileName}
              previewUrl={previewUrl}
              error={uploadError}
            />
            <p className="text-[12px] text-[var(--text-muted)]">
              PNG, SVG or JPG up to 5MB.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Brand colours</Label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!values.logoUrl || uploading}
                loading={extracting}
                loadingText="Reading your logo…"
                onClick={handleExtract}
              >
                <Sparkles aria-hidden="true" />
                Pick from logo
              </Button>
            </div>
            {/* Every row on this screen is free text: the chat writes colour
                NAMES into these columns, so reverting one would discard what
                the user actually said. The Brand Profile form is the
                picker-driven surface and normalises instead. */}
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["primaryColor", "Primary"],
                  ["secondaryColor", "Secondary"],
                ] as const
              ).map(([key, label]) => (
                <ColorField
                  key={key}
                  id={key}
                  label={label}
                  value={values[key]}
                  allowFreeText
                  placeholder="#000000 or a name"
                  onChange={(next) => set({ [key]: next })}
                />
              ))}
            </div>

            {values.additionalColors.length > 0 && (
              <div className="flex flex-col gap-3">
                {values.additionalColors.map((colour, i) => (
                  // Index key, not the colour: two swatches may hold the same value.
                  <div key={i} className="flex items-center gap-2">
                    <ColorField
                      id={`additional-colour-${i}`}
                      label={`Additional ${i + 1}`}
                      value={colour}
                      allowFreeText
                      placeholder="#000000 or a name"
                      onChange={(next) =>
                        setColors((current) =>
                          current.map((c, j) => (j === i ? next : c)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="icon"
                      size="icon-sm"
                      aria-label={`Remove additional colour ${i + 1}`}
                      onClick={() =>
                        setColors((current) =>
                          current.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {values.additionalColors.length < MAX_ADDITIONAL_COLORS && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setColors((current) => [...current, ""])}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add colour
                </Button>
              </div>
            )}
          </section>

          <OptionRow
            label="Visual style"
            options={brandStyleOptions.filter((o) => o !== "Other (Specify)")}
            value={values.brandStyle}
            onPick={(brandStyle) => set({ brandStyle })}
          />

          <section className="space-y-2">
            <Label>Brand font file</Label>
            <FileUpload
              accept=".ttf,.otf,.ttc,font/ttf,font/otf"
              maxSizeMb={5}
              onFileSelected={handleFontSelected}
              onRemove={() => {
                setFontFileName(null);
                setFontError(null);
                set({ brandFontUrl: "" });
              }}
              fileName={fontFileName}
              error={fontError}
            />
            <p className="text-[12px] text-[var(--text-muted)]">
              TTF or OTF. Headlines will be set in it. Optional — pick a style
              below instead and we'll match it.
            </p>
          </section>

          <OptionRow
            label="Typography"
            options={brandFontOptions.filter((o) => o !== "Other (Specify)")}
            value={values.brandFont}
            onPick={(brandFont) => set({ brandFont })}
          />
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-12 w-full text-[15px] sm:w-auto"
            onClick={onSkip}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-[15px] sm:w-auto"
            loading={saving}
            loadingText="Saving…"
            onClick={handleSave}
          >
            Save and finish
          </Button>
        </div>
      </div>
    </div>
  );
}
