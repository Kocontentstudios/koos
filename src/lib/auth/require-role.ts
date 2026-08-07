import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getAuthUser } from "./get-user";
import type { Role } from "./roles";

export type { Role };

/**
 * Gate a server component/route on the user's role. Redirects unauthenticated
 * users to /login and authenticated-but-unauthorized users to /dashboard.
 */
export async function requireRole(allowed: Role[]) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirectToLogin();
  if (!allowed.includes(dbUser.role as Role)) redirect("/dashboard");
  return { dbUser };
}
