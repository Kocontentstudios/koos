import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  getGoogleProfile,
} from "@/lib/auth/google";
import { startSession } from "@/lib/auth/session";
import { createUser, getUserByEmail } from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendWelcomeEmail } from "@/lib/notify/account";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const failureRedirect = (message: string) =>
    NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(message)}`,
    );

  // The provider can return an error directly (e.g. consent denied).
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return failureRedirect(providerError);

  const store = await cookies();
  const storedState = store.get(GOOGLE_STATE_COOKIE)?.value;
  const codeVerifier = store.get(GOOGLE_VERIFIER_COOKIE)?.value;

  // Clear the short-lived OAuth cookies regardless of outcome.
  store.set(GOOGLE_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  store.set(GOOGLE_VERIFIER_COOKIE, "", { maxAge: 0, path: "/" });

  if (!code || !state || !storedState || !codeVerifier) {
    return failureRedirect("Invalid sign-in request. Please try again.");
  }
  if (state !== storedState) {
    return failureRedirect("Sign-in verification failed. Please try again.");
  }

  let profile: Awaited<ReturnType<typeof getGoogleProfile>>;
  try {
    profile = await getGoogleProfile(code, codeVerifier);
  } catch {
    return failureRedirect("Could not complete Google sign-in.");
  }

  let user = await getUserByEmail(profile.email);
  if (!user) {
    user = await createUser({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      provider: "google",
    });
    // Fire-and-forget welcome (never throws; must not block first login).
    await sendWelcomeEmail({
      to: user.email,
      input: { firstName: user.firstName, dashboardUrl: appUrl("/dashboard") },
    });
  }

  await startSession(user.id);
  return NextResponse.redirect(`${origin}/dashboard`);
}
