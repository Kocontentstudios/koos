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
import { startSession } from "@/lib/auth/session";
import { createUser, getUserByEmail } from "@/lib/db/queries";

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
