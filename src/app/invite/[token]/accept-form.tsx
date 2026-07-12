"use client";

import { useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
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
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Joining…" : `Join ${workspaceName}`}
      </button>
    </form>
  );
}
