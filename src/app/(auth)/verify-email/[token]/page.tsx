import Link from "next/link";
import { performVerification } from "@/lib/auth/email-verification";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  getEmailVerificationTokenByHash,
  markEmailVerificationTokenUsed,
  markEmailVerified,
} from "@/lib/db/queries";

/** Landing page for the emailed verification link. Verification happens
 * server-side on render; email scanners that pre-open the link simply verify
 * the address early, which is the desired end state anyway. */
export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await performVerification(
    {
      getEmailVerificationTokenByHash,
      markEmailVerificationTokenUsed,
      markEmailVerified,
    },
    token,
  );
  const { dbUser } = await getAuthUser();

  // A burned link after the address is already confirmed (double click,
  // scanner beat the user to it) still deserves a success screen.
  const verified = result.ok || Boolean(dbUser?.emailVerifiedAt);

  return (
    <div className="font-brand relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="relative z-[2] mx-auto w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-surface-1 p-10 text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {verified ? (
          <>
            <h1 className="text-lg font-bold text-foreground">
              Email verified
            </h1>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Your email address is confirmed — you now have full access to
              strategy and calendar generation.
            </p>
            <Link
              href={dbUser ? "/dashboard" : "/login"}
              className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {dbUser ? "Go to dashboard" : "Sign in"}
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-foreground">
              This link is invalid or has expired
            </h1>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Verification links are valid for 24 hours and can be used once.
              {dbUser
                ? " Use the banner on your dashboard to send a fresh one."
                : " Sign in and use the banner on your dashboard to send a fresh one."}
            </p>
            <Link
              href={dbUser ? "/dashboard" : "/login"}
              className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {dbUser ? "Go to dashboard" : "Sign in"}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
