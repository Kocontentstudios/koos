"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { FileUpload } from "@/components/ui/file-upload";
import { Label } from "@/components/ui/label";
import type { CreateBrandState } from "./create-brand-form";

interface StepAssetsProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepAssets({ state, onChange }: StepAssetsProps) {
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileSelected(file: File) {
    setLogoFileName(file.name);
    // Show a local preview immediately
    const localUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(localUrl);
    setLogoUploadError(null);

    // Upload to our R2-backed endpoint
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });

      if (!res.ok) {
        setLogoUploadError(
          "Logo upload failed — you can still save your brand without it.",
        );
        // Keep the local preview but clear logoUrl so submit proceeds without it
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
      {/* Logo Upload */}
      <div className="flex flex-col gap-2">
        <Label>Brand Logo</Label>
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
          <p className="text-[12px] text-[var(--text-secondary)]">Uploading…</p>
        )}
      </div>

      {/* Colors */}
      <div className="flex flex-col gap-4">
        <div>
          <Label>Brand Colors</Label>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Choose the primary and secondary colors for your brand.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ColorPicker
            id="primary-color"
            label="Primary Color"
            value={state.primaryColor || "#138BC8"}
            onChange={(hex) => onChange({ primaryColor: hex })}
          />
          <ColorPicker
            id="secondary-color"
            label="Secondary Color"
            value={state.secondaryColor || "#FFFFFF"}
            onChange={(hex) => onChange({ secondaryColor: hex })}
          />
        </div>
      </div>
    </div>
  );
}
