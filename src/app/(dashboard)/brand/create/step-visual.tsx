"use client";

import { Loader2Icon, Plus, UploadCloud, X } from "lucide-react";
import { useState } from "react";
import {
  FONT_ACCEPT,
  FONT_MAX_MB,
  storedFontName,
  useFontSlots,
} from "@/components/brand/use-font-slots";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { EditableLabel } from "@/components/ui/editable-label";
import { FileUpload } from "@/components/ui/file-upload";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelsToStore, pairColourLabels } from "@/lib/brand/colour-labels";
import { MAX_ADDITIONAL_COLORS } from "@/lib/brand-profile";
import { brandFontOptions, brandStyleOptions } from "../brand-profile-form";
import type { CreateBrandState } from "./create-brand-form";
import { Field, OtherSelect } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepVisual({ state, onChange }: StepProps) {
  /* Guarded: localStorage drafts are restored with a raw JSON.parse and a
     shallow merge, so a corrupted draft can hand us a non-array here. */
  const additionalColorLabels = Array.isArray(state.additionalColorLabels)
    ? (state.additionalColorLabels as string[])
    : [];
  const additionalColors = Array.isArray(state.additionalColors)
    ? state.additionalColors
    : [];
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /* Seeded from the stored URLs so an existing brand shows that a font IS set
     rather than looking as if it has none — the whole point of putting this
     on the form a user can actually return to. */
  const fonts = useFontSlots((field, value) => onChange({ [field]: value }), {
    heading: storedFontName(state.brandFontUrl),
    body: storedFontName(state.bodyFontUrl),
  });

  async function handleFileSelected(file: File) {
    setLogoFileName(file.name);
    setLogoPreviewUrl(URL.createObjectURL(file));
    setLogoUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) {
        setLogoUploadError(
          "Logo upload failed — you can still save your brand without it.",
        );
        onChange({ logoUrl: "" });
      } else {
        const { url } = (await res.json()) as { url: string };
        onChange({ logoUrl: url });
      }
    } catch {
      setLogoUploadError(
        "Logo upload failed — you can still save your brand without it.",
      );
      onChange({ logoUrl: "" });
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveLogo() {
    setLogoFileName(null);
    setLogoPreviewUrl(null);
    setLogoUploadError(null);
    onChange({ logoUrl: "" });
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Do You Have a Logo?" htmlFor="has-logo">
        <Select
          value={state.hasLogo}
          onValueChange={(v) => onChange({ hasLogo: v ?? "" })}
        >
          <SelectTrigger id="has-logo" className="w-full">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Yes">Yes</SelectItem>
            <SelectItem value="No">No</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {state.hasLogo === "Yes" && (
        <div className="flex flex-col gap-2">
          <Label>Logo Upload</Label>
          <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            <UploadCloud className="size-3.5" aria-hidden="true" />
            PNG, SVG, or JPG up to 5MB.
          </p>
          <FileUpload
            accept="image/png,image/svg+xml,image/jpeg"
            maxSizeMb={5}
            onFileSelected={handleFileSelected}
            onRemove={handleRemoveLogo}
            fileName={logoFileName}
            previewUrl={logoPreviewUrl}
            error={logoUploadError}
          />
          {uploading && (
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <Loader2Icon
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
              Uploading…
            </p>
          )}
        </div>
      )}

      {/* KOS-V1-FEAT-022. Before this the only font-file input in the product
          was inside conversational onboarding, so a brand whose typeface was
          unusable was told to re-upload it somewhere that did not exist. */}
      <div className="flex flex-col gap-4">
        <div>
          <Label>Brand Fonts</Label>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            TTF or OTF up to {FONT_MAX_MB}MB. Optional — pick a typography style
            below instead and we'll match it.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-heading-font">Heading / main font</Label>
          <FileUpload
            id="edit-heading-font"
            accept={FONT_ACCEPT}
            maxSizeMb={FONT_MAX_MB}
            onFileSelected={(file) => fonts.select("heading", file)}
            onRemove={() => fonts.remove("heading")}
            fileName={fonts.fileName.heading}
            error={fonts.error.heading}
          />
          <p className="text-[12px] text-[var(--text-muted)]">
            Headlines are set in this.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-body-font">Body / CTA font</Label>
          <FileUpload
            id="edit-body-font"
            accept={FONT_ACCEPT}
            maxSizeMb={FONT_MAX_MB}
            onFileSelected={(file) => fonts.select("body", file)}
            onRemove={() => fonts.remove("body")}
            fileName={fonts.fileName.body}
            error={fonts.error.body}
          />
          <p className="text-[12px] text-[var(--text-muted)]">
            Body copy, buttons and calls to action. Leave it empty to keep using
            the heading font's pairing.
          </p>
        </div>

        {fonts.busy && (
          <p
            role="status"
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"
          >
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            Uploading your {fonts.uploading.heading ? "heading" : "body"} font…
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Label>Brand Colors</Label>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Hex codes if you have them.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          <ColorField
            id="primary-color"
            label="Primary"
            value={state.primaryColor || "#138BC8"}
            noun="color"
            onChange={(hex) => onChange({ primaryColor: hex })}
          />
          <ColorField
            id="secondary-color"
            label="Secondary"
            value={state.secondaryColor || "#FFFFFF"}
            noun="color"
            onChange={(hex) => onChange({ secondaryColor: hex })}
          />
        </div>

        {additionalColors.length > 0 && (
          <div className="flex flex-col gap-3">
            {pairColourLabels(additionalColors, additionalColorLabels).map(
              (entry, i) => (
                // Index key, not the value: two swatches may hold the same one.
                <div key={i} className="flex items-center gap-2">
                  <ColorField
                    id={`additional-color-${i}`}
                    /* The custom name IS the accessible name, so a screen
                       reader hears "Pick Accent color", not "Additional 2". */
                    label={entry.label}
                    hideVisibleLabel
                    value={entry.value}
                    noun="color"
                    placeholder="#000000"
                    onChange={(next) =>
                      onChange({
                        additionalColors: additionalColors.map((c, j) =>
                          j === i ? next : c,
                        ),
                      })
                    }
                  />
                  <EditableLabel
                    value={entry.label}
                    isDefault={entry.isDefault}
                    onCommit={(name) =>
                      onChange({
                        additionalColorLabels: labelsToStore(
                          additionalColors.map((_, j) =>
                            j === i ? name : (additionalColorLabels[j] ?? ""),
                          ),
                          additionalColors.length,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="icon"
                    size="icon-sm"
                    aria-label={`Remove ${entry.label}`}
                    onClick={() =>
                      onChange({
                        additionalColors: additionalColors.filter(
                          (_, j) => j !== i,
                        ),
                        /* The label goes with its colour. Left behind, it
                           would reattach to whatever is added next. */
                        additionalColorLabels: labelsToStore(
                          additionalColorLabels.filter((_, j) => j !== i),
                          additionalColors.length - 1,
                        ),
                      })
                    }
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ),
            )}
          </div>
        )}

        {additionalColors.length < MAX_ADDITIONAL_COLORS && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  additionalColors: [...additionalColors, ""],
                })
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Add color
            </Button>
          </div>
        )}
      </div>

      <OtherSelect
        id="brand-style"
        label="Brand Style"
        placeholder="Select a style..."
        options={brandStyleOptions}
        value={state.brandStyle}
        otherValue={state.brandStyleOther}
        onChange={(v) => onChange({ brandStyle: v })}
        onOtherChange={(v) => onChange({ brandStyleOther: v })}
      />

      <OtherSelect
        id="brand-font"
        label="Typography"
        placeholder="Select a type style..."
        options={brandFontOptions}
        value={state.brandFont}
        otherValue={state.brandFontOther}
        onChange={(v) => onChange({ brandFont: v })}
        onOtherChange={(v) => onChange({ brandFontOther: v })}
      />
    </div>
  );
}
