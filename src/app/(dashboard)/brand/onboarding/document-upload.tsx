"use client";

import { Paperclip } from "lucide-react";
import { type ChangeEvent, useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { Proposal } from "@/lib/ai/tools/proposals";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_SUMMARY,
  isAllowedDocument,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/formats";
import { uploadToPresignedUrl } from "@/lib/uploads/put-presigned";

type Stage = "idle" | "uploading" | "reading";

/**
 * Uploading a brand document from the onboarding chat (FEAT-018).
 *
 * A hook rather than a self-contained component because TWO controls open the
 * same picker — the paperclip in the input bar and the "Upload it here" link
 * in the hint beneath it — and two file inputs would mean two sources of
 * pending state that can disagree.
 *
 * Uploads go straight to storage through a presigned URL rather than through
 * an API route: that path caps at 5MB and passes the whole file through a
 * serverless function, and the ticket asks for 25MB.
 *
 * Nothing is written to the brand here. The parse returns a proposal, the
 * caller renders the existing confirmation card, and the fields reach the
 * brand only when the user confirms.
 */
export function useDocumentUpload({
  brandId,
  conversation,
  onProposal,
}: {
  brandId: string;
  /** What has been said so far, so the document is read alongside it. */
  conversation: () => string;
  onProposal: (proposal: Proposal, fileName: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [percent, setPercent] = useState(0);
  const [fileName, setFileName] = useState("");
  const busy = stage !== "idle";

  const handleFile = useCallback(
    async (file: File) => {
      /* Checked here as well as at presign: a rejection the user sees before
         25MB leaves their connection is worth more than the same rejection
         afterwards. The server still enforces both, because a client check is
         a convenience and never a control. */
      if (!isAllowedDocument(file.name, file.type)) {
        toast.error(`We can't read that file type. ${DOCUMENT_SUMMARY}.`);
        return;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        toast.error(`That document is too large. ${DOCUMENT_SUMMARY}.`);
        return;
      }

      setFileName(file.name);
      setPercent(0);
      setStage("uploading");
      try {
        const presignRes = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            kind: "document",
          }),
        });
        const presign = (await presignRes.json().catch(() => null)) as {
          key?: string;
          url?: string;
          error?: string;
        } | null;
        if (!presignRes.ok || !presign?.url || !presign.key) {
          throw new Error(presign?.error ?? "We couldn't start that upload.");
        }

        await uploadToPresignedUrl(presign.url, file, (fraction) =>
          setPercent(Math.round(fraction * 100)),
        );

        setStage("reading");
        const res = await fetch("/api/brand/onboarding/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            key: presign.key,
            fileName: file.name,
            conversation: conversation() || undefined,
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          proposal?: Proposal;
          truncated?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !data?.proposal) {
          throw new Error(data?.error ?? "We couldn't read that document.");
        }

        /* Said plainly rather than silently: a deck read only in part may be
           missing whatever was at the end of it, and the user is about to
           confirm the result. */
        if (data.truncated) {
          toast.info(
            "That document was long, so KO read the beginning of it. Check the summary covers what you expected.",
          );
        }
        onProposal(data.proposal, file.name);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "We couldn't read that document.",
        );
      } finally {
        setStage("idle");
        setPercent(0);
        /* Cleared so choosing the SAME file again still fires a change. */
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [brandId, conversation, onProposal],
  );

  const open = useCallback(() => inputRef.current?.click(), []);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  return { inputRef, open, onChange, busy, stage, percent, fileName };
}

/** The hidden picker. Rendered once, driven by every control that opens it. */
export function DocumentInput({
  inputRef,
  onChange,
}: Pick<ReturnType<typeof useDocumentUpload>, "inputRef" | "onChange">) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={DOCUMENT_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      data-testid="document-input"
      onChange={onChange}
    />
  );
}

export function DocumentUploadButton({
  onClick,
  busy,
  disabled,
  statusId,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  statusId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      aria-describedby={busy ? statusId : undefined}
      aria-label={busy ? "Reading your document" : "Attach a brand document"}
      title={`Attach a brand document — ${DOCUMENT_SUMMARY}`}
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <Paperclip className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

/**
 * What the upload is doing, in words.
 *
 * Never aria-busy on this element: marking a live region busy tells assistive
 * tech to withhold the very update the region exists to deliver.
 */
export function DocumentUploadStatus({
  id,
  stage,
  fileName,
  percent,
}: {
  id: string;
  stage: Stage;
  fileName: string;
  percent: number;
}) {
  if (stage === "idle") return null;
  return (
    <p
      id={id}
      role="status"
      className="absolute -top-6 left-4 text-[12px] text-[var(--text-secondary)]"
    >
      {stage === "uploading"
        ? `Uploading ${fileName}… ${percent}%`
        : `Reading ${fileName}…`}
    </p>
  );
}

/** Stable id for wiring the button's aria-describedby to the status line. */
export function useDocumentStatusId() {
  return useId();
}
