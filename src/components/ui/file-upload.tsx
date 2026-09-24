"use client";

import { FileIcon, X } from "lucide-react";
import NextImage from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  accept?: string;
  /** Set when a <Label htmlFor> points at this field — without it the label
   *  is associated with nothing and the control has no accessible name.
   *  Note it only reaches the input in the EMPTY state: once a file is
   *  attached this renders a chip with no form control, so a form with two
   *  of these should label the surrounding group, not rely on htmlFor. */
  id?: string;
  /** What this upload is for, e.g. "heading font". Distinguishes the remove
   *  buttons when a form has more than one: without it every one of them is
   *  called "Remove file" and neither a screen reader nor a test can say
   *  which file is about to go. */
  label?: string;
  maxSizeMb?: number;
  onFileSelected: (file: File) => void;
  onRemove?: () => void;
  fileName?: string | null;
  previewUrl?: string | null;
  error?: string | null;
}

/**
 * The HTML `accept` grammar, honestly implemented.
 *
 * `accept` holds two different kinds of entry and they are matched against
 * two different things: an extension (".ttf") matches the FILE NAME, a MIME
 * type ("image/png") matches file.type. Comparing an extension against
 * file.type is never true, which is what refused every .ttf, .otf and .ttc
 * upload with "Unsupported file type" — and .ttc had no MIME entry at all, so
 * it could not be uploaded by any browser.
 *
 * Extension matching also carries the case this component cannot otherwise
 * survive: browsers disagree wildly on a font's MIME, sending
 * application/octet-stream, font/sfnt, application/x-font-ttf or an empty
 * string depending on the platform. The name is the only stable signal on the
 * client. The server does not trust either one — it validates fonts by byte
 * signature — so this check is a courtesy that fails fast, never the control.
 */
function matchesAccept(file: File, accept: string): boolean {
  const types = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  // An accept list that says nothing constrains nothing.
  if (types.length === 0) return true;

  const name = file.name.toLowerCase();
  /* Not lowercased: the File API normalises `type` to ASCII lowercase before
     it is ever readable, so doing it again is unreachable. The NAME is not
     normalised by the platform, which is why that one is. */
  const mime = file.type;
  return types.some((t) => {
    if (t.startsWith(".")) return name.endsWith(t);
    if (t.endsWith("/*"))
      return mime.startsWith(`${t.slice(0, t.indexOf("/"))}/`);
    return mime === t;
  });
}

export function FileUpload({
  accept,
  id,
  label,
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
      <div className="relative flex items-center gap-3 rounded-lg border border-[rgba(255,255,255,0.12)] p-3">
        {/* Rendered here too, not only in the empty state: a <Label htmlFor>
            pointing at this field would otherwise be associated with nothing
            the moment a file is attached, and a form with two of these would
            have two orphaned labels. It also means clicking that label picks a
            replacement, so swapping a file does not require removing it first
            and briefly having none. */}
        <input
          ref={inputRef}
          id={id}
          type="file"
          data-testid="file-input"
          accept={accept}
          className="sr-only"
          onChange={handleChange}
        />
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
          aria-label={label ? `Remove ${label}` : "Remove file"}
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
          id={id}
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
