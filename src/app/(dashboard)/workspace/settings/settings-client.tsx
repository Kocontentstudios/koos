"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

async function patchWorkspace(body: {
  name?: string;
  logoUrl?: string | null;
}): Promise<string | null> {
  const res = await fetch("/api/workspace", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? "Could not save. Please try again.";
}

function SectionCard({
  title,
  children,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-6 ${
        danger
          ? "border-[var(--status-error-fg)]/40"
          : "border-[var(--border)] bg-surface-1"
      }`}
    >
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsClient({
  workspace,
  brandCount,
  canDelete,
}: {
  workspace: { id: string; name: string; logoUrl: string | null };
  brandCount: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-save on blur, per the prototype ("changes saved automatically").
  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    setStatus("saving");
    startTransition(async () => {
      const err = await patchWorkspace({ name: trimmed });
      if (err) {
        setStatus("error");
        setError(err);
      } else {
        setStatus("saved");
        setError(null);
        router.refresh();
      }
    });
  }

  function uploadLogo(file: File) {
    setStatus("saving");
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        setStatus("error");
        setError("Logo upload failed. Please try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const err = await patchWorkspace({ logoUrl: url });
      if (err) {
        setStatus("error");
        setError(err);
      } else {
        setStatus("saved");
        setError(null);
        router.refresh();
      }
    });
  }

  function deleteWorkspace() {
    startTransition(async () => {
      const res = await fetch("/api/workspace", { method: "DELETE" });
      if (res.ok) {
        window.location.assign("/dashboard");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "Could not delete the workspace.");
      setDeleteOpen(false);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <SectionCard title="Workspace Information">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="ws-name"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Workspace name
            </label>
            <Input
              id="ws-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs text-muted-foreground">
              Logo
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {workspace.logoUrl ? "Replace logo" : "Upload logo"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved."}
            {status === "error" && (
              <span className="text-[var(--status-error-fg)]">{error}</span>
            )}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Danger Zone" danger>
        <p className="mb-4 text-sm text-muted-foreground">
          Deleting this workspace permanently removes its {brandCount} brand
          {brandCount === 1 ? "" : "s"} and every campaign, calendar, chat, and
          design ticket inside them. This cannot be undone.
        </p>
        {!canDelete && (
          <p className="mb-4 text-xs text-muted-foreground">
            You can't delete your only workspace.
          </p>
        )}
        <button
          type="button"
          disabled={!canDelete || pending}
          onClick={() => setDeleteOpen(true)}
          className="rounded-lg border border-[var(--status-error-fg)]/60 px-4 py-2 text-sm font-medium text-[var(--status-error-fg)] disabled:opacity-50"
        >
          Delete Workspace
        </button>
      </SectionCard>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {workspace.name}?</DialogTitle>
            <DialogDescription>
              Type the workspace name to confirm. All {brandCount} brand
              {brandCount === 1 ? "" : "s"} and their content will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={workspace.name}
            aria-label="Type the workspace name to confirm deletion"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirmText !== workspace.name || pending}
              onClick={deleteWorkspace}
              className="flex items-center gap-2 rounded-lg bg-[var(--status-error-fg)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? <Spinner /> : null}
              Delete Workspace
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
