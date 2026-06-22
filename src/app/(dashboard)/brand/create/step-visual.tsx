"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { FileUpload } from "@/components/ui/file-upload";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brandStyleOptions } from "../brand-profile-form";
import type { CreateBrandState } from "./create-brand-form";
import { Field, OtherSelect } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepVisual({ state, onChange }: StepProps) {
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
      <p className="text-[13px] font-medium text-[var(--text-muted)]">
        Optional
      </p>

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
            <p className="text-[12px] text-[var(--text-secondary)]">
              Uploading…
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <Label>Brand Colors</Label>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Hex codes if you have them.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ColorPicker
            id="primary-color"
            label="Primary"
            value={state.primaryColor || "#138BC8"}
            onChange={(hex) => onChange({ primaryColor: hex })}
          />
          <ColorPicker
            id="secondary-color"
            label="Secondary"
            value={state.secondaryColor || "#FFFFFF"}
            onChange={(hex) => onChange({ secondaryColor: hex })}
          />
        </div>
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
    </div>
  );
}
