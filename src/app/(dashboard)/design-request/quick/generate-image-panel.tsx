"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ASPECT_RATIO_OPTIONS = [
  { value: "1:1", label: "Square (1:1)" },
  { value: "4:5", label: "Portrait (4:5)" },
  { value: "16:9", label: "Landscape (16:9)" },
] as const;

const selectCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[14px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

const labelCls =
  "mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

interface GenerateResult {
  url: string;
  key: string;
  contentType: string;
}

interface GenerateImagePanelProps {
  brandId: string;
  onUseAsReference: (url: string) => void;
}

/** Keeps the saved-asset name tied to the object the generation flow wrote,
 * while staying short and readable in the assets list. */
function deriveFileName(key: string): string {
  const base = key.split("/").pop() ?? "image.png";
  const dot = base.lastIndexOf(".");
  const id = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "png" : base.slice(dot + 1);
  return `generated-${id.slice(0, 8)}.${ext}`;
}

async function parseJsonResponse<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function GenerateImagePanel({
  brandId,
  onUseAsReference,
}: GenerateImagePanelProps) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>(
    ASPECT_RATIO_OPTIONS[0].value,
  );
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (generating || !trimmed) return;
    setGenerating(true);
    setResult(null);
    setSaved(false);
    try {
      const res = await fetch("/api/design/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, prompt: trimmed, aspectRatio }),
      });
      const data = await parseJsonResponse<GenerateResult | { error: string }>(
        res,
      );
      if (!res.ok || !data || "error" in data) {
        toast.error(
          (data && "error" in data && data.error) ||
            "Image generation failed. Please try again.",
        );
        return;
      }
      setResult(data);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveAsset() {
    if (!result || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/design/generated/save-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          key: result.key,
          fileName: deriveFileName(result.key),
        }),
      });
      const data = await parseJsonResponse<
        { asset: unknown } | { error: string }
      >(res);
      if (!res.ok || !data || "error" in data) {
        toast.error(
          (data && "error" in data && data.error) ||
            "Failed to save asset. Please try again.",
        );
        return;
      }
      setSaved(true);
      toast.success("Saved to your brand assets");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleUseAsReference() {
    if (!result) return;
    onUseAsReference(result.url);
    toast.success("Attached as reference");
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">
          Generate with AI
        </h2>
        <p className="text-[13px] text-[var(--text-secondary)]">
          Each generation counts against your image quota. Treat the result as a
          draft reference for the design team, not final artwork.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor={promptId}>
          Describe the image
        </label>
        <Textarea
          id={promptId}
          value={prompt}
          disabled={generating}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. a warm, minimal flat-lay of sourdough loaves on a wooden table"
          className="min-h-[100px]"
        />
      </div>

      <div>
        <label className={labelCls} htmlFor={`${promptId}-aspect`}>
          Aspect ratio
        </label>
        <select
          id={`${promptId}-aspect`}
          className={selectCls}
          value={aspectRatio}
          disabled={generating}
          onChange={(e) => setAspectRatio(e.target.value)}
        >
          {ASPECT_RATIO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <Button
        variant="default"
        onClick={handleGenerate}
        loading={generating}
        loadingText="Generating…"
        disabled={!prompt.trim()}
        className="w-full justify-center"
      >
        Generate
      </Button>

      {result && (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
          {/* biome-ignore lint/performance/noImgElement: previewing a freshly generated, non-optimizable R2 url */}
          <img
            src={result.url}
            alt="AI-generated draft"
            className="w-full rounded-lg border border-[var(--border)]"
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={result.url}
              download={deriveFileName(result.key)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
              )}
            >
              Download
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSaveAsset}
              loading={saving}
              loadingText="Saving…"
              disabled={saved}
            >
              {saved ? "Saved to assets" : "Save as brand asset"}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleUseAsReference}
            >
              Use as reference
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
