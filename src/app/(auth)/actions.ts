"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createGoogleClient,
  GOOGLE_SCOPES,
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  generateCodeVerifier,
  generateState,
} from "@/lib/auth/google";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { performReset, requestReset } from "@/lib/auth/password-reset";
import { invalidateUserSessions, startSession } from "@/lib/auth/session";
import {
  createPasswordResetToken,
  createUser,
  getPasswordResetTokenByHash,
  getUserByEmail,
  markPasswordResetTokenUsed,
  updateUserPassword,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendPasswordResetEmail, sendWelcomeEmail } from "@/lib/notify/account";
import { isValidEmail } from "@/lib/validation/email";

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await getUserByEmail(email);
  // Same generic message whether the email is unknown or the password is wrong,
  // so we don't leak which emails have accounts.
  if (
    !user ||
    !user.passwordHash ||
    !(await verifyPassword(user.passwordHash, password))
  ) {
    return { error: "Invalid email or password." };
  }

  await startSession(user.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!firstName || !lastName || !email || !password) {
    return { error: "All fields are required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  if (await getUserByEmail(email)) {
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    firstName,
    lastName,
    email,
    passwordHash,
    provider: "email",
  });

  // Fire-and-forget welcome (never throws; must not block first login).
  await sendWelcomeEmail({
    to: user.email,
    input: { firstName: user.firstName, dashboardUrl: appUrl("/dashboard") },
  });

  await startSession(user.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signInWithGoogle() {
  let authUrl: URL | undefined;
  try {
    const google = createGoogleClient();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    authUrl = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);

    const store = await cookies();
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    };
    store.set(GOOGLE_STATE_COOKIE, state, opts);
    store.set(GOOGLE_VERIFIER_COOKIE, codeVerifier, opts);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Google sign-in is unavailable.",
    };
  }

  if (!authUrl) {
    return { error: "Google sign-in is unavailable." };
  }
  redirect(authUrl.toString());
}

export async function requestPasswordReset(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  if (!email || !isValidEmail(email)) {
    return { error: "Please enter a valid email address." };
  }
  await requestReset(
    {
      getUserByEmail,
      createPasswordResetToken,
      sendPasswordResetEmail,
      buildResetUrl: (token) =>
        appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
    },
    email,
  );
  // Same message whether or not the account exists.
  return {
    success: "If an account exists for that email, a reset link is on its way.",
  };
}

export async function resetPassword(formData: FormData) {
  const token = (formData.get("token") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";
  const confirm = (formData.get("confirm") as string) ?? "";
  if (!token) {
    return { error: "This reset link is invalid. Please request a new one." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }
  const result = await performReset(
    {
      getPasswordResetTokenByHash,
      updateUserPassword,
      markPasswordResetTokenUsed,
      invalidateUserSessions,
      hashPassword,
    },
    { token, password },
  );
  if (!result.ok) {
    return { error: result.error };
  }
  redirect("/login?reset=1");
}
