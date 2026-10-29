"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "../actions";

export function AcceptForm({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) => startTransition(() => acceptInviteAction(fd))}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="token" value={token} />
      <Button
        type="submit"
        loading={pending}
        loadingText="Joining…"
        className="h-auto rounded-lg px-4 py-2.5 text-sm font-medium"
      >
        Join {workspaceName}
      </Button>
    </form>
  );
}
