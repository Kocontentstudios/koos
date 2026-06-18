"use client";

import { FileIcon, X } from "lucide-react";
import NextImage from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  accept?: string;
  maxSizeMb?: number;
  onFileSelected: (file: File) => void;
  onRemove?: () => void;
  fileName?: string | null;
  previewUrl?: string | null;
  error?: string | null;
}

function matchesAccept(file: File, accept: string): boolean {
  const types = accept.split(",").map((t) => t.trim());
  return types.some((t) => {
    if (t.endsWith("/*")) {
      const prefix = t.slice(0, t.indexOf("/"));
      return file.type.startsWith(`${prefix}/`);
    }
    return file.type === t;
  });
}

export function FileUpload({
  accept,
  maxSizeMb = 5,
  onFileSelected,
  onRemove,
  fileName,
  previewUrl,
  error: errorProp,
}: FileUploadProps) {
  const [internalError, setInternalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayError = internalError ?? errorProp ?? null;

  function processFile(file: File) {
    if (accept && !matchesAccept(file, accept)) {
      setInternalError("Unsupported file type");
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setInternalError(`Image is too large (max ${maxSizeMb}MB)`);
      return;
    }
    setInternalError(null);
    onFileSelected(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  if (fileName) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[rgba(255,255,255,0.12)] p-3">
        {previewUrl ? (
          <NextImage
            src={previewUrl}
            alt={fileName ?? "preview"}
            width={40}
            height={40}
            className="size-10 rounded object-cover"
            unoptimized
          />
        ) : (
          <FileIcon className="size-8 text-[var(--text-secondary)]" />
        )}
        <span className="flex-1 truncate text-[13px] text-foreground">
          {fileName}
        </span>
        <button
          type="button"
          aria-label="Remove file"
          className="rounded p-1 hover:bg-[rgba(255,255,255,0.08)]"
          onClick={onRemove}
        >
          <X className="size-4 text-[var(--text-secondary)]" />
        </button>
      </div>
    );
  }

  const subtext = [
    accept ? accept.replace("image/*", "Images") : null,
    maxSizeMb ? `Max ${maxSizeMb}MB` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[rgba(255,255,255,0.12)] px-6 py-10 text-center transition-colors",
          dragOver &&
            "border-[var(--border-accent)] bg-[rgba(19,139,200,0.06)]",
          "hover:border-[var(--border-accent)]",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          data-testid="file-input"
          accept={accept}
          className="sr-only"
          onChange={handleChange}
        />
        <p className="text-[13px] font-medium text-foreground">
          Click to upload or drag and drop
        </p>
        {subtext && (
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">{subtext}</p>
        )}
      </label>
      {displayError && (
        <p className="mt-1 text-[12px] text-[var(--status-error-fg)]">
          {displayError}
        </p>
      )}
    </div>
  );
}
