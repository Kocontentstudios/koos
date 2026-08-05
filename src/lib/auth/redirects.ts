import { redirect } from "next/navigation";

export const AUTH_CLEAR_PATH = "/api/auth/clear";

/**
 * Guard-failure redirect. Routes through the cookie-clearing handler because
 * a redirect straight to /login loops when the browser still holds a dead
 * ko_session cookie (the proxy checks presence only and bounces /login back
 * to /dashboard). Not for logout flows — endSession already clears the cookie.
 */
export function redirectToLogin(loginQuery?: string): never {
  redirect(
    loginQuery
      ? `${AUTH_CLEAR_PATH}?next=${encodeURIComponent(`/login?${loginQuery}`)}`
      : AUTH_CLEAR_PATH,
  );
}
