import { Google, generateCodeVerifier, generateState } from "arctic";
import { GOOGLE_STATE_COOKIE, GOOGLE_VERIFIER_COOKIE } from "./constants";

export {
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  generateCodeVerifier,
  generateState,
};

export const GOOGLE_SCOPES = ["openid", "profile", "email"];

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/auth/callback`;
}

export function createGoogleClient(): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
    );
  }
  return new Google(clientId, clientSecret, redirectUri());
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

/** Exchange the auth code and fetch the user's Google profile. */
export async function getGoogleProfile(
  code: string,
  codeVerifier: string,
): Promise<GoogleProfile> {
  const google = createGoogleClient();
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);

  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch Google profile.");
  }
  const data = (await res.json()) as {
    sub: string;
    email: string;
    given_name?: string;
    family_name?: string;
    name?: string;
    picture?: string;
  };

  const firstName = data.given_name ?? data.name?.split(" ")[0] ?? "User";
  const lastName =
    data.family_name ?? data.name?.split(" ").slice(1).join(" ") ?? "";

  return {
    googleId: data.sub,
    email: data.email,
    firstName,
    lastName,
    avatarUrl: data.picture ?? null,
  };
}
