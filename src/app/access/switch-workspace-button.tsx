"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SwitchWorkspaceButton({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  async function openWorkspace() {
    setSwitching(true);
    try {
      const res = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Could not open that workspace");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open that workspace",
      );
      setSwitching(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      onClick={openWorkspace}
      loading={switching}
      loadingText="Opening…"
    >
      Open {workspaceName}
    </Button>
  );
}
