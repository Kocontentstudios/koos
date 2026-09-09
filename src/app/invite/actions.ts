"use server";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { redirectToLogin } from "@/lib/auth/redirects";
import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import {
  addWorkspaceMember,
  getInvitationBrandIds,
  getInvitationByTokenHash,
  getWorkspaceOwner,
  markInvitationAccepted,
  setMemberBrandAccess,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendMemberJoinedEmail } from "@/lib/notify/workspace";
import { acceptInvitation } from "@/lib/workspace/invitations";

export async function acceptInviteAction(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) redirect("/invite/invalid");

  const { dbUser } = await getAuthUser();
  if (!dbUser)
    redirectToLogin(`next=${encodeURIComponent(`/invite/${token}`)}`);

  const result = await acceptInvitation(
    {
      getInvitationByTokenHash: (hash) => getInvitationByTokenHash(hash),
      addWorkspaceMember,
      getInvitationBrandIds,
      setMemberBrandAccess,
      markInvitationAccepted,
      notifyOwnerMemberJoined: async (args) => {
        // Look up the workspace owner's email for the joined notification.
        const owner = await getWorkspaceOwner(args.workspaceId);
        if (!owner) return;
        await sendMemberJoinedEmail({
          to: owner.email,
          input: {
            memberName: args.memberName,
            memberEmail: args.memberEmail,
            workspaceName: args.workspaceName,
            teamUrl: appUrl("/team"),
          },
        });
      },
    },
    {
      token,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      },
    },
  );

  if (!result.ok) {
    /* "no-brands" leaves the invitation valid and pending, so the page would
       otherwise render the accept form again and loop. Carry the reason so it
       can explain itself. */
    const query = result.reason === "no-brands" ? "?error=no-brands" : "";
    redirect(`/invite/${encodeURIComponent(token)}${query}`);
  }
  await setActiveWorkspaceCookie(result.workspaceId);
  redirect("/dashboard");
}
