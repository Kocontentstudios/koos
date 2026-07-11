import { cookies } from "next/headers";
import { cache } from "react";
import {
  getOrCreatePersonalWorkspaceId,
  getWorkspacesForUser,
} from "@/lib/db/queries";
import { chooseActiveWorkspace } from "./active-workspace";
import { WORKSPACE_COOKIE } from "./constants";
import { getAuthUser } from "./get-user";

/**
 * Resolve the signed-in user's active workspace. Wrapped in React cache()
 * (like getAuthUser) so layout + page share one lookup per request.
 * Self-heals accounts with no workspace (pre-migration stragglers).
 */
export const getActiveWorkspace = cache(async () => {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return { dbUser: null, workspace: null, role: null } as const;

  let memberships = await getWorkspacesForUser(dbUser.id);
  if (memberships.length === 0) {
    await getOrCreatePersonalWorkspaceId(dbUser.id, dbUser.firstName);
    memberships = await getWorkspacesForUser(dbUser.id);
  }

  const store = await cookies();
  const picked = chooseActiveWorkspace(
    memberships,
    store.get(WORKSPACE_COOKIE)?.value,
  );
  // memberships is non-empty here, so picked is never null.
  if (!picked) throw new Error("no workspace for authenticated user");
  return { dbUser, workspace: picked.workspace, role: picked.role } as const;
});

export async function setActiveWorkspaceCookie(
  workspaceId: string,
): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
