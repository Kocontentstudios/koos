import Link from "next/link";
import { getAuthUser } from "@/lib/auth/get-user";
import { getInvitationByTokenHash } from "@/lib/db/queries";
import { hashInviteToken } from "@/lib/workspace/invite-token";
import { AcceptForm } from "./accept-form";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-surface-1 p-8 text-center">
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInvitationByTokenHash(hashInviteToken(token));
  const { dbUser } = await getAuthUser();

  if (!invite || invite.acceptedAt) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation link isn't valid
        </h1>
        <p className="text-sm text-muted-foreground">
          It may have been used already or revoked. Ask the workspace owner to
          send a new one.
        </p>
      </Shell>
    );
  }

  if (Date.now() >= invite.expiresAt.getTime()) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation has expired
        </h1>
        <p className="text-sm text-muted-foreground">
          Invitations last 7 days. Ask the owner of {invite.workspaceName} to
          resend it.
        </p>
      </Shell>
    );
  }

  const nextParam = encodeURIComponent(`/invite/${token}`);

  if (!dbUser) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          Join {invite.workspaceName} on KO OS
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          You've been invited as {invite.email}. Sign in or create an account
          with that email to accept.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href={`/register?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Create account
          </Link>
          <Link
            href={`/login?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </Shell>
    );
  }

  if (dbUser.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">
          This invitation is for a different email
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          It was sent to {invite.email}, but you're signed in as {dbUser.email}.
          Sign in with the invited address to accept.
        </p>
        <Link
          href={`/login?next=${nextParam}&email=${encodeURIComponent(invite.email)}`}
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
        >
          Switch account
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="mb-2 text-lg font-semibold">
        Join {invite.workspaceName}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        You'll join as a Member and get access to all of this workspace's brands
        and content.
      </p>
      <AcceptForm token={token} workspaceName={invite.workspaceName} />
    </Shell>
  );
}
