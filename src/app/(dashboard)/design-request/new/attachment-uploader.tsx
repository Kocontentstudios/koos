"use client";

import { FileUp, Link2, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  ALLOWED_UPLOAD_SUMMARY,
  type AttachmentInput,
  isAllowedUpload,
  MAX_UPLOAD_BYTES,
} from "@/lib/design/request-form";
import { cn } from "@/lib/utils";

interface PendingUpload {
  id: string;
  fileName: string;
  progress: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  // XMLHttpRequest instead of fetch: fetch exposes no upload progress events.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export function AttachmentUploader({
  brandId,
  category,
  attachments,
  onAdd,
  onRemove,
  remainingFileSlots,
  linkPlaceholder = "Paste a Google Drive, Dropbox, or Figma link",
}: {
  brandId: string;
  category: "asset" | "reference";
  attachments: AttachmentInput[];
  onAdd: (items: AttachmentInput[]) => void;
  onRemove: (index: number) => void;
  remainingFileSlots: number;
  linkPlaceholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: File[]) {
    setError(null);
    if (!brandId) {
      setError("Choose a brand before uploading files.");
      return;
    }
    const slots = remainingFileSlots;
    if (files.length > slots) {
      setError(
        slots === 0
          ? "File limit reached — remove a file to add another."
          : `You can add ${slots} more file${slots === 1 ? "" : "s"}.`,
      );
      files = files.slice(0, Math.max(0, slots));
    }
    for (const file of files) {
      if (!isAllowedUpload(file.name, file.type)) {
        setError(`"${file.name}" is not supported. ${ALLOWED_UPLOAD_SUMMARY}.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`"${file.name}" is over the 100 MB limit.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPending((p) => [...p, { id, fileName: file.name, progress: 0 }]);
      try {
        const presignRes = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });
        const presign = (await presignRes.json()) as
          | { key: string; url: string }
          | { error: string };
        if (!presignRes.ok || !("url" in presign)) {
          throw new Error(
            ("error" in presign && presign.error) || "Upload failed",
          );
        }
        await uploadToPresignedUrl(presign.url, file, (fraction) =>
          setPending((p) =>
            p.map((u) => (u.id === id ? { ...u, progress: fraction } : u)),
          ),
        );
        onAdd([
          {
            kind: "file",
            key: presign.key,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            category,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setPending((p) => p.filter((u) => u.id !== id));
      }
    }
  }

  function addLink() {
    const url = link.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setError("Links must start with http:// or https://");
      return;
    }
    setError(null);
    onAdd([{ kind: "link", url, category }]);
    setLink("");
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
          dragOver
            ? "border-[var(--border-accent)] bg-surface-2"
            : "border-[var(--border)] bg-surface-1",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp size={20} className="text-[var(--text-muted)]" />
        <span className="text-[13px] text-[var(--text-secondary)]">
          Drag and drop files here, or{" "}
          <span className="font-semibold text-primary">browse</span>
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {ALLOWED_UPLOAD_SUMMARY}. Up to 100 MB each.
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2
            size={14}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-surface-1 py-2 pr-3 pl-8 text-[13px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] focus-visible:outline-none"
            placeholder={linkPlaceholder}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-accent)] hover:text-foreground"
          onClick={addLink}
        >
          Add link
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}

      {(pending.length > 0 || attachments.length > 0) && (
        <ul className="flex flex-col gap-1.5">
          {pending.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-[var(--text-secondary)]"
            >
              <Loader2 size={14} className="animate-spin" />
              <span className="min-w-0 flex-1 truncate">{u.fileName}</span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {Math.round(u.progress * 100)}%
              </span>
            </li>
          ))}
          {attachments.map((a, i) => (
            <li
              key={a.kind === "file" ? a.key : `${a.url}-${i}`}
              className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]"
            >
              {a.kind === "file" ? (
                <FileUp
                  size={14}
                  className="shrink-0 text-[var(--text-muted)]"
                />
              ) : (
                <Link2
                  size={14}
                  className="shrink-0 text-[var(--text-muted)]"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-foreground">
                {a.kind === "file" ? a.fileName : a.url}
              </span>
              {a.kind === "file" && (
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                  {formatBytes(a.sizeBytes)}
                </span>
              )}
              <button
                type="button"
                aria-label="Remove attachment"
                className="shrink-0 text-[var(--text-muted)] transition-colors hover:text-foreground"
                onClick={() => onRemove(i)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
