"use client";

import { Download, FileText, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { saveBlob } from "@/lib/design/png-to-jpeg";
import {
  type DesignSet,
  type DownloadFormat,
  kindNoun,
  setDownloadUrl,
} from "./set-model";

/* The server names the file (01-hook.png … inside); this is only the
   fallback for a response that carries no Content-Disposition. */
function fileNameOf(res: Response, set: DesignSet, format: DownloadFormat) {
  const header = res.headers.get("content-disposition") ?? "";
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)?.[1];
  return named
    ? decodeURIComponent(named)
    : `${kindNoun(set.kind)}-${set.setId.slice(0, 8)}.${format}`;
}

const LABELS: Record<DownloadFormat, { idle: string; busy: string }> = {
  zip: { idle: "Download ZIP", busy: "Packing ZIP…" },
  pdf: { idle: "Download PDF", busy: "Making PDF…" },
};

/**
 * The whole set in one file. Fetched rather than linked: packing ten frames
 * takes long enough to need its own "working" state, and a failure is said
 * here instead of replacing the page with the route's JSON error.
 */
export function SetDownloads({
  set,
  blocked,
}: {
  set: DesignSet;
  /** A frame is regenerating, so a download now would miss its new
   *  version. "Wait", not "working". */
  blocked: boolean;
}) {
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [failed, setFailed] = useState<DownloadFormat | null>(null);

  async function download(format: DownloadFormat) {
    setBusy(format);
    setFailed(null);
    try {
      const res = await fetch(setDownloadUrl(set, format));
      if (!res.ok) throw new Error(String(res.status));
      saveBlob(await res.blob(), fileNameOf(res, set, format));
    } catch {
      setFailed(format);
    } finally {
      setBusy((f) => (f === format ? null : f));
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        {(["zip", "pdf"] as const).map((format) => (
          <Button
            key={format}
            type="button"
            variant="secondary"
            onClick={() => void download(format)}
            loading={busy === format}
            loadingText={LABELS[format].busy}
            disabled={blocked}
            data-download={format}
          >
            {format === "zip" ? (
              <Download aria-hidden="true" />
            ) : (
              <FileText aria-hidden="true" />
            )}
            {LABELS[format].idle}
          </Button>
        ))}
      </div>
      {failed ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-[12px] text-[var(--status-error-fg)]"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5" />
          The {failed.toUpperCase()} couldn't be made. Try again.
        </p>
      ) : null}
    </div>
  );
}
